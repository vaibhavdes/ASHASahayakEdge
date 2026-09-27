// Change notifications: data modules emit, screens reload.
type Topic = "memory" | "outbox" | "households" | "alerts" | "activity" | "sync";

const listeners = new Map<Topic, Set<() => void>>();

export function emit(...topics: Topic[]) {
  for (const t of topics) listeners.get(t)?.forEach((l) => l());
}

export function on(topic: Topic, listener: () => void) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic)!.add(listener);
  return () => listeners.get(topic)!.delete(listener);
}
