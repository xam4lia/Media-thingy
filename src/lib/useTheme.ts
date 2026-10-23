import { useCallback, useEffect, useRef, useState } from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "media-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function savedTheme(): Theme | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "dark" || saved === "light" ? saved : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => savedTheme() ?? systemTheme(),
  );
  const hasPreference = useRef(savedTheme() !== null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#0b1017" : "#dbe3ec");
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const followSystem = () => {
      if (!hasPreference.current) setTheme(media.matches ? "dark" : "light");
    };
    const followOtherTab = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      const saved = savedTheme();
      hasPreference.current = saved !== null;
      setTheme(saved ?? systemTheme());
    };
    media.addEventListener("change", followSystem);
    window.addEventListener("storage", followOtherTab);
    return () => {
      media.removeEventListener("change", followSystem);
      window.removeEventListener("storage", followOtherTab);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    hasPreference.current = true;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The toggle still works when browser preferences cannot be saved.
    }
    setTheme(next);
  }, [theme]);

  return { theme, toggleTheme };
}
