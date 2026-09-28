// Hindi / Hinglish / English normalisation; keep in sync with data/normalize.py.
// Appends canonical terms ("bukhar" -> "fever") and keeps the original words.
import lexicon from "../../../data/lexicon.json";

const NUKTA = /\u093c/g; // "बुख़ार" and "बुखार" are the same word

/** Spelling-insensitive key for Hinglish: bukhar, bukhaar, bukar and bhukaar all become "bukar". */
export function soundKey(word: string): string {
  return word
    .replace(/ee/g, "i").replace(/oo/g, "u").replace(/z/g, "j")
    .replace(/([bcdgjkpt])h/g, "$1")
    .replace(/sh/g, "s").replace(/w/g, "v").replace(/q/g, "k").replace(/y/g, "i")
    .replace(/n(?=[sgkjdt])/g, "")
    .replace(/(.)\1+/g, "$1");
}

const TERMS = lexicon.terms as Record<string, string[]>;

// Sound keys of single Latin words; a key shared by two terms is ambiguous and dropped.
const soundTerms = (() => {
  const keys = new Map<string, Set<string>>();
  for (const [canonical, words] of Object.entries(TERMS)) {
    for (const w of words.map((x) => x.toLowerCase())) {
      if (!/^[a-z]{4,}$/.test(w) || soundKey(w).length < 4) continue;
      const k = soundKey(w);
      if (!keys.has(k)) keys.set(k, new Set());
      keys.get(k)!.add(canonical);
    }
  }
  return new Map([...keys].filter(([, c]) => c.size === 1).map(([k, c]) => [k, [...c][0]]));
})();

const variants: [string, string][] = Object.entries(TERMS)
  .flatMap(([canonical, words]) => words.map((w) => [w.toLowerCase().replace(NUKTA, ""), canonical] as [string, string]))
  .sort((a, b) => b[0].length - a[0].length);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = variants.map(([w, c]) => [new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${escape(w)}(?![\\p{L}\\p{N}\\p{M}])`, "gu"), c] as const);

// "no fever", "bukhar nahi", "बुखार नहीं" don't count.
const NEGATED_BEFORE = /(?:^|[^\p{L}\p{N}\p{M}])(no|not|without|koi)\s+$/u;
const NEGATED_AFTER = /^\s+(nahi|nahin|nahi\b|nai|na|नहीं|नही|ना)(?![\p{L}\p{N}\p{M}])/u;

// Longest phrases first, then blanked, so "खसरा का टीका" is a vaccine, not a rash.
export function canonicalTerms(text: string): string[] {
  let work = text.toLowerCase().replace(NUKTA, "");
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
  // Then spelling variants of single words ("bukar", "bhukhar", "khaasi").
  for (const m of work.matchAll(/(?<![\p{L}\p{N}\p{M}])[a-z]{4,}(?![\p{L}\p{N}\p{M}])/gu)) {
    const canonical = soundTerms.get(soundKey(m[0]));
    if (!canonical || found.includes(canonical)) continue;
    const at = m.index ?? 0;
    const before = work.slice(Math.max(0, at - 12), at);
    const after = work.slice(at + m[0].length, at + m[0].length + 8);
    if (!NEGATED_BEFORE.test(before) && !NEGATED_AFTER.test(after)) found.push(canonical);
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
