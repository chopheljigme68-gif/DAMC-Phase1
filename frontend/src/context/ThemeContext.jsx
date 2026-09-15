import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const ThemeContext = createContext(null);

// Two different things, deliberately kept apart:
//   preference — what the user PICKED: "system" | "light" | "warm" | "dark"
//   theme      — what's actually painted: "light" | "warm" | "dark"
// They differ only for "system", which follows the OS and can change under
// us at sunset without anyone touching the app. Collapsing the two (the
// usual shortcut) loses the user's choice the moment the OS flips.
export const THEME_PREFERENCES = ["system", "light", "warm", "dark"];
const STORAGE_KEY = "tfh_theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const prefersDark = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia(DARK_QUERY).matches
    : false;

const readStoredPreference = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // Anything unrecognised (including the plain "dark"/"light" written by
    // older builds, which are still valid) falls back to dark, the theme
    // this app shipped with.
    return THEME_PREFERENCES.includes(stored) ? stored : "dark";
  } catch {
    return "dark";
  }
};

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(readStoredPreference);
  const [systemIsDark, setSystemIsDark] = useState(prefersDark);

  // Track the OS setting whether or not "system" is currently selected —
  // switching to it should paint the right theme immediately, not wait for
  // the next OS change.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = (e) => setSystemIsDark(e.matches);
    // addListener is the deprecated form, still needed for older Safari.
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  const theme = useMemo(
    () => (preference === "system" ? (systemIsDark ? "dark" : "light") : preference),
    [preference, systemIsDark]
  );

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, preference); } catch { /* private mode — in-memory only */ }
  }, [preference]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    // Tells the browser which colour scheme the page is painted in, so form
    // controls, scrollbars and the like match. Warm is a light scheme.
    document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
  }, [theme]);

  // Kept so nothing that still calls toggle() breaks: it cycles the three
  // explicit themes and leaves "system" alone as a deliberate choice.
  const toggle = () =>
    setPreference((p) => (p === "dark" ? "light" : p === "light" ? "warm" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, preference, systemTheme: systemIsDark ? "dark" : "light", setPreference, setTheme: setPreference, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);