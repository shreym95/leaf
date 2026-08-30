"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * useImmersive — reading with nothing but the page on screen.
 *
 * Two layers of chrome have to go, and they are hidden by different means:
 *  - Leaf's own top/bottom bars — React state, handled by the caller;
 *  - the browser's URL bar and toolbars — only the Fullscreen API can do that,
 *    and only from a user gesture.
 *
 * Fullscreen is best-effort on purpose. iOS Safari does not implement it for
 * arbitrary elements (only <video>), so `requestFullscreen` is absent or
 * rejects there; immersive still hides Leaf's bars, and the PWA manifest is what
 * gives iOS a chrome-free window once the reader adds Leaf to their home screen.
 *
 * The browser can also leave fullscreen on its own — the Android back gesture,
 * Esc, a tab switch. `fullscreenchange` keeps our state honest when that
 * happens, so the exit affordance never lies about what the reader is looking at.
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
