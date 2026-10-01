import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  THEME_IDS, DEFAULT_THEME, DEFAULT_ACCENT, APPEARANCE_CACHE_KEY,
  isValidAccent, isValidTint, effectiveTint, applyAccentVars, readAppearanceCache, writeAppearanceCache,
} from "../appearance";

const ThemeContext = createContext(null);

// Kept exported under its old name for anything that imported it.
export const THEME_PREFERENCES = THEME_IDS;

const DARK_QUERY = "(prefers-color-scheme: dark)";
const prefersDark = () =>
  typeof window !== "undefined" && window.matchMedia ? window.matchMedia(DARK_QUERY).matches : false;

// What the browser's own UI (mobile address bar, PWA title bar) is tinted —
// the theme's page background, so the chrome and the page read as one.
const BROWSER_CHROME = { dark: "#12141c", light: "#f3f5f9", warm: "#f4ecdf" };

/**
 * Owns the person's appearance: theme preference (system / light / warm /
 * dark) and accent colour.
 *
 * Three different things are kept apart on purpose:
 *   preference — what they PICKED, including "system"
 *   theme      — what is actually PAINTED ("system" resolved via the OS)
 *   ownerId    — whose choice this is, so one person's colours are never
 *                quietly adopted onto another person's account
 *
 * The account copy is the source of truth (see AppearanceSync); this context
 * holds the live value and the device cache, and paints.
 */
export function ThemeProvider({ children }) {
  const initial = useMemo(() => readAppearanceCache(), []);
  const [preference, setPreferenceState] = useState(initial.theme);
  const [accent, setAccentState] = useState(initial.accent);
  // null = never chosen; effectiveTint() decides what that means for the
  // current accent. Kept as null rather than resolved, so picking a new
  // colour later still gets the sensible default for THAT colour.
  const [tint, setTintState] = useState(initial.tint);
  const [ownerId, setOwnerId] = useState(initial.userId);
  const [systemIsDark, setSystemIsDark] = useState(prefersDark);

  // AppearanceSync registers here to hear about choices the person makes, so
  // it can save them to their account. Changes that ARRIVE from the account
  // go through adoptAppearance instead and are never echoed back.
  const persistRef = useRef(null);
  const registerPersist = useCallback((fn) => { persistRef.current = fn; }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = (e) => setSystemIsDark(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange); // older Safari
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  const theme = preference === "system" ? (systemIsDark ? "dark" : "light") : preference;

  // Paint. A brief colour cross-fade on CHANGES only — never on first load,
  // where it would show as the page fading in from the wrong colours.
  const firstPaint = useRef(true);
  useEffect(() => {
    const root = document.documentElement;
    if (!firstPaint.current) {
      root.classList.add("tfh-appearance-changing");
      window.clearTimeout(root.__tfhAppearanceTimer);
      root.__tfhAppearanceTimer = window.setTimeout(() => root.classList.remove("tfh-appearance-changing"), 320);
    }
    firstPaint.current = false;

    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme === "dark" ? "dark" : "light";
    applyAccentVars(accent, theme, tint);

    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = BROWSER_CHROME[theme] || BROWSER_CHROME.dark;
  }, [theme, accent, tint]);

  // The device cache — what index.html paints from before React starts.
  useEffect(() => {
    writeAppearanceCache({ userId: ownerId, theme: preference, accent, tint });
  }, [ownerId, preference, accent, tint]);

  // Another tab of this same browser changed it: follow along. (Other
  // DEVICES are reached through the socket, in AppearanceSync.)
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== APPEARANCE_CACHE_KEY || !e.newValue) return;
      try {
        const next = JSON.parse(e.newValue);
        if (THEME_IDS.includes(next.theme)) setPreferenceState(next.theme);
        if (isValidAccent(next.accent)) setAccentState(next.accent);
        setTintState(isValidTint(next.tint) ? next.tint : null);
        setOwnerId(next.userId || null);
      } catch { /* ignore a malformed write */ }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // A choice the person made, here, now.
  const setPreference = useCallback((next) => {
    if (!THEME_IDS.includes(next)) return;
    setPreferenceState(next);
    persistRef.current?.({ theme: next });
  }, []);

  const setAccent = useCallback((next) => {
    if (!isValidAccent(next)) return;
    const value = next.startsWith("#") ? next.toLowerCase() : next;
    setAccentState(value);
    persistRef.current?.({ accent: value });
  }, []);

  const setTint = useCallback((next) => {
    if (!isValidTint(next)) return;
    setTintState(next);
    persistRef.current?.({ tint: next });
  }, []);

  const resetAppearance = useCallback(() => {
    setPreferenceState(DEFAULT_THEME);
    setAccentState(DEFAULT_ACCENT);
    setTintState(null);
    persistRef.current?.({ theme: DEFAULT_THEME, accent: DEFAULT_ACCENT, tint: null });
  }, []);

  // A value that came FROM the account (sign-in, or another device changed
  // it). Applied without saving it straight back.
  const adoptAppearance = useCallback(({ theme: t, accent: a, tint: n }, userId) => {
    setPreferenceState(THEME_IDS.includes(t) ? t : DEFAULT_THEME);
    setAccentState(isValidAccent(a) ? a : DEFAULT_ACCENT);
    setTintState(isValidTint(n) ? n : null);
    setOwnerId(userId || null);
  }, []);

  // Old toggle(): cycles the three explicit themes, leaves "system" alone.
  const toggle = useCallback(() => {
    setPreference(preference === "dark" ? "light" : preference === "light" ? "warm" : "dark");
  }, [preference, setPreference]);

  const value = useMemo(() => ({
    theme, preference, accent, tint, ownerId,
    tintInEffect: effectiveTint(accent, tint),
    systemTheme: systemIsDark ? "dark" : "light",
    setPreference, setTheme: setPreference, setAccent, setTint, resetAppearance, toggle,
    adoptAppearance, setOwnerId, registerPersist,
  }), [theme, preference, accent, tint, ownerId, systemIsDark, setPreference, setAccent, setTint, resetAppearance, toggle, adoptAppearance, registerPersist]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);