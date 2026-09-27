// The "knowledge" shard: protocols, approved answers and alerts, published by the district.
import { logActivity } from "./activity";
import { edge } from "./bridge";
import { embed, embedOne } from "./embedder";
import { emit } from "./events";
import { and, anyOf, eq } from "./filters";
import { allHouseholds } from "./households";
import { enqueue } from "./outbox";
import { expand, medicalTerms, questionCore } from "./normalize";
import { nowIso } from "./time";
import type { Alert, Hit, KnowledgeDoc, MyQuestion } from "./types";

// Approved-answer cache. One point per approved phrasing, matched question to
// question without framing words. Held-out tests: right answers 0.76-0.98,
// closest wrong 0.69. Both questions must share a medical term; with none, 0.90
// (an unknown word like "MUAC" once matched an unrelated answer at 0.85).
export const ANSWER_CACHE_THRESHOLD = 0.7;
const NO_TERMS_THRESHOLD = 0.9;
// Guidance below this meaning similarity is unrelated (measured: related 0.25+, unrelated under 0.2).
const PASSAGE_MIN_SIMILARITY = 0.22;


export const embedText = (d: Pick<KnowledgeDoc, "kind" | "title" | "text" | "question">) =>
  d.kind === "answer" ? expand(questionCore(d.question ?? d.title)) : expand(`${d.title}. ${d.text}`);

function answerIsSafe(question: string, hit: Hit<KnowledgeDoc>): boolean {
  const asked = medicalTerms(question);
  const known = medicalTerms(hit.payload.question ?? hit.payload.title);
  if (!asked.length) return hit.score >= NO_TERMS_THRESHOLD;
  if (known.length && !asked.some((t) => known.includes(t))) return false;
  return true;
}


export function answerVariants<T extends { id: string; title: string; alt_questions?: string[] }>(a: T) {
  const { alt_questions = [], ...rest } = a;
  return [a.title, ...alt_questions].map((question, i) => ({
    ...rest,
    id: i === 0 ? a.id : a.id.replace(/^(\w{8})-\w{4}/, `$1-${String(i).padStart(4, "0")}`),
    question,
  }));
}

export interface AskResult {
  answer: Hit<KnowledgeDoc> | null;
  passages: Hit<KnowledgeDoc>[];
  ms: number;
}

export async function ask(question: string): Promise<AskResult> {
  const t0 = performance.now();
  const text = expand(question);
  const dense = await embedOne(text);
  const core = expand(questionCore(question));
  const [candidate] = await edge.query<KnowledgeDoc>("knowledge", {
    dense: core === text ? dense : await embedOne(core),
    text: core,
    filter: and(eq("kind", "answer")),
    limit: 1,
    mode: "dense",
    score_threshold: ANSWER_CACHE_THRESHOLD,
  });
  const answer = candidate && answerIsSafe(question, candidate) ? candidate : undefined;
  const guidance = and(anyOf("kind", ["protocol", "alert"]));
  const [ranked, related] = await Promise.all([
    edge.query<KnowledgeDoc>("knowledge", { dense, text, filter: guidance, limit: 5, mode: "hybrid", weights: [2, 1] }),
    edge.query<KnowledgeDoc>("knowledge", { dense, text, filter: guidance, limit: 10, mode: "dense", score_threshold: PASSAGE_MIN_SIMILARITY }),
  ]);
  const relatedIds = new Set(related.map((h) => h.id));
  const passages = ranked.filter((h) => relatedIds.has(h.id));
  const ms = Math.round(performance.now() - t0);
  await logActivity("knowledge", `ask "${question}" → ${answer ? "approved answer" : `${passages.length} passages`}`, ms);
  return { answer: answer ?? null, passages, ms };
}

export async function upsertDocs(docs: (KnowledgeDoc & { id: string })[]) {
  const BATCH = 16;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    const texts = batch.map(embedText);
    const vectors = await embed(texts);
    await edge.upsert(
      "knowledge",
      batch.map((d, j) => {
        const { id, ...payload } = d;
        return { id, dense: vectors[j], text: texts[j], payload: payload as never };
      }),
    );
  }
}

// Alerts are stored in the shard so they stay searchable offline.
export async function storeAlerts(alerts: Alert[]) {
  if (!alerts.length) return;
  await upsertDocs(
    alerts.map((a) => ({
      id: a.id,
      kind: "alert",
      title: a.title,
      text: a.text,
      source: "District surveillance",
      severity: a.severity,
      villages: a.villages,
      topic: a.syndromes.join(","),
      published_at: a.created_at,
      expires_at: a.expires_at ?? null,
    })),
  );
  await logActivity("alert", `${alerts.length} alert(s) received: ${alerts.map((a) => a.title).join("; ")}`);
  emit("alerts");
}

export async function activeAlerts(village: string): Promise<(KnowledgeDoc & { id: string })[]> {
  const page = await edge.scroll<KnowledgeDoc>("knowledge", 50, null, and(eq("kind", "alert"), eq("villages", village)));
  const now = nowIso();
  return page.points
    .map((p) => ({ id: p.id, ...p.payload }))
    .filter((a) => !a.expires_at || a.expires_at > now)
    .sort((a, b) => b.published_at.localeCompare(a.published_at));
}

export const isExpired = (doc: KnowledgeDoc) => !!doc.expires_at && doc.expires_at < nowIso();

// ------------------------------ ask a doctor ------------------------------

// A best-effort starting point for a human-reviewed question. It is not a privacy boundary.
export async function scrubQuestion(question: string): Promise<string> {
  const names = Object.values(await allHouseholds())
    .flatMap((h) => [h.fields.head.value, ...h.fields.members.value.map((m) => m.name)])
    .flatMap((n) => [n, ...n.split(" ")])
    .filter((n) => n && n.length >= 3)
    .sort((a, b) => b.length - a.length);
  let out = question;
  for (const n of new Set(names)) out = out.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[नाम]");
  return out
    .replace(/\b\d{6,}\b/g, "[नंबर]")
    .replace(/\b[A-Z]{3}-\d{2,4}\b/g, "[घर]")
    .trim();
}

export async function myQuestions(): Promise<MyQuestion[]> {
  return (await edge.storeGet<MyQuestion[]>("my_questions")) ?? [];
}

async function saveQuestions(list: MyQuestion[]) {
  await edge.storeSet("my_questions", list);
  emit("alerts");
}

export async function askDoctor(question: string, village: string) {
  // The caller must show an editable preview and ask the worker to check it.
  const clean = question.trim();
  const q: MyQuestion = { id: crypto.randomUUID(), question: clean, asked_at: nowIso(), status: "queued" };
  await enqueue({ id: q.id, kind: "question", priority: 2, created_at: q.asked_at, label: `Question: ${clean.slice(0, 40)}`, payload: { id: q.id, village, question: clean, asked_at: q.asked_at } });
  await saveQuestions([q, ...(await myQuestions())]);
  await logActivity("knowledge", `question for a doctor queued: "${clean}"`);
  return q;
}

export async function markQuestionsSent(ids: string[]) {
  if (!ids.length) return;
  const set = new Set(ids);
  await saveQuestions((await myQuestions()).map((q) => (set.has(q.id) && q.status === "queued" ? { ...q, status: "sent" } : q)));
}

export async function applyAnswers(answers: { question_id: string; title: string; text: string; answered_at: string }[]) {
  if (!answers.length) return;
  const byId = new Map(answers.map((a) => [a.question_id, a]));
  await saveQuestions(
    (await myQuestions()).map((q) => {
      const a = byId.get(q.id);
      return a ? { ...q, status: "answered", answer_title: a.title, answer_text: a.text, answered_at: a.answered_at } : q;
    }),
  );
  await logActivity("knowledge", `${answers.length} question(s) answered by a doctor`);
}
