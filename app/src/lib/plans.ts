// Visit lists built on the phone: what a district alert means for this village,
// and today's visits. Uses only local records.
import { edge } from "./bridge";
import { embedOne } from "./embedder";
import { emit } from "./events";
import { and, anyOf, eq, not, since } from "./filters";
import { allHouseholds } from "./households";
import { expand } from "./normalize";
import { syndromeLabel } from "./tagger";
import { daysAgoIso, daysSince } from "./time";
import type { Household, KnowledgeDoc, Member, Visit } from "./types";

export interface Task {
  id: string;
  household_id: string;
  house_no: string;
  member_id?: string;
  member_name?: string;
  /** 1 = today, 2 = soon, 3 = worth a look */
  priority: 1 | 2 | 3;
  why_hi: string;
  why_en: string;
  source: "alert" | "ai-match" | "danger" | "anc" | "immunization" | "recheck";
  distance_m?: number;
}

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

async function villageVisits(village: string, days: number, extra: ReturnType<typeof eq>[] = []) {
  const page = await edge.scroll<Visit>("memory", 1000, null, and(eq("kind", "visit"), eq("village", village), since("visit_at", daysAgoIso(days)), ...extra));
  return page.points.map((p) => p.payload);
}

/** Members with an MR (measles-rubella) vaccine anywhere in the visit history. */
async function mrVaccinated(village: string): Promise<Set<string>> {
  const page = await edge.scroll<Visit>("memory", 1000, null, and(eq("kind", "visit"), eq("village", village), eq("activities", "mr_vaccine")));
  return new Set(page.points.map((p) => p.payload.member_id));
}

function nearestCase(h: Household, cases: Visit[]) {
  let best = Infinity;
  for (const c of cases) if (c.loc) best = Math.min(best, km(h, c.loc) * 1000);
  return best;
}

function dedupe(tasks: Task[]) {
  const seen = new Map<string, Task>();
  for (const t of tasks) {
    const key = t.member_id ?? t.household_id;
    const prev = seen.get(key);
    if (!prev || t.priority < prev.priority) seen.set(key, t);
  }
  return [...seen.values()].sort((a, b) => a.priority - b.priority || (a.distance_m ?? 0) - (b.distance_m ?? 0));
}


export async function planForAlert(alert: KnowledgeDoc & { id: string }, village: string): Promise<Task[]> {
  const syndromes = (alert.topic ?? "").split(",").filter(Boolean);
  const households = Object.values(await allHouseholds()).filter((h) => h.village === village);
  const byId = new Map(households.map((h) => [h.id, h]));
  const tasks: Task[] = [];

  // Matching illness in the last 14 days; full pattern first.
  const cases = await villageVisits(village, 14, [anyOf("syndromes", syndromes)]);
  for (const v of cases) {
    const full = syndromes.every((s) => v.syndromes.includes(s));
    tasks.push({
      id: `${alert.id}:case:${v.member_id}`,
      household_id: v.household_id,
      house_no: v.house_no,
      member_id: v.member_id,
      member_name: v.member_name,
      priority: full ? 1 : 2,
      why_hi: `हाल में ${v.syndromes.map((s) => syndromeLabel(s, "hi")).join(" + ")} — दोबारा देखें`,
      why_en: `had ${v.syndromes.map((s) => syndromeLabel(s, "en")).join(" + ")} recently: follow up${full ? " today" : ""}`,
      source: "alert",
    });
  }

  // Measles: children with no MR vaccine on record, nearest first.
  if (syndromes.includes("rash")) {
    const vaccinated = await mrVaccinated(village);
    for (const h of households) {
      const kids = h.fields.members.value.filter((m: Member) => m.age >= 1 && m.age <= 15 && !vaccinated.has(m.id));
      const d = nearestCase(h, cases);
      for (const m of kids) {
        const priority = m.age > 5 ? 3 : d < 150 ? 1 : 2;
        tasks.push({
          id: `${alert.id}:mr:${m.id}`,
          household_id: h.id,
          house_no: h.house_no,
          member_id: m.id,
          member_name: m.name,
          priority,
          why_hi: "खसरा का टीका दर्ज नहीं — जांचें / टीका सत्र में लाएं",
          why_en: "no MR vaccine on record: check card, bring to the session",
          source: "alert",
          distance_m: Number.isFinite(d) ? Math.round(d) : undefined,
        });
      }
    }
  }

  // Diarrhoea / jaundice: small children and pregnant women near a case.
  if (syndromes.includes("diarrhoea") || syndromes.includes("jaundice")) {
    for (const h of households) {
      const d = nearestCase(h, cases);
      if (d > 400) continue;
      for (const m of h.fields.members.value) {
        const pregnant = h.fields.pregnant_member.value === m.id;
        if (m.age <= 5 || (pregnant && syndromes.includes("jaundice"))) {
          tasks.push({
            id: `${alert.id}:near:${m.id}`,
            household_id: h.id,
            house_no: h.house_no,
            member_id: m.id,
            member_name: m.name,
            priority: 2,
            why_hi: pregnant ? "गर्भवती, पास में पीलिया — जांच करें" : "पास के घर में केस — ORS, ज़िंक, साफ़ पानी बताएं",
            why_en: pregnant ? "pregnant, jaundice nearby: check (hepatitis E risk)" : "case next door: ORS, zinc, safe water",
            source: "alert",
            distance_m: Math.round(d),
          });
        }
      }
    }
  }

  // Untagged notes that read like the alert.
  const text = expand(`${alert.title}. ${alert.text}`);
  const similar = await edge.query<Visit>("memory", {
    dense: await embedOne(text),
    text,
    filter: not(and(eq("kind", "visit"), eq("village", village), since("visit_at", daysAgoIso(21))), anyOf("syndromes", syndromes)),
    limit: 8,
    mode: "dense",
    score_threshold: 0.45,
  });
  for (const hit of similar) {
    const v = hit.payload;
    tasks.push({
      id: `${alert.id}:ai:${v.member_id}`,
      household_id: v.household_id,
      house_no: v.house_no,
      member_id: v.member_id,
      member_name: v.member_name,
      priority: 3,
      why_hi: `नोट अलर्ट जैसा लगता है: "${v.text.slice(0, 50)}"`,
      why_en: `note sounds similar (AI match ${hit.score.toFixed(2)})`,
      source: "ai-match",
    });
  }

  return dedupe(tasks.filter((t) => byId.has(t.household_id)));
}


export async function todaysPlan(village: string): Promise<Task[]> {
  const households = Object.values(await allHouseholds()).filter((h) => h.village === village);
  const tasks: Task[] = [];

  for (const v of await villageVisits(village, 7, [eq("danger", true)])) {
    tasks.push({
      id: `danger:${v.visit_id}`,
      household_id: v.household_id,
      house_no: v.house_no,
      member_id: v.member_id,
      member_name: v.member_name,
      priority: 1,
      why_hi: "खतरे का संकेत था — रेफर हुआ? हाल पूछें",
      why_en: "danger sign this week: confirm referral, check on them",
      source: "danger",
    });
  }

  for (const v of await villageVisits(village, 3, [eq("syndromes", "fever")])) {
    tasks.push({
      id: `recheck:${v.visit_id}`,
      household_id: v.household_id,
      house_no: v.house_no,
      member_id: v.member_id,
      member_name: v.member_name,
      priority: 2,
      why_hi: "बुखार था — आज फिर देखें",
      why_en: "fever in the last 3 days: recheck",
      source: "recheck",
    });
  }

  const recentAnc = new Set((await villageVisits(village, 30, [eq("activities", "anc")])).map((v) => v.member_id));
  for (const h of households) {
    const pid = h.fields.pregnant_member.value;
    if (!pid) continue;
    const m = h.fields.members.value.find((x) => x.id === pid);
    const edd = h.fields.edd.value;
    const dueSoon = edd ? -daysSince(edd) <= 30 : false;
    if (h.fields.high_risk.value || dueSoon || !recentAnc.has(pid)) {
      tasks.push({
        id: `anc:${pid}`,
        household_id: h.id,
        house_no: h.house_no,
        member_id: pid,
        member_name: m?.name,
        priority: h.fields.high_risk.value || dueSoon ? 1 : 2,
        why_hi: dueSoon ? "प्रसव नज़दीक — अस्पताल की तैयारी" : h.fields.high_risk.value ? "हाई रिस्क गर्भावस्था — जांच" : "30 दिन से गर्भावस्था जांच नहीं",
        why_en: dueSoon ? "delivery within 30 days: birth preparedness" : h.fields.high_risk.value ? "high-risk pregnancy: check" : "no antenatal check in 30 days",
        source: "anc",
      });
    }
  }

  const recentImm = new Set((await villageVisits(village, 45, [eq("activities", "immunization")])).map((v) => v.member_id));
  for (const h of households) {
    for (const m of h.fields.members.value) {
      if (m.age <= 1 && !recentImm.has(m.id)) {
        tasks.push({
          id: `imm:${m.id}`,
          household_id: h.id,
          house_no: h.house_no,
          member_id: m.id,
          member_name: m.name,
          priority: 2,
          why_hi: "टीकाकरण बाकी हो सकता है — कार्ड देखें",
          why_en: "immunisation may be due: check the card",
          source: "immunization",
        });
      }
    }
  }
  return dedupe(tasks);
}

// ------------------------------- done ticks -------------------------------

export async function doneTasks(): Promise<Set<string>> {
  return new Set((await edge.storeGet<string[]>("tasks_done")) ?? []);
}

export async function markDone(id: string, done: boolean) {
  const set = await doneTasks();
  if (done) set.add(id);
  else set.delete(id);
  await edge.storeSet("tasks_done", [...set]);
  emit("households");
}
