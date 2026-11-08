import { useEffect, useState } from "react";

/** cinema = 深色（默认，不挂 data-theme）；light = 白色主题 */
export type Theme = "cinema" | "light";

const THEME_KEY = "ht-theme";
const THEME_EVENT = "ht-theme-change";

export function getStoredTheme(): Theme {
  const raw = localStorage.getItem(THEME_KEY);
  // 历史值 "crimson"（暖黑影院）已下线，自动回落到深色
  return raw === "light" ? "light" : "cinema";
}

export function applyTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme);
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
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
