// UI <-> device. In the app, calls go to Rust (Qdrant Edge + file store).
// In a browser (`npm run dev`) a simple stand-in is used for UI work.
import { invoke } from "@tauri-apps/api/core";
import type { Filter, Hit, PointIn, QueryIn, Shard, ShardInfo } from "./types";

export const isNative = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface Bridge {
  upsert(shard: Shard, points: PointIn[]): Promise<number>;
  setPayload(shard: Shard, id: string, patch: Record<string, unknown>): Promise<void>;
  remove(shard: Shard, ids: string[]): Promise<void>;
  query<P = Record<string, any>>(shard: Shard, query: QueryIn): Promise<Hit<P>[]>;
  similar<P = Record<string, any>>(shard: Shard, id: string, filter: Filter | null, limit: number): Promise<Hit<P>[]>;
  facet(shard: Shard, key: string, filter: Filter | null, limit: number): Promise<{ value: string | number | boolean; count: number }[]>;
  count(shard: Shard, filter: Filter | null): Promise<number>;
  scroll<P = Record<string, any>>(shard: Shard, limit: number, offset: string | null, filter: Filter | null): Promise<{ points: { id: string; payload: P }[]; next: string | null }>;
  retrieve<P = Record<string, any>>(shard: Shard, ids: string[]): Promise<{ id: string; payload: P }[]>;
  info(shard: Shard): Promise<ShardInfo>;
  optimize(shard: Shard): Promise<boolean>;
  reset(shard: Shard): Promise<void>;
  applySnapshot(shard: Shard, url: string): Promise<{ mode: string; points: number }>;
  manifest(shard: Shard): Promise<unknown>;
  storeGet<T>(name: string): Promise<T | null>;
  storeSet(name: string, value: unknown): Promise<void>;
  storeClear(): Promise<void>;
}

const native: Bridge = {
  upsert: (shard, points) => invoke("edge_upsert", { shard, points }),
  setPayload: (shard, id, patch) => invoke("edge_set_payload", { shard, id, patch }),
  remove: (shard, ids) => invoke("edge_delete", { shard, ids }),
  query: (shard, query) => invoke("edge_query", { shard, query }),
  similar: (shard, id, filter, limit) => invoke("edge_similar", { shard, id, filter, limit }),
  facet: (shard, key, filter, limit) => invoke("edge_facet", { shard, key, filter, limit }),
  count: (shard, filter) => invoke("edge_count", { shard, filter }),
  scroll: (shard, limit, offset, filter) => invoke("edge_scroll", { shard, limit, offset, filter }),
  retrieve: (shard, ids) => invoke("edge_retrieve", { shard, ids }),
  info: (shard) => invoke("edge_info", { shard }),
  optimize: (shard) => invoke("edge_optimize", { shard }),
  reset: (shard) => invoke("edge_reset", { shard }),
  applySnapshot: (shard, url) => invoke("edge_apply_snapshot", { shard, url }),
  manifest: (shard) => invoke("edge_manifest", { shard }),
  storeGet: async (name) => ((await invoke("store_get", { name })) ?? null) as never,
  storeSet: (name, value) => invoke("store_set", { name, value }),
  storeClear: () => invoke("store_clear"),
};

// ---------------------------- browser stand-in ----------------------------

interface MemPoint {
  id: string;
  dense: number[];
  tokens: string[];
  payload: Record<string, any>;
}

const LS_PREFIX = "sahayak:";
const mem: Record<Shard, Map<string, MemPoint>> = { memory: new Map(), knowledge: new Map(), state: new Map() };

function load(shard: Shard) {
  if (mem[shard].size) return;
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}shard:${shard}`);
    if (raw) for (const p of JSON.parse(raw) as MemPoint[]) mem[shard].set(p.id, p);
  } catch {
    /* empty preview store */
  }
}

function persist(shard: Shard) {
  try {
    localStorage.setItem(`${LS_PREFIX}shard:${shard}`, JSON.stringify([...mem[shard].values()]));
  } catch {
    /* storage full in preview: keep in memory */
  }
}

const tokenize = (t: string) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

function get(payload: any, key: string) {
  return key.split(".").reduce((o, k) => (o == null ? o : o[k]), payload);
}

function matches(p: MemPoint, f: any): boolean {
  if (!f) return true;
  const one = (c: any): boolean => {
    if (c.has_id) return c.has_id.includes(p.id);
    if (c.must || c.should || c.must_not) return matches(p, c);
    const v = get(p.payload, c.key);
    const vals = Array.isArray(v) ? v : [v];
    if (c.match?.value !== undefined) return vals.includes(c.match.value);
    if (c.match?.any) return vals.some((x) => c.match.any.includes(x));
    if (c.range) {
      const r = c.range;
      return vals.some((x) => x != null && (r.gte == null || x >= r.gte) && (r.lte == null || x <= r.lte) && (r.gt == null || x > r.gt) && (r.lt == null || x < r.lt));
    }
    return true;
  };
  if (f.must && !f.must.every(one)) return false;
  if (f.should?.length && !f.should.some(one)) return false;
  if (f.must_not && f.must_not.some(one)) return false;
  return true;
}

const preview: Bridge = {
  async upsert(shard, points) {
    load(shard);
    for (const p of points) mem[shard].set(p.id, { id: p.id, dense: p.dense, tokens: tokenize(p.text), payload: p.payload });
    persist(shard);
    return points.length;
  },
  async setPayload(shard, id, patch) {
    load(shard);
    const p = mem[shard].get(id);
    if (p) Object.assign(p.payload, patch);
    persist(shard);
  },
  async remove(shard, ids) {
    load(shard);
    ids.forEach((id) => mem[shard].delete(id));
    persist(shard);
  },
  async query(shard, q) {
    load(shard);
    const qt = new Set(tokenize(q.text));
    const pts = [...mem[shard].values()].filter((p) => matches(p, q.filter));
    const scored = pts.map((p) => {
      const dense = cosine(q.dense, p.dense);
      const sparse = p.tokens.filter((t) => qt.has(t)).length / Math.max(1, qt.size);
      const score = q.mode === "dense" ? dense : q.mode === "sparse" ? sparse : 0.67 * dense + 0.33 * sparse;
      return { id: p.id, score, payload: p.payload };
    });
    return scored
      .filter((h) => q.score_threshold == null || h.score >= q.score_threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, q.limit) as never;
  },
  async similar(shard, id, filter, limit) {
    load(shard);
    const base = mem[shard].get(id);
    if (!base) return [];
    return [...mem[shard].values()]
      .filter((p) => p.id !== id && matches(p, filter))
      .map((p) => ({ id: p.id, score: cosine(base.dense, p.dense), payload: p.payload }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit) as never;
  },
  async facet(shard, key, filter, limit) {
    load(shard);
    const counts = new Map<any, number>();
    for (const p of mem[shard].values()) {
      if (!matches(p, filter)) continue;
      const v = get(p.payload, key);
      for (const x of Array.isArray(v) ? v : [v]) if (x != null) counts.set(x, (counts.get(x) ?? 0) + 1);
    }
    return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, limit);
  },
  async count(shard, filter) {
    load(shard);
    return [...mem[shard].values()].filter((p) => matches(p, filter)).length;
  },
  async scroll(shard, limit, offset, filter) {
    load(shard);
    const all = [...mem[shard].values()].filter((p) => matches(p, filter));
    const start = offset ? Math.max(0, all.findIndex((p) => p.id === offset)) : 0;
    const page = all.slice(start, start + limit);
    return { points: page.map((p) => ({ id: p.id, payload: p.payload })) as never, next: all[start + limit]?.id ?? null };
  },
  async retrieve(shard, ids) {
    load(shard);
    return ids.map((id) => mem[shard].get(id)).filter(Boolean).map((p) => ({ id: p!.id, payload: p!.payload })) as never;
  },
  async info(shard) {
    load(shard);
    return {
      shard,
      points: mem[shard].size,
      indexed_vectors: 0,
      segments: 1,
      payload_indexes: [],
      disk_bytes: (localStorage.getItem(`${LS_PREFIX}shard:${shard}`) ?? "").length,
      vectors: { preview: { note: "browser preview, not Qdrant Edge" } },
    };
  },
  optimize: async () => false,
  async reset(shard) {
    mem[shard].clear();
    localStorage.removeItem(`${LS_PREFIX}shard:${shard}`);
  },
  applySnapshot: async () => {
    throw new Error("Snapshots need the Android app (Qdrant Edge)");
  },
  manifest: async () => ({}),
  async storeGet(name) {
    const raw = localStorage.getItem(`${LS_PREFIX}store:${name}`);
    return raw ? JSON.parse(raw) : null;
  },
  async storeSet(name, value) {
    localStorage.setItem(`${LS_PREFIX}store:${name}`, JSON.stringify(value));
  },
  async storeClear() {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(`${LS_PREFIX}store:`))
      .forEach((k) => localStorage.removeItem(k));
  },
};

export const edge: Bridge = isNative ? native : preview;
