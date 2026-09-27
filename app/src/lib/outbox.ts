// Items waiting to be sent, highest priority first.
import { edge } from "./bridge";
import { emit } from "./events";
import type { OutboxItem } from "./types";

const DOC = "outbox";

export async function listOutbox(): Promise<OutboxItem[]> {
  const items = (await edge.storeGet<OutboxItem[]>(DOC)) ?? [];
  return items.sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));
}

async function save(items: OutboxItem[]) {
  await edge.storeSet(DOC, items);
  emit("outbox");
}

export async function enqueue(item: Omit<OutboxItem, "bytes" | "attempts">) {
  const items = await listOutbox();
  const full: OutboxItem = { ...item, attempts: 0, bytes: new Blob([JSON.stringify(item.payload)]).size };
  // Household edits collapse into one item per household.
  const i = items.findIndex((x) => x.id === item.id);
  if (i >= 0) items[i] = full;
  else items.push(full);
  await save(items);
}

export async function enqueueMany(batch: Omit<OutboxItem, "bytes" | "attempts">[]) {
  const items = await listOutbox();
  for (const item of batch) {
    items.push({ ...item, attempts: 0, bytes: new Blob([JSON.stringify(item.payload)]).size });
  }
  await save(items);
}

export async function removeFromOutbox(ids: string[]) {
  const drop = new Set(ids);
  await save((await listOutbox()).filter((x) => !drop.has(x.id)));
}

export async function bumpAttempts(ids: string[]) {
  const bump = new Set(ids);
  await save((await listOutbox()).map((x) => (bump.has(x.id) ? { ...x, attempts: x.attempts + 1 } : x)));
}
