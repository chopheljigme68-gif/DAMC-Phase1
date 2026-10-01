/**
 * Personal appearance: theme (system / light / warm / dark) and accent colour.
 *
 * Modelled on macOS's Appearance settings. The accent tints the INTERACTIVE
 * parts of the interface — buttons, the selected nav item, focus rings,
 * checkboxes, links, tabs. It deliberately does NOT recolour content that
 * carries meaning: clock times stay brand green (so they never blur with the
 * blue dates), "Completed" stays green, priorities stay red/amber. Picking red
 * as your accent must not make finished work look urgent.
 *
 * This module is pure — no React, no DOM writes except in applyAccentVars —
 * so the same maths runs in the app and is cached for the pre-paint script in
 * index.html.
 */

export const THEME_IDS = ["system", "light", "warm", "dark"];
export const DEFAULT_THEME = "dark";
export const DEFAULT_ACCENT = "damc";

// How strongly the accent colours the BACKGROUNDS — page, panels, cards,
// dividers, secondary text. macOS's "tint windows with wallpaper colour",
// as a three-step choice. null = never chosen; see effectiveTint.
export const TINT_LEVELS = ["off", "subtle", "rich"];
export const isValidTint = (v) => TINT_LEVELS.includes(v);

// Someone who picks a colour expects the app to take it on, so an unchosen
// tint means Subtle — except on the default DAMC Green, where it means Off.
// That keeps the stock look exactly as it was for everyone who has never
// opened the panel, while one click on a colour gives the blended look.
export const effectiveTint = (accent, tint) =>
  isValidTint(tint) ? tint : !accent || accent === DEFAULT_ACCENT ? "off" : "subtle";

// Apple's system colours, light-mode and dark-mode variants, plus the DAMC
// brand green as the default. "damc" carries no values on purpose: it means
// "use the stylesheet's own hand-tuned greens", which were chosen per theme
// and shouldn't be second-guessed by a formula.
export const ACCENTS = [
  { id: "damc", label: "DAMC Green", swatch: "#2FA34F" },
  { id: "blue", label: "Blue", light: "#007AFF", dark: "#0A84FF" },
  { id: "indigo", label: "Indigo", light: "#5856D6", dark: "#5E5CE6" },
  { id: "purple", label: "Purple", light: "#AF52DE", dark: "#BF5AF2" },
  { id: "pink", label: "Pink", light: "#FF2D55", dark: "#FF375F" },
  { id: "red", label: "Red", light: "#FF3B30", dark: "#FF453A" },
  { id: "orange", label: "Orange", light: "#FF9500", dark: "#FF9F0A" },
  { id: "yellow", label: "Yellow", light: "#FFCC00", dark: "#FFD60A" },
  { id: "teal", label: "Teal", light: "#30B0C7", dark: "#40C8E0" },
  { id: "graphite", label: "Graphite", light: "#8E8E93", dark: "#98989D" },
];

const HEX = /^#[0-9a-f]{6}$/i;

export const isValidAccent = (value) =>
  typeof value === "string" && (HEX.test(value) || ACCENTS.some((a) => a.id === value));

export const accentLabel = (value) =>
  ACCENTS.find((a) => a.id === value)?.label || (HEX.test(value || "") ? "Custom" : "DAMC Green");

// The surface each theme puts accent-coloured TEXT on. Contrast is measured
// against the panel (where most text sits); the soft alpha is what the
// stylesheet already used per theme, kept so selected rows look the same
// weight whatever the colour.
const SURFACES = {
  dark: { panel: "#191d28", softAlpha: "22", darkInk: "#0b0d12" },
  light: { panel: "#ffffff", softAlpha: "1a", darkInk: "#0b0d12" },
  warm: { panel: "#fdf8f0", softAlpha: "1f", darkInk: "#2c231a" },
};

/* ---------------------------- colour maths ---------------------------- */

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (r, g, b) =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

// WCAG relative luminance.
const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const rgbToHsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
};
const hslToHex = ([h, s, l]) => {
  if (s === 0) return rgbToHex(l * 255, l * 255, l * 255);
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgbToHex(hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255);
};

// The stylesheet's own neutrals for each theme — what a tint starts from.
// Must match the :root[data-theme] blocks in styles.css.
const THEME_NEUTRALS = {
  dark: { "--ink": "#12141c", "--panel": "#191d28", "--raised": "#232a3b", "--line": "#2b3142",
          "--text-dim": "#8b93a7", "--text-faint": "#5c6478", "--chart-tooltip-bg": "#20263f" },
  light: { "--ink": "#f3f5f9", "--panel": "#ffffff", "--raised": "#eef1f7", "--line": "#dee3ed",
           "--text-dim": "#5b6272", "--text-faint": "#9098aa", "--chart-tooltip-bg": "#ffffff" },
  warm: { "--ink": "#f4ecdf", "--panel": "#fdf8f0", "--raised": "#efe4d3", "--line": "#ddcdb6",
          "--text-dim": "#6b5a48", "--text-faint": "#9c8973", "--chart-tooltip-bg": "#fdf8f0" },
};
const SURFACE_TOKENS = ["--ink", "--panel", "--raised", "--line", "--chart-tooltip-bg"];
const TEXT_TOKENS = ["--text-dim", "--text-faint"];

// Saturation each kind of token is pushed to, per theme and level. Light
// surfaces need far more saturation than dark ones to show any colour at all
// — at 95% brightness even 40% saturation is a pale wash. Secondary text gets
// just enough to stop it looking grey-blue on a purple page.
const TINT_SATURATION = {
  dark:  { subtle: { surface: 0.24, text: 0.12 }, rich: { surface: 0.46, text: 0.2 } },
  light: { subtle: { surface: 0.42, text: 0.14 }, rich: { surface: 0.78, text: 0.24 } },
  warm:  { subtle: { surface: 0.42, text: 0.14 }, rich: { surface: 0.72, text: 0.22 } },
};

// Pure white has no hue to give it — any tint has to darken it a touch. When
// the brightest surface is above the cap (in practice: the light theme's
// white cards), EVERY surface in that theme is scaled down by the same
// factor. Scaling only the white one collapsed the step between page and
// card — they came out within 1% of each other and cards lost their edges.
// Scaling them together keeps the page-to-card relationship intact. These are
// the only luminance changes the tint makes; text contrast stays clear of AA
// (largest loss measured: 9.5%, light theme, Rich).
const WHITE_CAP = { subtle: 0.955, rich: 0.92 };

// The colour with this hue and saturation that has EXACTLY this luminance.
// Luminance is monotonic in HSL lightness for a fixed hue and saturation, so
// a short binary search finds it.
const atLuminance = (h, s, targetLum) => {
  let lo = 0, hi = 1, best = hslToHex([h, s, 0.5]);
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const hex = hslToHex([h, s, mid]);
    best = hex;
    if (luminance(hex) < targetLum) lo = mid; else hi = mid;
  }
  return best;
};

/**
 * The theme's neutrals, re-hued toward the accent.
 *
 * The rule that makes this safe: each surface keeps its exact WCAG luminance
 * (the one deliberate exception being near-white, above). Contrast between
 * two colours depends only on their luminance — so every text-on-background
 * pairing in the app reads exactly as it was designed to, whatever colour is
 * picked. The tint changes what colour the page is, never how readable it is.
 */
function tintedNeutrals(accentHex, theme, level) {
  if (level === "off") return null;
  const base = THEME_NEUTRALS[theme];
  const sat = TINT_SATURATION[theme][level];
  const [hue, accentSat] = rgbToHsl(hexToRgb(accentHex));
  // Never more colourful than the accent itself: Graphite stays a neutral
  // grey rather than gaining a hue it doesn't have.
  const cap = Math.max(accentSat, 0.02);
  const brightest = Math.max(...SURFACE_TOKENS.map((t) => luminance(base[t])));
  const scale = Math.min(1, WHITE_CAP[level] / brightest);
  const out = {};
  for (const [token, hex] of Object.entries(base)) {
    const kind = TEXT_TOKENS.includes(token) ? "text" : "surface";
    const s = Math.min(sat[kind], cap);
    const target = luminance(hex) * (kind === "surface" ? scale : 1);
    out[token] = atLuminance(hue, s, target);
  }
  out["--chart-grid"] = out["--line"];
  out["--chart-tick"] = out["--text-dim"];
  return out;
}

// Accent colours are used as TEXT here (the selected nav item, links, tab
// labels), not only as fills — so a colour has to be readable on the panel or
// it isn't usable. Apple's yellow on white is 1.6:1. Rather than refuse a
// colour, keep its hue and saturation and walk its lightness until it reaches
// 4.5:1 (WCAG AA for body text): lighter on dark themes, darker on light ones.
// This is what makes ANY custom colour safe to pick.
const TARGET_CONTRAST = 4.5;
const readableOn = (hex, panel, lighten) => {
  if (contrast(hex, panel) >= TARGET_CONTRAST) return hex;
  let [h, s, l] = rgbToHsl(hexToRgb(hex));
  for (let i = 0; i < 100; i++) {
    l = lighten ? Math.min(1, l + 0.01) : Math.max(0, l - 0.01);
    const next = hslToHex([h, s, l]);
    if (contrast(next, panel) >= TARGET_CONTRAST) return next;
    if (l <= 0 || l >= 1) return next;
  }
  return hslToHex([h, s, l]);
};

// The DAMC greens, per theme — the colour a tint takes on when the accent is
// the default. (The ACCENT itself stays the stylesheet's own value then.)
const DAMC_BY_THEME = { dark: "#2FA34F", light: "#1F7D3B", warm: "#1d7038" };

const baseAccentHex = (accent, theme) => {
  if (!accent || accent === DEFAULT_ACCENT) return DAMC_BY_THEME[theme] || DAMC_BY_THEME.dark;
  const preset = ACCENTS.find((a) => a.id === accent);
  if (preset) return (theme === "dark" ? preset.dark : preset.light).toLowerCase();
  return HEX.test(accent) ? accent.toLowerCase() : null;
};

/**
 * Every CSS variable the person's appearance sets for one painted theme:
 * the accent trio, plus — when tinting — the re-hued neutrals. Returns null
 * when nothing differs from the stylesheet (default accent, tint off).
 */
export function accentVarsFor(accent, theme, tint) {
  const surface = SURFACES[theme] || SURFACES.dark;
  const level = effectiveTint(accent, tint);
  const hex = baseAccentHex(accent, theme);
  if (!hex) return null;

  const neutrals = tintedNeutrals(hex, theme, level);
  const isDefault = !accent || accent === DEFAULT_ACCENT;
  if (isDefault && !neutrals) return null;

  const vars = { ...(neutrals || {}) };
  if (!isDefault) {
    // Measured against the panel as it will actually be painted — tinted or
    // not — so the accent text stays at 4.5:1 on the real background.
    const panel = neutrals ? neutrals["--panel"] : surface.panel;
    const color = readableOn(hex, panel, theme === "dark");
    // Text ON the accent (button labels, ticks): whichever of white or the
    // theme's dark ink reads better on it.
    const ink = contrast(color, "#ffffff") >= contrast(color, surface.darkInk) ? "#ffffff" : surface.darkInk;
    vars["--accent"] = color;
    vars["--accent-ink"] = ink;
    vars["--accent-soft"] = color + surface.softAlpha;
  }
  return vars;
}

/**
 * The surface colours a theme preview should draw with — tinted or stock —
 * so the little windows in the Appearance panel show the real result.
 */
export function themeSurfaces(accent, theme, tint) {
  const vars = accentVarsFor(accent, theme, tint) || {};
  const base = THEME_NEUTRALS[theme];
  const pick = (t) => vars[t] || base[t];
  return {
    page: pick("--ink"), panel: pick("--panel"), line: pick("--line"), text: pick("--text-faint"),
    accent: vars["--accent"] || DAMC_BY_THEME[theme],
  };
}

/** All three theme variants at once — what the pre-paint cache stores. */
export const accentVarsAllThemes = (accent, tint) => ({
  dark: accentVarsFor(accent, "dark", tint),
  light: accentVarsFor(accent, "light", tint),
  warm: accentVarsFor(accent, "warm", tint),
});

// Every variable this module may set. Cleared together, so switching from a
// tinted colour back to the default can't leave one stray tinted panel.
// index.html applies ONLY these names from the cache.
export const MANAGED_VARS = [
  "--accent", "--accent-ink", "--accent-soft",
  "--ink", "--panel", "--raised", "--line", "--text-dim", "--text-faint",
  "--chart-grid", "--chart-tick", "--chart-tooltip-bg",
];

/** Paint (or clear back to the stylesheet) the appearance for the painted theme. */
export function applyAccentVars(accent, theme, tint) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const vars = accentVarsFor(accent, theme, tint) || {};
  MANAGED_VARS.forEach((name) => {
    if (vars[name]) root.style.setProperty(name, vars[name]);
    else root.style.removeProperty(name);
  });
}

/* ------------------------------ local cache ------------------------------ */

// One key, read by index.html BEFORE React loads so the page paints in the
// right colours from the first frame. It is NOT cleared on sign-out — that is
// the point: the device keeps looking the way its last user left it, and the
// sign-in screen doesn't flash back to defaults.
export const APPEARANCE_CACHE_KEY = "pmdamc.appearance";
const LEGACY_THEME_KEY = "tfh_theme";

export function readAppearanceCache() {
  try {
    const raw = localStorage.getItem(APPEARANCE_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        userId: parsed.userId || null,
        theme: THEME_IDS.includes(parsed.theme) ? parsed.theme : DEFAULT_THEME,
        accent: isValidAccent(parsed.accent) ? parsed.accent : DEFAULT_ACCENT,
        tint: isValidTint(parsed.tint) ? parsed.tint : null,
      };
    }
    // Before this feature the theme lived alone under tfh_theme. Honour it so
    // nobody's existing choice is lost on upgrade.
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    return { userId: null, theme: THEME_IDS.includes(legacy) ? legacy : DEFAULT_THEME, accent: DEFAULT_ACCENT, tint: null, legacy: true };
  } catch {
    return { userId: null, theme: DEFAULT_THEME, accent: DEFAULT_ACCENT, tint: null };
  }
}

export function writeAppearanceCache({ userId, theme, accent, tint }) {
  try {
    localStorage.setItem(
      APPEARANCE_CACHE_KEY,
      JSON.stringify({ v: 2, userId: userId || null, theme, accent, tint: tint ?? null, vars: accentVarsAllThemes(accent, tint) })
    );
    // Kept in step for anything still reading the old key.
    localStorage.setItem(LEGACY_THEME_KEY, theme);
  } catch {
    /* private mode — the account copy still holds it */
  }
}