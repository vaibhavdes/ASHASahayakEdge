// Bundled starter guidance for an empty phone. These are reference examples,
// not a substitute for clinical review.
import knowledge from "../../../data/knowledge.json";
import { edge } from "./bridge";
import { answerVariants, upsertDocs } from "./knowledge";
import type { KnowledgeDoc } from "./types";

export async function loadStarterKnowledge() {
  const published = "2026-09-01T00:00:00Z";
  const docs: (KnowledgeDoc & { id: string })[] = [
    ...knowledge.protocols.map((p) => ({ ...p, kind: "protocol" as const, published_at: published, version: knowledge.version })),
    ...knowledge.answers.flatMap((a) =>
      answerVariants(a).map((v) => ({ ...v, kind: "answer" as const, source: "Starter reference (example)", published_at: published, version: knowledge.version })),
    ),
  ];
  await upsertDocs(docs);
}

export async function resetDevice() {
  await edge.reset("memory");
  await edge.reset("knowledge");
  await edge.storeClear();
}
