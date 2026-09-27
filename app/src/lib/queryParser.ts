// "garbhvati mahila Rampur pichle hafte" -> filters {pregnant, village, last 7 days} + "mahila".
import { anyOf, eq, since } from "./filters";
import { daysAgoIso } from "./time";
import { VILLAGES } from "./villages";

export interface Chip {
  id: string;
  label: string;
  cond: Record<string, unknown>;
}

interface Rule {
  id: string;
  re: RegExp;
  label: (m: RegExpMatchArray) => string;
  cond: (m: RegExpMatchArray) => Record<string, unknown>;
}

const RULES: Rule[] = [
  ...VILLAGES.map((v) => ({
    id: `village:${v.code}`,
    re: new RegExp(`\\b${v.name}\\b`, "i"),
    label: () => `गाँव · ${v.name}`,
    cond: () => eq("village", v.code),
  })),
  { id: "ward", re: /\bward\s*(\d+)\b|वार्ड\s*(\d+)/i, label: (m) => `Ward ${m[1] ?? m[2]}`, cond: (m) => eq("ward", m[1] ?? m[2]) },
  { id: "pregnant", re: /\b(pregnant|garbh[vw]ati)\b|गर्भवती/i, label: () => "गर्भवती · pregnant", cond: () => eq("pregnant", true) },
  { id: "newborn", re: /\b(newborn|navjat)\b|नवजात/i, label: () => "नवजात · newborn", cond: () => eq("age_band", "0-5") },
  { id: "child", re: /\b(child|children|bacch?[ae]|bachch?[ae]|kids?)\b|बच्च[ाे]/i, label: () => "बच्चे · children", cond: () => anyOf("age_band", ["0-5", "6-14"]) },
  { id: "danger", re: /\b(danger|khatra|urgent)\b|खतरा/i, label: () => "खतरा · danger", cond: () => eq("danger", true) },
  { id: "today", re: /\b(today|aaj)\b|आज/i, label: () => "आज · today", cond: () => since("visit_at", daysAgoIso(1)) },
  { id: "week", re: /\b(this week|last week|pichh?le hafte|is hafte)\b|पिछले हफ्ते|इस हफ्ते/i, label: () => "7 दिन · 7 days", cond: () => since("visit_at", daysAgoIso(7)) },
  { id: "month", re: /\b(this month|last month|is mahine|pichh?le mahine)\b|इस महीने|पिछले महीने/i, label: () => "30 दिन · 30 days", cond: () => since("visit_at", daysAgoIso(30)) },
  { id: "days", re: /\blast\s+(\d+)\s+days\b|\b(\d+)\s+din\b/i, label: (m) => `${m[1] ?? m[2]} दिन`, cond: (m) => since("visit_at", daysAgoIso(Number(m[1] ?? m[2]))) },
];

export function parseQuery(query: string): { text: string; chips: Chip[] } {
  let text = query;
  const chips: Chip[] = [];
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (!m) continue;
    chips.push({ id: rule.id, label: rule.label(m), cond: rule.cond(m) });
    if (rule.id.startsWith("village") || ["ward", "today", "week", "month", "days"].includes(rule.id)) {
      text = text.replace(m[0], " ");
    }
  }
  return { text: text.replace(/\s+/g, " ").trim() || query, chips };
}
