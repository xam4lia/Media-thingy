import { useCallback, useEffect, useState } from "react";

export const DEFAULT_SCALE = 115;
export const MIN_SCALE = 100;
export const MAX_SCALE = 150;
const STORAGE_KEY = "media-ui-scale";

function normalizeScale(value: number) {
  return Number.isFinite(value)
    ? Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, value)) / 5) * 5
    : DEFAULT_SCALE;
}

function savedScale() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? DEFAULT_SCALE : normalizeScale(Number(raw));
  } catch {
    return DEFAULT_SCALE;
  }
}

export function useDisplayScale() {
  const [scale, updateScale] = useState(savedScale);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--ui-scale",
      String(scale / 100),
    );
    document.documentElement.dataset.uiScale = String(scale);
  }, [scale]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null)
        updateScale(savedScale());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const setScale = useCallback((value: number) => {
    const next = normalizeScale(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Resizing still works if browser preferences cannot be stored.
    }
    updateScale(next);
  }, []);

  return { scale, setScale };
}
