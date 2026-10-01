import { useEffect, useRef } from "react";
import { api, CLIENT_ID } from "../api";
import { getSocket } from "../socket";
import { useAuth } from "./AuthContext";
import { useTheme } from "./ThemeContext";
import { DEFAULT_ACCENT, DEFAULT_THEME, readAppearanceCache } from "../appearance";

// Flags a choice that hasn't reached the account yet (offline, server down).
// Survives a reload, so the next sign-in pushes it up instead of overwriting
// it with the older copy the server still holds.
const DIRTY_KEY = "pmdamc.appearance.unsynced";
const markDirty = (userId) => { try { localStorage.setItem(DIRTY_KEY, userId); } catch { /* best effort */ } };
const clearDirty = () => { try { localStorage.removeItem(DIRTY_KEY); } catch { /* best effort */ } };
const dirtyFor = () => { try { return localStorage.getItem(DIRTY_KEY); } catch { return null; } };

/**
 * Keeps the person's appearance and their ACCOUNT in step. Renders nothing.
 *
 * Lives inside AuthProvider (ThemeProvider sits outside it, so it can paint
 * the sign-in screen before anyone has signed in).
 *
 * On sign-in, in order of precedence:
 *   1. An unsynced local change by THIS person  → push it up (their newest choice)
 *   2. A choice saved on their account          → adopt it, on any device
 *   3. Nothing saved, and this device's look is theirs or nobody's
 *      (the pre-feature theme, or what they set before signing in)
 *                                               → save the device's look to the account
 *   4. Nothing saved, device belongs to someone else → defaults, NOT the
 *      previous person's colours
 *
 * Sign-out deliberately changes nothing: the device keeps looking the way its
 * last user left it, and the sign-in screen doesn't flash back to defaults.
 */
export default function AppearanceSync() {
  const { user, setUser } = useAuth();
  const { preference, accent, adoptAppearance, setOwnerId, registerPersist } = useTheme();

  // Latest values for the save path without re-registering on every change.
  const latest = useRef({ preference, accent });
  latest.current = { preference, accent };
  const userRef = useRef(user);
  userRef.current = user;

  // --- reconcile on sign-in -------------------------------------------------
  const settledFor = useRef(null);
  useEffect(() => {
    if (!user) { settledFor.current = null; return; }
    if (settledFor.current === user.id) return; // once per sign-in, not per render
    settledFor.current = user.id;

    const saved = user.appearance || {};
    const cache = readAppearanceCache();
    const hasSaved = Boolean(saved.theme || saved.accent || saved.tint);
    const deviceIsTheirs = !cache.userId || cache.userId === user.id;

    if (dirtyFor() === user.id && deviceIsTheirs) {
      // 1 — they changed it while we couldn't reach the server.
      setOwnerId(user.id);
      save({ theme: cache.theme, accent: cache.accent, tint: cache.tint });
    } else if (hasSaved) {
      // 2 — their account wins, wherever they sign in.
      adoptAppearance({ theme: saved.theme || DEFAULT_THEME, accent: saved.accent || DEFAULT_ACCENT, tint: saved.tint }, user.id);
    } else if (deviceIsTheirs) {
      // 3 — first time: keep the look they already have and make it theirs.
      setOwnerId(user.id);
      if (cache.theme !== DEFAULT_THEME || cache.accent !== DEFAULT_ACCENT || cache.tint) {
        save({ theme: cache.theme, accent: cache.accent, tint: cache.tint });
      }
    } else {
      // 4 — someone else's colours on a shared computer. Not theirs to inherit.
      adoptAppearance({ theme: DEFAULT_THEME, accent: DEFAULT_ACCENT, tint: null }, user.id);
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- saving choices to the account -----------------------------------------
  // Debounced: dragging through the custom colour picker fires dozens of
  // changes a second, and only where it comes to rest is worth a request.
  const pending = useRef({});
  const timer = useRef(null);

  function save(patch) {
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 400);
  }

  async function flush(attempt = 1) {
    const current = userRef.current;
    if (!current) return; // signed out meanwhile — the device cache still holds it
    const body = pending.current;
    pending.current = {};
    if (!Object.keys(body).length) return;
    try {
      const { user: updated } = await api.updateAppearance(body);
      clearDirty();
      setUser((prev) => (prev && prev.id === updated.id ? { ...prev, appearance: updated.appearance } : prev));
    } catch (err) {
      // Keep it locally and say so in the cache; one quiet retry, then the
      // next sign-in finishes the job (see precedence 1 above). A colour
      // preference is not worth an error banner.
      markDirty(current.id);
      pending.current = { ...body, ...pending.current };
      if (attempt < 2) window.setTimeout(() => flush(attempt + 1), 3000);
      else console.warn("[appearance] saved on this device only for now:", err.message);
    }
  }

  useEffect(() => {
    registerPersist((patch) => {
      if (!userRef.current) return; // on the sign-in screen: device cache only
      setOwnerId(userRef.current.id);
      save(patch);
    });
    return () => registerPersist(null);
  }, [registerPersist]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- other devices -----------------------------------------------------------
  // The same person changed it somewhere else (laptop at home, another
  // browser). The server sends this only to their own user room.
  useEffect(() => {
    if (!user) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;
    const onChanged = ({ appearance, origin }) => {
      if (origin && origin === CLIENT_ID) return; // our own save, echoed back
      if (!appearance) return;
      adoptAppearance({ theme: appearance.theme || DEFAULT_THEME, accent: appearance.accent || DEFAULT_ACCENT, tint: appearance.tint }, user.id);
      setUser((prev) => (prev ? { ...prev, appearance } : prev));
    };
    socket.on("appearance:changed", onChanged);
    return () => socket.off("appearance:changed", onChanged);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}