// Weekly IDSP S-form and monthly summary, counted from visit memory. Only counts are sent.
import { logActivity } from "./activity";
import { edge } from "./bridge";
import { emit } from "./events";
import { and, between, eq } from "./filters";
import { enqueue } from "./outbox";
import { isoWeek, nowIso } from "./time";
import type { Visit } from "./types";

export interface Period {
  id: string;
  label: string;
  from: string;
  to: string;
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export function weekPeriod(offset = 0): Period {
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7) - 7 * offset));
  const sunday = new Date(monday.getTime() + 7 * 86_400_000 - 1000);
  return { id: isoWeek(monday), label: `${monday.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${sunday.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`, from: iso(monday), to: iso(sunday) };
}

export function monthPeriod(offset = 0): Period {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 1) - 1000);
  return { id: first.toISOString().slice(0, 7), label: first.toLocaleDateString("en-IN", { month: "long", year: "numeric" }), from: iso(first), to: iso(last) };
}

async function visitsIn(village: string, p: Period): Promise<Visit[]> {
  const page = await edge.scroll<Visit>("memory", 2000, null, and(eq("kind", "visit"), eq("village", village), between("visit_at", p.from, p.to)));
  return page.points.map((x) => x.payload);
}

export const S_FORM_ROWS = [
  { key: "fever", hi: "बुखार (बिना दाने)", en: "Fever without rash", match: (v: Visit) => v.syndromes.includes("fever") && !v.syndromes.includes("rash") },
  { key: "fever_rash", hi: "बुखार के साथ दाने", en: "Fever with rash", match: (v: Visit) => v.syndromes.includes("fever") && v.syndromes.includes("rash") },
  { key: "diarrhoea", hi: "पतले दस्त", en: "Loose watery stools", match: (v: Visit) => v.syndromes.includes("diarrhoea") },
  { key: "cough_2w", hi: "2 हफ्ते से ज़्यादा खांसी", en: "Cough more than 2 weeks", match: (v: Visit) => v.syndromes.includes("cough_2w") },
  { key: "jaundice", hi: "पीलिया", en: "Jaundice", match: (v: Visit) => v.syndromes.includes("jaundice") },
  { key: "danger_pregnancy", hi: "गर्भावस्था खतरा", en: "Pregnancy danger signs", match: (v: Visit) => v.syndromes.includes("danger_pregnancy") },
  { key: "danger_newborn", hi: "नवजात खतरा", en: "Newborn danger signs", match: (v: Visit) => v.syndromes.includes("danger_newborn") },
] as const;

export interface SFormRow {
  key: string;
  under5: number;
  over5: number;
}

export async function sForm(village: string, p: Period): Promise<{ rows: SFormRow[]; visits: number }> {
  const visits = await visitsIn(village, p);
  const rows = S_FORM_ROWS.map((r) => {
    // Count people, not visits.
    const people = new Map<string, Visit>();
    for (const v of visits) if (r.match(v)) people.set(v.member_id, v);
    const list = [...people.values()];
    return { key: r.key, under5: list.filter((v) => v.age_band === "0-5").length, over5: list.filter((v) => v.age_band !== "0-5").length };
  });
  return { rows, visits: visits.length };
}

export const MONTH_ROWS = [
  { key: "visits", hi: "कुल विज़िट", en: "Home visits" },
  { key: "households", hi: "परिवार जिनसे मिले", en: "Households visited" },
  { key: "anc", hi: "गर्भावस्था जांच", en: "Antenatal checks" },
  { key: "immunization", hi: "टीकाकरण", en: "Immunisation visits" },
  { key: "mr_vaccine", hi: "खसरा-रूबेला टीका", en: "MR vaccines recorded" },
  { key: "newborn_care", hi: "नवजात देखभाल", en: "Newborn care visits" },
  { key: "danger", hi: "खतरे के संकेत", en: "Danger signs found" },
  { key: "referral", hi: "रेफर", en: "Referrals" },
] as const;

export async function monthlySummary(village: string, p: Period): Promise<Record<string, number>> {
  const visits = await visitsIn(village, p);
  const has = (a: string) => visits.filter((v) => (v.activities ?? []).includes(a)).length;
  return {
    visits: visits.length,
    households: new Set(visits.map((v) => v.household_id)).size,
    anc: has("anc"),
    immunization: has("immunization"),
    mr_vaccine: has("mr_vaccine"),
    newborn_care: has("newborn_care"),
    danger: visits.filter((v) => v.danger).length,
    referral: has("referral"),
  };
}

export async function submitReport(kind: "s_form" | "monthly", village: string, p: Period, data: unknown, extra: Record<string, unknown> = {}) {
  const id = `report:${kind}:${village}:${p.id}`;
  await enqueue({
    id,
    kind: "report",
    priority: 2,
    created_at: nowIso(),
    label: `${kind === "s_form" ? "S-form" : "Monthly summary"} · ${p.label}`,
    payload: { id, kind, village, period: p.id, from: p.from, to: p.to, data, ...extra, submitted_at: nowIso() },
  });
  const sent = (await edge.storeGet<string[]>("reports_submitted")) ?? [];
  if (!sent.includes(id)) await edge.storeSet("reports_submitted", [...sent, id]);
  await logActivity("sync", `${kind === "s_form" ? "S-form" : "Monthly summary"} ${p.label} queued (counts only)`);
  emit("outbox");
}

export async function submittedReports(): Promise<Set<string>> {
  return new Set((await edge.storeGet<string[]>("reports_submitted")) ?? []);
}
