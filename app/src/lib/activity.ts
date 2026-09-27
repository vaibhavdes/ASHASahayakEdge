import { edge } from "./bridge";
import { emit } from "./events";
import { nowIso } from "./time";
import type { ActivityEntry } from "./types";

const MAX = 300;

export async function logActivity(type: ActivityEntry["type"], text: string, ms?: number) {
  const list = (await edge.storeGet<ActivityEntry[]>("activity")) ?? [];
  list.unshift({ at: nowIso(), type, text, ms });
  await edge.storeSet("activity", list.slice(0, MAX));
  emit("activity");
}

export async function getActivity(): Promise<ActivityEntry[]> {
  return (await edge.storeGet<ActivityEntry[]>("activity")) ?? [];
}
