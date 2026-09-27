import { edge } from "./bridge";
import type { NetworkMode, Role } from "./types";

export interface Settings {
  setupDone: boolean;
  deviceId: string;
  role: Role;
  name: string;
  village: string;
  cloudUrl: string;
  modelSource: "huggingface" | "cloud";
  network: NetworkMode;
  lastSync: string | null;
  knowledgeVersion: number;
  knowledgeSyncedAt: string | null;
  pullSeq: number;
}

const DEFAULTS: Settings = {
  setupDone: false,
  deviceId: "",
  role: "ASHA",
  name: "",
  village: "RMP",
  cloudUrl: import.meta.env.VITE_CLOUD_URL ?? "http://192.168.1.10:8000",
  modelSource: "huggingface",
  network: "online",
  lastSync: null,
  knowledgeVersion: 0,
  knowledgeSyncedAt: null,
  pullSeq: 0,
};

let cache: Settings | null = null;
const listeners = new Set<() => void>();

export async function getSettings(): Promise<Settings> {
  if (!cache) cache = { ...DEFAULTS, ...((await edge.storeGet<Partial<Settings>>("settings")) ?? {}) };
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
