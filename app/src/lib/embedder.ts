// Main-thread client for the embedding worker.
type Progress = { file?: string; loaded?: number; total?: number; status?: string };

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: number[][]) => void; reject: (e: Error) => void }>();

export function loadModel(onProgress?: (pct: number, label: string) => void): Promise<void> {
  if (ready) return ready;
  worker = new Worker(new URL("./embed.worker.ts", import.meta.url), { type: "module" });
  const files = new Map<string, { loaded: number; total: number }>();
  ready = new Promise((resolve, reject) => {
    worker!.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") {
        const p = m.progress as Progress;
        if (p.file && p.total) files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
        const loaded = [...files.values()].reduce((s, f) => s + f.loaded, 0);
        const total = [...files.values()].reduce((s, f) => s + f.total, 0);
        onProgress?.(total ? Math.round((loaded / total) * 100) : 0, p.file ?? p.status ?? "");
      } else if (m.type === "ready") {
        resolve();
      } else if (m.type === "vectors") {
        pending.get(m.id)?.resolve(m.vectors);
        pending.delete(m.id);
      } else if (m.type === "error") {
        if (m.id != null && pending.has(m.id)) {
          pending.get(m.id)!.reject(new Error(m.error));
          pending.delete(m.id);
        } else {
          ready = null;
          reject(new Error(m.error));
        }
      }
    };
  });
  worker.postMessage({ type: "load" });
  return ready;
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (!ready) throw new Error("AI model not loaded yet");
  await ready;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ type: "embed", id, texts });
  });
}

export async function embedOne(text: string): Promise<number[]> {
  return (await embed([text]))[0];
}

export const isModelLoaded = () => ready !== null;
