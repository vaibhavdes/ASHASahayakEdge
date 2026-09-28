import { edge } from "./bridge";
import type { Lang } from "./i18n";
import type { NetworkMode, Role } from "./types";

export interface Settings {
  setupDone: boolean;
  deviceId: string;
  deviceToken: string;
  role: Role;
  name: string;
  village: string;
  cloudUrl: string;
  network: NetworkMode;
  lang: Lang;
  lastSync: string | null;
  knowledgeVersion: number;
  knowledgeSyncedAt: string | null;
  pullSeq: number;
}

const DEFAULTS: Settings = {
  setupDone: false,
  deviceId: "",
  deviceToken: "",
  role: "ASHA",
  name: "",
  village: "MDH",
  cloudUrl: import.meta.env.VITE_CLOUD_URL || "https://sahayak-cloud-362605925833.asia-south1.run.app",
  network: "online",
  lang: "hi",
  lastSync: null,
  knowledgeVersion: 0,
  knowledgeSyncedAt: null,
  pullSeq: 0,
};

let cache: Settings | null = null;
const listeners = new Set<() => void>();

export async function getSettings(): Promise<Settings> {
  if (!cache) {
    cache = { ...DEFAULTS, ...((await edge.storeGet<Partial<Settings>>("settings")) ?? {}) };
    if (cache.network === "2g") cache.network = "online";
  }
  return cache;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  cache = { ...(await getSettings()), ...patch };
  await edge.storeSet("settings", cache);
  listeners.forEach((l) => l());
  return cache;
}

export function onSettings(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetSettingsCache() {
  cache = null;
}
