// Starter guidance and synthetic demo data.
import demoHouseholds from "../../../data/out/demo_households.json";
import demoVisits from "../../../data/out/demo_visits.json";
import knowledge from "../../../data/knowledge.json";
import { logActivity } from "./activity";
import { edge } from "./bridge";
import { embed } from "./embedder";
import { saveHouseholds } from "./households";
import { bulkInsert, signalFor } from "./memory";
import { answerVariants, upsertDocs } from "./knowledge";
import { visitSyncClass } from "./policy";
import { activitiesFor, tag, tagByRules } from "./tagger";
import { expand } from "./normalize";
import { daysSince } from "./time";
import type { Household, KnowledgeDoc, Role, Visit } from "./types";

export async function loadStarterKnowledge() {
  const published = "2026-09-01T00:00:00Z";
  const docs: (KnowledgeDoc & { id: string })[] = [
    ...knowledge.protocols.map((p) => ({ ...p, kind: "protocol" as const, published_at: published, version: knowledge.version })),
    ...knowledge.answers.flatMap((a) =>
      answerVariants(a).map((v) => ({ ...v, kind: "answer" as const, source: "Approved answer", published_at: published, version: knowledge.version })),
    ),
  ];
  await upsertDocs(docs);
}

type RawHousehold = (typeof demoHouseholds)["RMP"][number];
type RawVisit = (typeof demoVisits)["RMP"][number];

function toHousehold(h: RawHousehold): Household {
  const v = <T,>(value: T) => ({ value, ts: 1, dev: "registry" });
  return {
    id: h.id,
    village: h.village,
    ward: h.ward,
    house_no: h.house_no,
    lat: h.lat,
    lon: h.lon,
    fields: {
      head: v(h.head),
      phone: v(h.phone),
      members: v(h.members as Household["fields"]["members"]["value"]),
      pregnant_member: v(h.pregnant_member),
      edd: v(null),
      high_risk: v(false),
    },
  };
}

export async function loadDemoData(village: "RMP" | "LKP", role: Role, deviceId: string, onProgress: (label: string, pct: number) => void) {
  const households = (demoHouseholds[village] as RawHousehold[]).map(toHousehold);
  await saveHouseholds(households);
  const byId = new Map(households.map((h) => [h.id, h]));

  const raw = demoVisits[village] as RawVisit[];
  onProgress("Tagging visit notes", 0);
  const visits: Visit[] = [];
  const untagged: number[] = [];
  for (const r of raw) {
    const t = tagByRules(r.text);
    if (!t.syndromes.length) untagged.push(visits.length);
    const hh = byId.get(r.household_id)!;
    visits.push({
      kind: "visit",
      visit_id: r.id,
      household_id: r.household_id,
      member_id: r.member_id,
      member_name: r.member_name,
      house_no: hh.house_no,
      village: r.village,
      ward: r.ward,
      sex: r.sex as "M" | "F",
      age_band: r.age_band,
      pregnant: r.pregnant,
      visit_at: r.visit_at,
      text: r.text,
      syndromes: t.syndromes,
      danger: t.danger,
      activities: activitiesFor(t.terms, { pregnant: r.pregnant, danger: t.danger }),
      tag_method: t.method,
      sync_class: visitSyncClass(t),
      sync_status: !t.syndromes.length ? "local" : daysSince(r.visit_at) > 3 ? "synced" : "pending",
      loc: { lat: hh.lat, lon: hh.lon },
      author_role: role,
      device_id: deviceId,
    });
  }
  if (untagged.length) {
    const vectors = await embed(untagged.map((i) => expand(visits[i].text)));
    for (const [k, i] of untagged.entries()) {
      const t = await tag(visits[i].text, vectors[k]);
      Object.assign(visits[i], { syndromes: t.syndromes, danger: t.danger, activities: activitiesFor(t.terms, { pregnant: visits[i].pregnant, danger: t.danger }), tag_method: t.method, sync_class: visitSyncClass(t), sync_status: t.syndromes.length ? "pending" : "local" });
    }
  }
  await bulkInsert(visits, (done) => onProgress(`Saving to Qdrant Edge ${done}/${visits.length}`, Math.round((done / visits.length) * 90)));
  const pending = visits.filter((v) => v.sync_status === "pending");
  for (const v of pending) {
    const signalId = await signalFor(v);
    await edge.setPayload("memory", v.visit_id, { signal_id: signalId });
  }
  onProgress("Optimising index", 95);
  await edge.optimize("memory");
  await logActivity("system", `Demo data: ${households.length} households, ${visits.length} visits (${pending.length} signals pending)`);
  onProgress("Done", 100);
}

export async function resetDevice() {
  await edge.reset("memory");
  await edge.reset("knowledge");
  await edge.storeClear();
}
