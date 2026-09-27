// This week vs the previous six, for this village, computed on the phone.
import { edge } from "./bridge";
import { and, eq, since } from "./filters";
import { daysAgoIso, isoWeek } from "./time";
import type { Visit } from "./types";

export interface LocalAnomaly {
  key: string; // "fever+rash", "diarrhoea", ...
  syndromes: string[];
  count: number;
  usual: number;
  z: number;
}

const PATTERNS: { key: string; syndromes: string[]; match: (s: string[]) => boolean }[] = [
  { key: "fever+rash", syndromes: ["fever", "rash"], match: (s) => s.includes("fever") && s.includes("rash") },
  { key: "diarrhoea", syndromes: ["diarrhoea"], match: (s) => s.includes("diarrhoea") },
  { key: "jaundice", syndromes: ["jaundice"], match: (s) => s.includes("jaundice") },
  { key: "fever", syndromes: ["fever"], match: (s) => s.includes("fever") && !s.includes("rash") },
];

export async function localAnomalies(village: string, weeks = 6): Promise<LocalAnomaly[]> {
  const page = await edge.scroll<Visit>("memory", 3000, null, and(eq("kind", "visit"), eq("village", village), since("visit_at", daysAgoIso(7 * (weeks + 1)))));
  const visits = page.points.map((p) => p.payload);
  const current = isoWeek(new Date());
  const pastWeeks = Array.from({ length: weeks }, (_, i) => isoWeek(new Date(Date.now() - (i + 1) * 7 * 86_400_000)));
  const out: LocalAnomaly[] = [];
  for (const p of PATTERNS) {
    const perWeek = new Map<string, Set<string>>();
    for (const v of visits) {
      if (!p.match(v.syndromes)) continue;
      const w = isoWeek(v.visit_at);
      if (!perWeek.has(w)) perWeek.set(w, new Set());
      perWeek.get(w)!.add(v.member_id);
    }
    const count = perWeek.get(current)?.size ?? 0;
    const history = pastWeeks.map((w) => perWeek.get(w)?.size ?? 0);
    const usual = history.reduce((a, b) => a + b, 0) / history.length;
    const sd = Math.sqrt(history.reduce((a, b) => a + (b - usual) ** 2, 0) / history.length);
    const z = (count - usual) / Math.max(sd, 1);
    if (history.filter((n) => n > 0).length >= 3 && count >= 3 && z >= 2) out.push({ key: p.key, syndromes: p.syndromes, count, usual: Math.round(usual * 10) / 10, z: Math.round(z * 10) / 10 });
  }
  return out.sort((a, b) => b.z - a.z);
}
