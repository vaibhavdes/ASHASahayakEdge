// Visit notes in the Qdrant Edge "memory" shard.
import { logActivity } from "./activity";
import { edge } from "./bridge";
import { embed, embedOne } from "./embedder";
import { emit } from "./events";
import { and, eq, since } from "./filters";
import { expand } from "./normalize";
import { enqueue, listOutbox, removeFromOutbox } from "./outbox";
import lexicon from "../../../data/lexicon.json";
import { buildSignal, signalSentence, visitSyncClass } from "./policy";
import { parseQuery, type Chip } from "./queryParser";
import { activitiesFor, tag, type Tagging } from "./tagger";
import { daysAgoIso, nowIso } from "./time";
import type { Filter, Hit, Household, Member, Role, SearchMode, Visit } from "./types";

// Dense 2 : BM25 1 scored best in eval/bench.py.
export const HYBRID_WEIGHTS: [number, number] = [2, 1];

const SIGNAL_WORDS = lexicon.signal_words as Record<string, string>;

// Embedded text = normalised note + its tags (symptoms, child/adult, pregnancy).
// See "normalised+tags" in eval/bench.py.
export function memoryText(v: Pick<Visit, "text" | "syndromes" | "pregnant" | "age_band">): string {
  const tags = v.syndromes.map((s) => SIGNAL_WORDS[s] ?? s);
  const context = [v.pregnant ? "pregnant woman" : "", ["0-5", "6-14"].includes(v.age_band) ? "child" : "adult"].filter(Boolean);
  return `${expand(v.text)} | ${[...tags, ...context].join(" ")}`;
}

export function ageBand(member: Member, isNewborn = false): string {
  if (isNewborn || member.age <= 5) return "0-5";
  if (member.age <= 14) return "6-14";
  if (member.age <= 49) return "15-49";
  return "50+";
}

export const visitContext = (pregnant: boolean, age: number) =>
  [pregnant && "pregnant", age === 0 && "newborn"].filter(Boolean).join(" ");

export interface NewVisit {
  household: Household;
  member: Member;
  text: string;
  role: Role;
  deviceId: string;
  at?: string;
}

export async function signalFor(visit: Visit): Promise<string> {
  const sentenceVector = await embedOne(signalSentence(visit.syndromes, visit.age_band));
  const signal = buildSignal(visit, sentenceVector);
  await enqueue({
    id: signal.id,
    kind: "signal",
    priority: visit.danger ? 0 : 1,
    created_at: nowIso(),
    label: `${visit.syndromes.join(" + ")} · ${visit.age_band}`,
    ref: visit.visit_id,
    payload: signal as unknown as Record<string, unknown>,
  });
  return signal.id;
}

export async function addVisit(input: NewVisit): Promise<{ visit: Visit; tagging: Tagging; ms: number }> {
  const t0 = performance.now();
  const hh = input.household;
  const pregnant = hh.fields.pregnant_member.value === input.member.id;
  const normalised = expand(input.text);
  const vector = await embedOne(normalised);
  // Pregnancy / newborn come from the household record, not only the note.
  const tagging = await tag(`${input.text} ${visitContext(pregnant, input.member.age)}`, vector);
  const visit: Visit = {
    kind: "visit",
    visit_id: crypto.randomUUID(),
    household_id: hh.id,
    member_id: input.member.id,
    member_name: input.member.name,
    house_no: hh.house_no,
    village: hh.village,
    ward: hh.ward,
    sex: input.member.sex,
    age_band: ageBand(input.member, tagging.syndromes.includes("danger_newborn")),
    pregnant,
    visit_at: input.at ?? nowIso(),
    text: input.text,
    syndromes: tagging.syndromes,
    danger: tagging.danger,
    activities: activitiesFor(tagging.terms, { pregnant, danger: tagging.danger }),
    tag_method: tagging.method,
    sync_class: visitSyncClass(tagging),
    sync_status: tagging.syndromes.length ? "pending" : "local",
    loc: { lat: hh.lat, lon: hh.lon },
    author_role: input.role,
    device_id: input.deviceId,
  };
  if (visit.sync_class === "signal" || visit.sync_class === "urgent") visit.signal_id = await signalFor(visit);
  const stored = memoryText(visit);
  await edge.upsert("memory", [{ id: visit.visit_id, dense: await embedOne(stored), text: stored, payload: visit as never }]);
  const ms = Math.round(performance.now() - t0);
  await logActivity("visit", `${visit.member_name}: ${visit.syndromes.join(", ") || "routine"} (${tagging.method})`, ms);
  emit("memory");
  return { visit, tagging, ms };
}

export interface SearchResult {
  hits: Hit<Visit>[];
  chips: Chip[];
  embedMs: number;
  searchMs: number;
}

export async function searchVisits(query: string, mode: SearchMode, dropChips: string[] = [], extra: Filter | null = null): Promise<SearchResult> {
  const { text, chips } = parseQuery(query);
  const active = chips.filter((c) => !dropChips.includes(c.id));
  const filter = and(eq("kind", "visit"), ...active.map((c) => c.cond), ...(extra?.must as never[] ?? []));
  const t0 = performance.now();
  const normalised = expand(text);
  const dense = await embedOne(normalised);
  const t1 = performance.now();
  const hits = await edge.query<Visit>("memory", {
    dense,
    text: normalised,
    filter,
    limit: 12,
    mode,
    weights: HYBRID_WEIGHTS,
    recency: mode === "diverse" ? undefined : { key: "visit_at", now: nowIso(), half_life_days: 30, weight: 0.25 },
  });
  const t2 = performance.now();
  await logActivity("search", `"${query}" → ${hits.length} (${mode})`, Math.round(t2 - t0));
  return { hits, chips, embedMs: Math.round(t1 - t0), searchMs: Math.round(t2 - t1) };
}

export function similarVisits(visitId: string, limit = 5) {
  return edge.similar<Visit>("memory", visitId, and(eq("kind", "visit")), limit);
}

export async function visitsForHousehold(householdId: string): Promise<Visit[]> {
  const page = await edge.scroll<Visit>("memory", 200, null, and(eq("kind", "visit"), eq("household_id", householdId)));
  return page.points.map((p) => p.payload).sort((a, b) => b.visit_at.localeCompare(a.visit_at));
}

export async function recentVisits(limit = 20): Promise<Visit[]> {
  const page = await edge.scroll<Visit>("memory", 400, null, and(eq("kind", "visit"), since("visit_at", daysAgoIso(14))));
  return page.points.map((p) => p.payload).sort((a, b) => b.visit_at.localeCompare(a.visit_at)).slice(0, limit);
}

export async function weekSummary(village: string) {
  const week = and(eq("kind", "visit"), eq("village", village), since("visit_at", daysAgoIso(7)));
  const [syndromes, visits, danger, pending] = await Promise.all([
    edge.facet("memory", "syndromes", week, 10),
    edge.count("memory", week),
    edge.count("memory", and(eq("kind", "visit"), eq("village", village), eq("danger", true), since("visit_at", daysAgoIso(7)))),
    edge.count("memory", and(eq("kind", "visit"), eq("sync_status", "pending"))),
  ]);
  return { syndromes, visits, danger, pending };
}

// Bulk import: batches of 64, indexes exist before the first write, caller optimizes once at the end.
export async function bulkInsert(visits: Visit[], onProgress?: (done: number) => void) {
  const BATCH = 64;
  for (let i = 0; i < visits.length; i += BATCH) {
    const batch = visits.slice(i, i + BATCH);
    const texts = batch.map(memoryText);
    const vectors = await embed(texts);
    await edge.upsert(
      "memory",
      batch.map((v, j) => ({ id: v.visit_id, dense: vectors[j], text: texts[j], payload: v as never })),
    );
    onProgress?.(Math.min(i + BATCH, visits.length));
  }
  emit("memory");
}

// --------------------------- correcting a visit ---------------------------

// Not sent yet: drop it from the queue. Already sent: retract it by its random id.
async function withdrawSignal(visit: Visit) {
  if (!visit.signal_id) return;
  const queued = (await listOutbox()).some((i) => i.id === visit.signal_id);
  if (queued) {
    await removeFromOutbox([visit.signal_id]);
    return;
  }
  await enqueue({
    id: `retract:${visit.signal_id}`,
    kind: "retract",
    priority: 1,
    created_at: nowIso(),
    label: `Correction: withdraw ${visit.syndromes.join(" + ") || "signal"}`,
    payload: { signal_id: visit.signal_id },
  });
}

export async function updateVisitNote(visit: Visit, text: string, household: Household): Promise<Visit> {
  const member = household.fields.members.value.find((m) => m.id === visit.member_id);
  const normalised = expand(text);
  const tagging = await tag(`${text} ${visitContext(visit.pregnant, member?.age ?? 30)}`, await embedOne(normalised));
  const changedSignal = tagging.syndromes.join() !== visit.syndromes.join() || tagging.danger !== visit.danger;
  const updated: Visit = {
    ...visit,
    text,
    syndromes: tagging.syndromes,
    danger: tagging.danger,
    activities: activitiesFor(tagging.terms, { pregnant: visit.pregnant, danger: tagging.danger }),
    tag_method: tagging.method,
    sync_class: visitSyncClass(tagging),
    edited_at: nowIso(),
  };
  if (changedSignal) {
    await withdrawSignal(visit);
    updated.signal_id = undefined;
    updated.sync_status = tagging.syndromes.length ? "pending" : "local";
    if (updated.sync_class === "signal" || updated.sync_class === "urgent") updated.signal_id = await signalFor(updated);
  }
  const stored = memoryText(updated);
  await edge.upsert("memory", [{ id: updated.visit_id, dense: await embedOne(stored), text: stored, payload: updated as never }]);
  await logActivity("visit", `${visit.member_name}: note corrected${changedSignal ? " (signal updated)" : ""}`);
  emit("memory", "outbox");
  return updated;
}

export async function deleteVisit(visit: Visit) {
  await withdrawSignal(visit);
  await edge.remove("memory", [visit.visit_id]);
  await logActivity("visit", `${visit.member_name}: visit deleted${visit.signal_id ? " (signal withdrawn)" : ""}`);
  emit("memory", "outbox");
}
