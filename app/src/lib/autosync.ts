// Sync when the network returns, when the app is opened, and every 10 minutes.
import { logActivity } from "./activity";
import { listOutbox } from "./outbox";
import { getSettings } from "./settings";
import { isOnline, runSync } from "./sync";

const EVERY_MS = 10 * 60_000;
let started = false;

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
}
