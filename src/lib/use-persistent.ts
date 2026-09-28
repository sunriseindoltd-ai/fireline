import { useEffect, useState } from "react";

/**
 * useState mirrored to localStorage — per-browser conveniences only
 * (basemap, panel collapsed, present mode). Starts from `initial` on the
 * server and on the first client render, then adopts the stored value, so
 * SSR and hydration never disagree.
 */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {
      /* blocked storage or a stale value — keep the default */
    }
    setLoaded(true);
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private browsing — still works for this session */
    }
  }, [key, value, loaded]);

  return [value, setValue] as const;
}
