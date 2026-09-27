// Hindi / Hinglish / English normalisation; keep in sync with data/normalize.py.
// Appends canonical terms ("bukhar" -> "fever") and keeps the original words.
import lexicon from "../../../data/lexicon.json";

const variants: [string, string][] = Object.entries(lexicon.terms as Record<string, string[]>)
  .flatMap(([canonical, words]) => words.map((w) => [w.toLowerCase(), canonical] as [string, string]))
  .sort((a, b) => b[0].length - a[0].length);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = variants.map(([w, c]) => [new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${escape(w)}(?![\\p{L}\\p{N}\\p{M}])`, "gu"), c] as const);

// "no fever", "bukhar nahi", "बुखार नहीं" don't count.
const NEGATED_BEFORE = /(?:^|[^\p{L}\p{N}\p{M}])(no|not|without|koi)\s+$/u;
const NEGATED_AFTER = /^\s+(nahi|nahin|nahi\b|nai|na|नहीं|नही|ना)(?![\p{L}\p{N}\p{M}])/u;

// Longest phrases first, then blanked, so "खसरा का टीका" is a vaccine, not a rash.
export function canonicalTerms(text: string): string[] {
  let work = text.toLowerCase();
  const found: string[] = [];
  for (const [re, canonical] of patterns) {
    re.lastIndex = 0;
    let affirmed = false;
    work = work.replace(re, (m, ...args) => {
      const offset = args[args.length - 2] as number;
      const before = work.slice(Math.max(0, offset - 12), offset);
      const after = work.slice(offset + m.length, offset + m.length + 8);
      if (!NEGATED_BEFORE.test(before) && !NEGATED_AFTER.test(after)) affirmed = true;
      return " ".repeat(m.length);
    });
    if (affirmed && !found.includes(canonical)) found.push(canonical);
  }
  return found;
}

export function expand(text: string): string {
  const terms = canonicalTerms(text);
  return terms.length ? `${text} | ${terms.map((t) => t.replace(/_/g, " ")).join(" ")}` : text;
}

// Strips question framing ("... ko ... kya karein?") before answer matching.
const FRAME = lexicon.question_frame as { phrases: string[]; words: string[] };
const framePhrases = [...FRAME.phrases].map((p) => p.toLowerCase()).sort((a, b) => b.length - a.length);
const frameWords = new Set(FRAME.words.map((w) => w.toLowerCase()));

export function questionCore(text: string): string {
  let work = text.toLowerCase();
  for (const phrase of framePhrases) work = work.split(phrase).join(" ");
  const words = work.match(/\[[^\]]+\]|[\p{L}\p{N}\p{M}_-]+/gu) ?? [];
  const core = words.filter((w) => !frameWords.has(w)).join(" ");
  return core || text;
}


const NON_MEDICAL = new Set(["how_much", "give", "where", "what_to_do", "refer", "weeks", "dose", "child"]);
export const medicalTerms = (text: string) => canonicalTerms(text).filter((t) => !NON_MEDICAL.has(t));
