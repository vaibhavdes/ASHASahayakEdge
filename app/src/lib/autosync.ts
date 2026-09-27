// Sync when the network returns, when the app is opened, and every 10 minutes.
// Local shards are compacted in the background at most once a day.
import { logActivity } from "./activity";
import { edge } from "./bridge";
import { listOutbox } from "./outbox";
import { getSettings } from "./settings";
import { isOnline, runSync } from "./sync";

const EVERY_MS = 10 * 60_000;
const OPTIMIZE_EVERY_MS = 24 * 60 * 60_000;
let started = false;

// Merges small segments and builds the vector index so search stays fast as notes pile up.
async function maintain() {
  const last = (await edge.storeGet<number>("optimized_at")) ?? 0;
  if (Date.now() - last < OPTIMIZE_EVERY_MS) return;
  for (const shard of ["memory", "knowledge", "state"] as const) await edge.optimize(shard).catch(() => false);
  await edge.storeSet("optimized_at", Date.now());
}

async function attempt(reason: string) {
  const s = await getSettings();
  if (!s.setupDone || !isOnline(s.network)) return;
  const waiting = (await listOutbox()).length;
  try {
    const r = await runSync();
    if (waiting || r.alerts || r.knowledge) await logActivity("sync", `auto-sync (${reason})`, r.ms);
  } catch {
    /* no server reachable right now: stay queued */
  }
}

export function startAutoSync() {
  if (started) return;
  started = true;
  window.addEventListener("online", () => attempt("network back"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") attempt("app opened");
  });
  setInterval(() => attempt("scheduled"), EVERY_MS);
  attempt("start");
  setTimeout(() => maintain().catch(() => {}), 30_000);
}
