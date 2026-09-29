// Push: outbox by priority (0 urgent, 1 signals, 2 registry/reports/questions).
// On a detected slow connection only urgent items go, without vectors.
// Pull: alerts, others' registry changes, answers, and new guidance (snapshot).
import { logActivity } from "./activity";
import { edge, isNative } from "./bridge";
import { emit } from "./events";
import { applyPushResult, mergeFromRegistry, type PushResult } from "./households";
import { and, anyOf, eq } from "./filters";
import { applyAnswers, markQuestionsSent, storeAlerts, upsertDocs } from "./knowledge";
import { bumpAttempts, listOutbox, removeFromOutbox } from "./outbox";
import { getSettings, updateSettings } from "./settings";
import { STARTER_IDS } from "./starter";
import { nowIso } from "./time";
import type { Alert, KnowledgeDoc, NetworkMode, OutboxItem } from "./types";

export function isOnline(mode: NetworkMode) {
  return mode !== "offline" && (typeof navigator === "undefined" || navigator.onLine);
}

async function call<T>(url: string, init: RequestInit & { timeoutMs: number }): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function slowConnection() {
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  return connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g";
}

function selectForPush(items: OutboxItem[], slow: boolean) {
  if (slow) return items.filter((i) => i.priority === 0 || i.kind === "retract").slice(0, 10);
  return items.slice(0, 200);
}

function wire(item: OutboxItem, slow: boolean) {
  if (item.kind === "signal" && slow) {
    const { vector_q8: _drop, ...lean } = item.payload as Record<string, unknown>;
    return lean;
  }
  return item.payload;
}

export interface SyncReport {
  pushed: number;
  bytes: number;
  conflicts: number;
  alerts: number;
  registry: number;
  knowledge: string | null;
  ms: number;
}

let inflight: Promise<SyncReport> | null = null;

// A tap on Sync while auto-sync is running joins that round instead of failing.
export function runSync(): Promise<SyncReport> {
  if (!inflight) inflight = syncOnce().finally(() => { inflight = null; });
  return inflight;
}

async function syncOnce(): Promise<SyncReport> {
  const t0 = performance.now();
  const s = await getSettings();
  if (!isOnline(s.network)) throw new Error("offline");
  if (!s.deviceToken) throw new Error("Phone is not enrolled. Complete setup before syncing.");
  const slow = slowConnection();
  const timeoutMs = slow ? 30_000 : 10_000;
  const headers = { Authorization: `Bearer ${s.deviceToken}` };
  const base = s.cloudUrl.replace(/\/$/, "");

  // ---------------- push ----------------
  const outbox = await listOutbox();
  const batch = selectForPush(outbox, slow);
  const signals = batch.filter((i) => i.kind === "signal").map((i) => wire(i, slow));
  const households = batch.filter((i) => i.kind === "household").map((i) => i.payload);
  const reports = batch.filter((i) => i.kind === "report").map((i) => i.payload);
  const questions = batch.filter((i) => i.kind === "question").map((i) => i.payload);
  const retractions = batch.filter((i) => i.kind === "retract").map((i) => i.payload.signal_id as string);
  const body = JSON.stringify({ device_id: s.deviceId, role: s.role, village: s.village, signals, households, reports, questions, retractions });
  let pushed = 0;
  let conflicts = 0;
  if (batch.length) {
    try {
      const res = await call<{ accepted_signals: string[]; accepted_reports: string[]; accepted_questions: string[]; accepted_retractions: string[]; households: PushResult }>(`${base}/v1/sync/push`, { method: "POST", body, timeoutMs, headers });
      const sentSignals = new Set(res.accepted_signals);
      const sent = batch.filter((i) => i.kind === "signal" && sentSignals.has(i.id));
      await removeFromOutbox([...sent.map((i) => i.id), ...res.accepted_reports, ...res.accepted_questions, ...(res.accepted_retractions ?? []).map((id) => `retract:${id}`)]);
      await markQuestionsSent(res.accepted_questions);
      await markVisitsSynced(sent.map((i) => i.ref).filter((r): r is string => !!r));
      await applyPushResult(res.households);
      pushed = sentSignals.size + res.households.accepted.length + res.accepted_reports.length + res.accepted_questions.length;
      conflicts = res.households.conflicts.length;
    } catch (err) {
      await bumpAttempts(batch.map((i) => i.id));
      throw err;
    }
  }

  // ---------------- pull ----------------
  let alerts = 0;
  let registry = 0;
  let knowledge: string | null = null;
  if (!slow || batch.length === 0) {
    const pull = await call<{ seq: number; alerts: Alert[]; households: never[]; answers: { question_id: string; title: string; text: string; answered_at: string }[]; knowledge_version: number }>(
      `${base}/v1/sync/pull?device_id=${encodeURIComponent(s.deviceId)}&village=${s.village}&since=${s.pullSeq}`,
      { method: "GET", timeoutMs, headers },
    );
    // Guidance first: a snapshot replaces the knowledge shard, and alerts are stored on top of it.
    if (pull.knowledge_version > s.knowledgeVersion && !slow) {
      knowledge = await receiveGuidance(() => keepAlerts(() => updateKnowledge(base, pull.knowledge_version, s.deviceToken)));
    }
    await storeAlerts(pull.alerts);
    await applyAnswers(pull.answers ?? []);
    alerts = pull.alerts.length;
    registry = await mergeFromRegistry(pull.households);
    await updateSettings({ pullSeq: pull.seq });
  }

  // Ack: lets the dashboard show which phones have an alert / guidance version.
  const after = await getSettings();
  await call(`${base}/v1/sync/ack`, {
    method: "POST",
    timeoutMs,
    headers,
    body: JSON.stringify({ device_id: s.deviceId, role: s.role, village: s.village, knowledge_version: after.knowledgeVersion, seq: after.pullSeq, pending: (await listOutbox()).length }),
  }).catch(() => undefined);

  const report: SyncReport = { pushed, bytes: new Blob([body]).size, conflicts, alerts, registry, knowledge, ms: Math.round(performance.now() - t0) };
  await updateSettings({ lastSync: nowIso() });
  await logActivity("sync", `sent ${pushed} (${report.bytes} B), ${alerts} alert(s), ${registry} registry update(s)${knowledge ? `, knowledge ${knowledge}` : ""}${conflicts ? `, ${conflicts} conflict(s)` : ""}`, report.ms);
  emit("sync", "outbox", "memory");
  return report;
}


async function markVisitsSynced(visitIds: string[]) {
  for (const id of visitIds) await edge.setPayload("memory", id, { sync_status: "synced" });
}

// ------------------------- new guidance from the district -------------------------

let guidanceUpdating = false;
export const isGuidanceUpdating = () => guidanceUpdating;

export interface NewGuidance {
  id: string;
  title: string;
  kind: string;
}

export async function newGuidance(): Promise<NewGuidance[]> {
  return (await edge.storeGet<NewGuidance[]>("new_guidance")) ?? [];
}

export async function dismissNewGuidance() {
  await edge.storeSet("new_guidance", []);
  emit("guidance");
}

async function guidanceDocs() {
  const { points } = await edge.scroll<KnowledgeDoc>("knowledge", 1000, null, and(anyOf("kind", ["protocol", "answer"])));
  return points;
}

// Shows progress while guidance downloads, then remembers what arrived so Home can list it.
async function receiveGuidance<T>(update: () => Promise<T>): Promise<T> {
  guidanceUpdating = true;
  emit("guidance");
  try {
    const before = new Set((await guidanceDocs()).map((p) => p.id));
    const result = await update();
    const titles = new Set((await newGuidance()).map((g) => g.title));
    const arrived: NewGuidance[] = [];
    for (const p of await guidanceDocs()) {
      if (before.has(p.id) || STARTER_IDS.has(p.id) || titles.has(p.payload.title)) continue;
      titles.add(p.payload.title);
      arrived.push({ id: p.id, title: p.payload.title, kind: p.payload.kind });
    }
    if (arrived.length) await edge.storeSet("new_guidance", [...arrived, ...(await newGuidance())].slice(0, 10));
    return result;
  } finally {
    guidanceUpdating = false;
    emit("guidance");
  }
}

// District alerts live only on the phone; the server's guidance snapshot does not contain them.
async function keepAlerts<T>(update: () => Promise<T>): Promise<T> {
  const { points } = await edge.scroll<KnowledgeDoc>("knowledge", 500, null, and(eq("kind", "alert")));
  const result = await update();
  if (points.length) await upsertDocs(points.map((p) => ({ ...p.payload, id: p.id })));
  return result;
}

async function updateKnowledge(base: string, version: number, token: string): Promise<string> {
  const headers = { Authorization: `Bearer ${token}` };
  if (isNative) {
    // Partial snapshot from our manifest; full snapshot if that fails.
    try {
      const manifest = await edge.manifest("knowledge");
      const partial = await call<{ url: string }>(`${base}/v1/knowledge/partial-snapshot`, { method: "POST", body: JSON.stringify({ manifest }), timeoutMs: 60_000, headers });
      const res = await edge.applySnapshot("knowledge", `${base}${partial.url}`, token);
      await updateSettings({ knowledgeVersion: version, knowledgeSyncedAt: nowIso() });
      return `v${version} via Qdrant partial snapshot (${res.mode}, ${res.points} points)`;
    } catch (err) {
      await logActivity("knowledge", `partial snapshot unavailable (${err}); trying full snapshot`);
    }
    try {
      const res = await edge.applySnapshot("knowledge", `${base}/v1/knowledge/snapshot?version=${version}`, token);
      await updateSettings({ knowledgeVersion: version, knowledgeSyncedAt: nowIso() });
      return `v${version} via Qdrant snapshot (${res.mode}, ${res.points} points)`;
    } catch (err) {
      await logActivity("knowledge", `snapshot failed, using document fallback: ${err}`);
    }
  }
  const docs = await call<{ version: number; docs: (KnowledgeDoc & { id: string })[] }>(`${base}/v1/knowledge/docs`, { method: "GET", timeoutMs: 30_000, headers });
  await upsertDocs(docs.docs);
  await updateSettings({ knowledgeVersion: docs.version, knowledgeSyncedAt: nowIso() });
  return `v${docs.version} via documents (${docs.docs.length})`;
}
