import { useCallback, useEffect, useState } from "react";
import { on } from "./events";
import { getSettings, onSettings, type Settings } from "./settings";

/** Load async data and reload whenever one of the given topics changes. */
export function useData<T>(load: () => Promise<T>, topics: Parameters<typeof on>[0][], deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    load().then(setData, (e) => setError(String(e)));
  }, deps);
  useEffect(() => {
    reload();
    const offs = topics.map((t) => on(t, reload));
    return () => offs.forEach((off) => off());
  }, [reload]);
  return { data, error, reload };
}

export function useSettings(): Settings | null {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    const read = () => getSettings().then((x) => setS({ ...x }));
    read();
    const off = onSettings(read);
    return () => {
      off();
    };
  }, []);
  return s;
}
