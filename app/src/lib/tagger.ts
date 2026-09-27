// Syndrome tagging: lexicon rules first, then similarity to prototype sentences.
import { lang, type Lang } from "./i18n";
import lexicon from "../../../data/lexicon.json";
import { embed } from "./embedder";
import { canonicalTerms } from "./normalize";

interface SyndromeDef {
  label_en: string;
  label_hi: string;
  all: string[];
  any?: string[];
  danger?: boolean;
}

export const SYNDROMES = lexicon.syndromes as Record<string, SyndromeDef>;

interface ActivityDef {
  label_en: string;
  label_hi: string;
  any: string[];
  pregnant_member?: boolean;
  danger?: boolean;
}
export const ACTIVITIES = Object.fromEntries(
  Object.entries(lexicon.activities as Record<string, ActivityDef | string>).filter(([k]) => !k.startsWith("_")),
) as Record<string, ActivityDef>;

export function activitiesFor(terms: string[], ctx: { pregnant: boolean; danger: boolean }): string[] {
  return Object.entries(ACTIVITIES)
    .filter(([, d]) => d.any.some((t) => terms.includes(t)) || (d.pregnant_member && ctx.pregnant) || (d.danger && ctx.danger))
    .map(([name]) => name);
}
const PROTOTYPES = lexicon.prototypes as Record<string, string[]>;
const AI_THRESHOLD = 0.62;

let protoVectors: { syndrome: string; vector: number[] }[] | null = null;

async function prototypes() {
  if (protoVectors) return protoVectors;
  const entries = Object.entries(PROTOTYPES).flatMap(([s, texts]) => texts.map((t) => ({ s, t })));
  const vectors = await embed(entries.map((e) => e.t));
  protoVectors = entries.map((e, i) => ({ syndrome: e.s, vector: vectors[i] }));
  return protoVectors;
}

export interface Tagging {
  syndromes: string[];
  danger: boolean;
  method: "rule" | "ai" | "none";
  terms: string[];
}

export function tagByRules(text: string): Tagging {
  const terms = canonicalTerms(text);
  const syndromes = Object.entries(SYNDROMES)
    .filter(([, d]) => d.all.every((t) => terms.includes(t)) && (!d.any?.length || d.any.some((t) => terms.includes(t))))
    .map(([name]) => name);
  return {
    syndromes,
    danger: syndromes.some((s) => SYNDROMES[s].danger),
    method: syndromes.length ? "rule" : "none",
    terms,
  };
}

// Notes about routine work only ("teeka lagaya, sab theek") are not guessed into symptoms.
const ROUTINE_TERMS = new Set(["vaccination", "mr_vaccine", "breastfeeding", "give", "dose"]);

export async function tag(text: string, vector?: number[]): Promise<Tagging> {
  const ruled = tagByRules(text);
  if (ruled.syndromes.length) return ruled;
  if (ruled.terms.some((t) => ROUTINE_TERMS.has(t))) return ruled;
  const v = vector ?? (await embed([text]))[0];
  const best = new Map<string, number>();
  for (const p of await prototypes()) {
    const sim = p.vector.reduce((s, x, i) => s + x * v[i], 0);
    best.set(p.syndrome, Math.max(best.get(p.syndrome) ?? 0, sim));
  }
  const syndromes = [...best].filter(([, s]) => s >= AI_THRESHOLD).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([s]) => s);
  return {
    syndromes,
    danger: syndromes.some((s) => SYNDROMES[s]?.danger),
    method: syndromes.length ? "ai" : "none",
    terms: ruled.terms,
  };
}

export const syndromeLabel = (s: string, language: Lang = lang()) =>
  SYNDROMES[s] ? (language === "hi" ? SYNDROMES[s].label_hi : SYNDROMES[s].label_en) : s;
