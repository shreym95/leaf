import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useImmersive } from "./useImmersive";

// jsdom implements neither the Fullscreen API nor `document.fullscreenElement`
// as a settable value, so stand both in.
let fsElement: Element | null = null;
const request = vi.fn(async () => {
  fsElement = document.documentElement;
});
const exit = vi.fn(async () => {
  fsElement = null;
});

beforeEach(() => {
  fsElement = null;
  request.mockClear();
  exit.mockClear();
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fsElement,
  });
  document.documentElement.requestFullscreen = request;
  document.exitFullscreen = exit;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useImmersive", () => {
  it("hides chrome and asks the browser for fullscreen", async () => {
    const { result } = renderHook(() => useImmersive());
    expect(result.current.immersive).toBe(false);

    await act(async () => result.current.enter());

    expect(result.current.immersive).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("exits both together", async () => {
    const { result } = renderHook(() => useImmersive());
    await act(async () => result.current.enter());
    await act(async () => result.current.exit());

    expect(result.current.immersive).toBe(false);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("follows the browser out of fullscreen (back gesture, Esc, tab switch)", async () => {
    const { result } = renderHook(() => useImmersive());
    await act(async () => result.current.enter());
    expect(result.current.immersive).toBe(true);

    // The browser drops fullscreen without going through us.
    await act(async () => {
      fsElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    expect(result.current.immersive).toBe(false);
  });

  it("still hides Leaf's own chrome where fullscreen is unavailable (iOS)", async () => {
    // iOS Safari has no requestFullscreen for arbitrary elements.
    delete (document.documentElement as Partial<HTMLElement>).requestFullscreen;
    const { result } = renderHook(() => useImmersive());

    await act(async () => result.current.enter());

    expect(result.current.immersive).toBe(true);
  });

  it("does not leave the page stuck in fullscreen on unmount", async () => {
    const { result, unmount } = renderHook(() => useImmersive());
    await act(async () => result.current.enter());

    await act(async () => {
      unmount();
    });

    expect(exit).toHaveBeenCalled();
  });
});
