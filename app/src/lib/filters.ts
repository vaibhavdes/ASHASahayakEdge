// Tiny builders for Qdrant filter JSON (REST shape), shared by all screens.
import type { Filter } from "./types";

type Cond = Record<string, unknown>;

export const eq = (key: string, value: string | number | boolean): Cond => ({ key, match: { value } });
export const anyOf = (key: string, values: (string | number)[]): Cond => ({ key, match: { any: values } });
export const since = (key: string, iso: string): Cond => ({ key, range: { gte: iso } });
export const between = (key: string, gte: string, lte: string): Cond => ({ key, range: { gte, lte } });

export function and(...conds: (Cond | null | undefined | false)[]): Filter | null {
  const must = conds.filter(Boolean) as Cond[];
  return must.length ? { must } : null;
}

export function not(filter: Filter | null, ...conds: Cond[]): Filter {
  return { ...(filter ?? {}), must_not: conds };
}
