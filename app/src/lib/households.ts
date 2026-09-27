// Household records with per-field versions: different fields merge on sync,
// the same field edited on two devices becomes a conflict for the user.
import { logActivity } from "./activity";
import { edge } from "./bridge";
import { emit } from "./events";
import { enqueue, removeFromOutbox } from "./outbox";
import { nowIso } from "./time";
import type { Conflict, Household, HouseholdField, Versioned } from "./types";
import { VILLAGES } from "./villages";

type Store = Record<string, Household>;

export async function allHouseholds(): Promise<Store> {
  return (await edge.storeGet<Store>("households")) ?? {};
}

export async function getHousehold(id: string): Promise<Household | null> {
  return (await allHouseholds())[id] ?? null;
}

async function save(store: Store) {
  await edge.storeSet("households", store);
  emit("households");
}

export async function saveHouseholds(list: Household[]) {
  const store = await allHouseholds();
  for (const h of list) store[h.id] = h;
  await save(store);
}

export async function createHousehold(input: { village: string; locality: string; houseNo: string; head: string; memberName: string; memberAge: number; memberSex: "M" | "F"; lat: number; lon: number; deviceId: string }) {
  const id = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const version = <T,>(value: T): Versioned<T> => ({ value, ts: 0, base: 0, dev: input.deviceId, dirty: true });
  const h: Household = {
    id, village: input.village, ward: input.locality.trim() || VILLAGES.find((v) => v.code === input.village)?.name || input.village, house_no: input.houseNo.trim() || `Home ${id.slice(0, 5)}`,
    lat: input.lat, lon: input.lon,
    fields: {
      head: version(input.head.trim()), phone: version(""),
      members: version([{ id: memberId, name: input.memberName.trim(), sex: input.memberSex, age: input.memberAge }]),
      pregnant_member: version(null), edd: version(null), high_risk: version(false),
    },
  };
  await saveHouseholds([h]);
  await enqueue(registryItem(h));
  await logActivity("visit", `${h.house_no}: family created (pending registry)`);
  return { household: h, memberId };
}

function registryItem(h: Household) {
  const changes: Record<string, { value: unknown; base: number }> = {};
  for (const [name, f] of Object.entries(h.fields) as [HouseholdField, Versioned][]) {
    if (f.dirty) changes[name] = { value: f.value, base: f.base ?? f.ts };
  }
  return {
    id: `hh:${h.id}`,
    kind: "household" as const,
    priority: 2 as const,
    created_at: nowIso(),
    label: `${h.house_no} · ${Object.keys(changes).join(", ")}`,
    // The registry receives an area centroid. Exact GPS, if present, stays on this phone.
    payload: { id: h.id, village: h.village, ward: h.ward, house_no: h.house_no, lat: VILLAGES.find((v) => v.code === h.village)?.lat ?? h.lat, lon: VILLAGES.find((v) => v.code === h.village)?.lon ?? h.lon, changes },
  };
}

export async function editField<K extends HouseholdField>(id: string, field: K, value: Household["fields"][K]["value"], deviceId: string) {
  const store = await allHouseholds();
  const h = store[id];
  if (!h) throw new Error("household not found");
  const f = h.fields[field] as Versioned;
  if (!f.dirty) f.base = f.ts;
  f.value = value;
  f.dirty = true;
  f.dev = deviceId;
  await save(store);
  await enqueue(registryItem(h));
  await logActivity("visit", `${h.house_no}: ${field} updated (pending registry)`);
}

export interface PushResult {
  accepted: { household_id: string; field: HouseholdField; ts: number }[];
  conflicts: Omit<Conflict, "at" | "mine">[];
}

export async function applyPushResult(result: PushResult) {
  const store = await allHouseholds();
  for (const a of result.accepted) {
    const f = store[a.household_id]?.fields[a.field] as Versioned | undefined;
    if (!f) continue;
    f.ts = a.ts;
    f.dirty = false;
    delete f.base;
  }
  const conflicts = await getConflicts();
  for (const c of result.conflicts) {
    const f = store[c.household_id]?.fields[c.field] as Versioned | undefined;
    if (!f) continue;
    const entry: Conflict = { ...c, mine: f.value, at: nowIso() };
    const i = conflicts.findIndex((x) => x.household_id === c.household_id && x.field === c.field);
    if (i >= 0) conflicts[i] = entry;
    else conflicts.push(entry);
  }
  await save(store);
  await edge.storeSet("conflicts", conflicts);
  if (result.conflicts.length) await logActivity("conflict", `${result.conflicts.length} field conflict(s) need a decision`);
  const settled = Object.values(store).filter((h) => !Object.values(h.fields).some((f) => (f as Versioned).dirty));
  await removeFromOutbox(settled.map((h) => `hh:${h.id}`));
  emit("households");
}


export async function mergeFromRegistry(records: { id: string; village: string; ward: string; house_no: string; lat: number; lon: number; fields: Record<string, { value: unknown; ts: number; dev: string }> }[]) {
  const store = await allHouseholds();
  let changed = 0;
  for (const r of records) {
    const local = store[r.id];
    if (!local) {
      store[r.id] = { ...r, fields: r.fields as never };
      changed++;
      continue;
    }
    for (const [name, remote] of Object.entries(r.fields)) {
      const f = local.fields[name as HouseholdField] as Versioned | undefined;
      if (!f) {
        (local.fields as Record<string, Versioned>)[name] = { ...remote };
        changed++;
      } else if (remote.ts > f.ts && !f.dirty) {
        Object.assign(f, { value: remote.value, ts: remote.ts, dev: remote.dev });
        changed++;
      }
    }
  }
  if (changed) await save(store);
  return changed;
}

export async function getConflicts(): Promise<Conflict[]> {
  return (await edge.storeGet<Conflict[]>("conflicts")) ?? [];
}

export async function resolveConflict(c: Conflict, choice: "mine" | "theirs", deviceId: string) {
  const store = await allHouseholds();
  const h = store[c.household_id];
  const f = h?.fields[c.field] as Versioned | undefined;
  if (h && f) {
    if (choice === "theirs") {
      Object.assign(f, { value: c.theirs, ts: c.theirs_ts, dev: c.theirs_dev, dirty: false });
      delete f.base;
    } else {
      Object.assign(f, { value: c.mine, base: c.theirs_ts, dirty: true, dev: deviceId });
    }
    await save(store);
    if (Object.values(h.fields).some((x) => (x as Versioned).dirty)) await enqueue(registryItem(h));
    else await removeFromOutbox([`hh:${h.id}`]);
  }
  const rest = (await getConflicts()).filter((x) => !(x.household_id === c.household_id && x.field === c.field));
  await edge.storeSet("conflicts", rest);
  await logActivity("conflict", `${h?.house_no ?? c.household_id}: ${c.field} → kept ${choice === "mine" ? "my" : "their"} value`);
  emit("households");
}
