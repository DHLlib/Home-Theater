import { useEffect, useState } from "react";

export type Theme = "cinema" | "crimson";

const THEME_KEY = "ht-theme";
const THEME_EVENT = "ht-theme-change";

export function getStoredTheme(): Theme {
  const raw = localStorage.getItem(THEME_KEY);
  return raw === "crimson" ? "crimson" : "cinema";
}

export function applyTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme);
  if (theme === "crimson") {
    document.documentElement.setAttribute("data-theme", "crimson");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme());

  useEffect(() => {
    const handler = (e: Event) => {
      setThemeState((e as CustomEvent<Theme>).detail);
    };
    window.addEventListener(THEME_EVENT, handler);
    return () => window.removeEventListener(THEME_EVENT, handler);
  }, []);

  return { theme, setTheme: (t: Theme) => applyTheme(t) };
}
