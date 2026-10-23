import { useCallback, useEffect, useState } from "react";

export const DEFAULT_GLASS_HUE = 205;
const STORAGE_KEY = "media-glass-hue";

function normalizeHue(value: number) {
  return Number.isFinite(value)
    ? Math.round(Math.min(360, Math.max(0, value)))
    : DEFAULT_GLASS_HUE;
}

function savedHue() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? DEFAULT_GLASS_HUE : normalizeHue(Number(raw));
  } catch {
    return DEFAULT_GLASS_HUE;
  }
}

export function useGlassHue() {
  const [hue, updateHue] = useState(savedHue);

  useEffect(() => {
    document.documentElement.style.setProperty("--glass-hue", String(hue));
    document.documentElement.dataset.glassHue = String(hue);
  }, [hue]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null)
        updateHue(savedHue());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const setHue = useCallback((value: number) => {
    const next = normalizeHue(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // The visual control still works if browser preferences cannot be saved.
    }
    updateHue(next);
  }, []);

  return { hue, setHue };
}
