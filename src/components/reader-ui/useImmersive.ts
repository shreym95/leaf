"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * useImmersive — push the *browser's* chrome out of the way (URL bar, toolbars)
 * via the Fullscreen API.
 *
 * Since the reader dock (design iteration 1) it no longer touches Leaf's own
 * chrome: the resting pill and the slim top bar are small enough to stay on
 * screen, so there is no "hide-all-chrome" mode to coordinate — this hook is
 * purely the Fullscreen half. Bound to the `F` key in `ReaderShell`.
 *
 * Fullscreen is best-effort on purpose. iOS Safari does not implement it for
 * arbitrary elements (only <video>), so `requestFullscreen` is absent or
 * rejects there — `F` is then a no-op and the installed PWA manifest is what
 * gives iOS a chrome-free window.
 *
 * The browser can also leave fullscreen on its own — the Android back gesture,
 * Esc, a tab switch. `fullscreenchange` keeps `immersive` honest when that
 * happens, so a caller reacting to the flag (e.g. asking epub.js to re-measure)
 * never works from a stale value.
 */

function fullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  return document.fullscreenElement ?? null;
}

async function enterFullscreen(): Promise<void> {
  const el = document.documentElement;
  if (typeof el.requestFullscreen !== "function") return;
  try {
    await el.requestFullscreen({ navigationUI: "hide" });
  } catch {
    // Unsupported (iOS Safari) or refused — immersive still hides our own bars.
  }
}

async function leaveFullscreen(): Promise<void> {
  if (!fullscreenElement()) return;
  if (typeof document.exitFullscreen !== "function") return;
  try {
    await document.exitFullscreen();
  } catch {
    // Already gone.
  }
}

export interface Immersive {
  immersive: boolean;
  enter: () => void;
  exit: () => void;
  toggle: () => void;
}

export function useImmersive(): Immersive {
  const [immersive, setImmersive] = useState(false);

  const enter = useCallback(() => {
    setImmersive(true);
    void enterFullscreen();
  }, []);

  const exit = useCallback(() => {
    setImmersive(false);
    void leaveFullscreen();
  }, []);

  const toggle = useCallback(() => {
    setImmersive((was) => {
      if (was) void leaveFullscreen();
      else void enterFullscreen();
      return !was;
    });
  }, []);

  // The browser left fullscreen without going through us (back gesture, Esc,
  // tab switch) — come out of immersive so the bars return with the chrome.
  useEffect(() => {
    const onChange = () => {
      if (!fullscreenElement()) setImmersive(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Never leave the page stuck in fullscreen after navigating away.
  useEffect(() => () => void leaveFullscreen(), []);

  return { immersive, enter, exit, toggle };
}
