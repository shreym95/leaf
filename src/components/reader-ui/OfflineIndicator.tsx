"use client";

import { useEffect, useState } from "react";
import { useIsOffline } from "@/components/ui/useOnlineStatus";

/**
 * OfflineIndicator — Stage 4 offline reading, part 3. A quiet, non-modal
 * signal that this device has lost its connection: the open book keeps
 * working and its place is being kept locally, but the library needs a
 * connection to reach anything else.
 *
 * Renders nothing at all while online, and — since it auto-dismisses, see
 * `AUTO_HIDE_MS` below — nothing once an offline period's own attention
 * window has lapsed either. "Do not add clutter" (brief) means the honest
 * answer here is a single small element that only exists when it has
 * something to say, for as long as it has something to say.
 *
 * Placement: `ReaderTopBar` is `justify-between` — "Library" on the left,
 * the wordmark + fullscreen toggle on the right — leaving its middle
 * deliberately empty. This renders into that empty middle from a sibling
 * position in `ReaderShell`'s own markup (`absolute inset-x-0 top-0` against
 * the reader layout's `relative` container, the same anchor `ReaderTopBar`'s
 * own fullscreen `overlay` variant uses), so it never needs to touch
 * `ReaderTopBar.tsx` and never overlaps its two controls.
 *
 * `navigator.onLine` is asymmetric: a browser only ever reports `false` when
 * it is sure there is no link at all (radio off, airplane mode, adapter
 * down), so that side is trustworthy. It can still report `true` on a
 * captive portal or a dead upstream link — a false "online" — which this
 * component does not try to catch: proving connectivity would need a network
 * probe of its own, is out of scope for a cosmetic indicator, and the
 * asymmetry means silently trusting "online" degrades gracefully (the worst
 * case is staying quiet a little too long, never crying wolf).
 *
 * Connectivity itself comes from `useIsOffline` (`@/components/ui/
 * useOnlineStatus`) — extracted from this component for defect 3
 * (`OfflineShelf` needed the exact same live signal); see that hook's own
 * header for the `useSyncExternalStore` / SSR-snapshot reasoning, which is
 * unchanged by the move.
 */

export interface OfflineIndicatorProps {
  /** Mirrors `ReaderTopBar`'s own `hidden` — fullscreen with the deck closed
   *  reclaims the whole screen, so this fades with it and returns when the
   *  deck (and the top bar) do. Stays mounted rather than unmounting, same
   *  reasoning as `ReaderTopBar`: nothing here affects layout either way. */
  hidden?: boolean;
}

/**
 * The pill's own attention window: how long it stays up after each online →
 * offline transition before it retires itself.
 *
 * This is a NOTIFICATION — "you went offline, here's what that means" — not
 * a control, and that distinction is deliberate and load-bearing: contrast
 * `ReturnChip` (see that file's own header, and `JumpChip.tsx`), which is
 * the reader's one undo and therefore has NO timer, on purpose, because a
 * clock would retract the way back before someone who jumped, read a page,
 * and reconsidered had come back for it. Nothing here is undoable and
 * nothing is lost by this pill retiring itself: the book keeps paginating
 * and saving locally with or without it on screen, and dropping offline
 * again later shows it again (see the in-render transition handling below)
 * — so unlike `ReturnChip`, a clock costs this component nothing. Do not
 * "harmonise" these two by adding a timer to one or removing it from the
 * other; they are different in kind, not just in current tuning.
 *
 * 6s, from the founder's 5–8s range: comfortably long enough to read the
 * ~40-character message once (the `aria-live="polite"` region also
 * announces it to a screen reader on the same transition, independent of how
 * long the visual pill stays mounted), short enough not to linger
 * meaningfully into the reading session it's interrupting — this is the
 * least important surface in the reader and shouldn't overstay it.
 */
const AUTO_HIDE_MS = 6000;

/**
 * How long the DOM node lingers, invisible, after the auto-hide fade starts
 * before actually unmounting — long enough for the CSS opacity transition
 * below (`--leaf-dur-ui`, authored as 0.25s in `tokens.css`) to finish before
 * the element disappears outright, so the pill fades rather than pops.
 *
 * Kept as a plain constant rather than read from the CSS variable at
 * runtime (`getComputedStyle`, which needs a mounted element and a layout
 * pass to be reliable) — if `--leaf-dur-ui` is ever retuned, update this to
 * match. Safe either way: under `prefers-reduced-motion`, `--leaf-dur-ui`
 * neutralises to `0s`, so the opacity flips to 0 instantly and this timer
 * just delays the (already invisible, already `pointer-events-none`) node's
 * removal from the DOM — never a visible difference.
 */
const FADE_OUT_MS = 250;

function NoConnectionIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-[calc(var(--leaf-dock-icon)-4px)] w-[calc(var(--leaf-dock-icon)-4px)]"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5a16 16 0 0 1 6.6-3.4M14.4 5.1A16 16 0 0 1 21 8.5M6.2 12.4a11 11 0 0 1 4-2.1M13.8 10.3a11 11 0 0 1 2.9 1.4M9.5 16.2a5.5 5.5 0 0 1 5 0" />
      <path d="M2 2l20 20" />
    </svg>
  );
}

export function OfflineIndicator({ hidden = false }: OfflineIndicatorProps) {
  const offline = useIsOffline();

  // `presence` is this component's own lifecycle — not shown yet / shown /
  // fading out before unmount — kept separate from `offline` (which just
  // mirrors `navigator.onLine` and stays `true` for the whole outage) so the
  // pill can retire itself mid-outage instead of pinning up for the whole
  // thing.
  //
  // The online→offline / offline→online transition itself is handled
  // in-render, NOT in a `useEffect` — this is React's own sanctioned
  // "adjusting state when a prop changes" pattern (a synchronous `setState`
  // call during render, guarded by comparing against the previous value also
  // held in state: https://react.dev/learn/you-might-not-need-an-effect
  // #adjusting-some-state-when-a-prop-changes), not the "setState
  // synchronously in an effect" cascading-render footgun this file's own
  // header already calls out for `navigator.onLine` itself. React discards
  // and immediately re-renders when the two disagree, so nothing ever paints
  // a stale frame, and — critically for "hide immediately on reconnect" —
  // there is no effect-scheduling delay between the browser's `online` event
  // and the pill disappearing.
  const [trackedOffline, setTrackedOffline] = useState(offline);
  const [presence, setPresence] = useState<"hidden" | "shown" | "leaving">(
    offline ? "shown" : "hidden",
  );
  if (offline !== trackedOffline) {
    setTrackedOffline(offline);
    setPresence(offline ? "shown" : "hidden");
  }

  // Auto-hide: once shown, retire to "leaving" after `AUTO_HIDE_MS` — set
  // from inside the timer callback, i.e. "subscribe to an external system
  // (the clock), call setState when it fires," the pattern effects are
  // actually for, never a bare synchronous call in the effect body. Keyed on
  // `presence` rather than `offline`: entering "shown" is what starts the
  // clock, and it only enters "shown" fresh on an actual transition (the
  // in-render adjustment above), so a steady offline period (or a steady
  // online one) between re-renders never restarts it — exactly "show on each
  // transition, then auto-hide" plus "drop again later, show again."
  useEffect(() => {
    if (presence !== "shown") return;
    const hideTimer = window.setTimeout(
      () => setPresence("leaving"),
      AUTO_HIDE_MS,
    );
    return () => window.clearTimeout(hideTimer);
  }, [presence]);

  // Second stage: once the auto-hide fires, hold the (now invisible) node
  // mounted just long enough for the opacity transition to finish, then drop
  // it.
  useEffect(() => {
    if (presence !== "leaving") return;
    const unmountTimer = window.setTimeout(
      () => setPresence("hidden"),
      FADE_OUT_MS,
    );
    return () => window.clearTimeout(unmountTimer);
  }, [presence]);

  if (presence === "hidden") return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center [transition:opacity_var(--leaf-dur-ui)_var(--leaf-ease)]"
      style={{
        opacity: hidden || presence === "leaving" ? 0 : 1,
        paddingTop: `calc(var(--leaf-reader-bar-pad-y) + var(--leaf-safe-top))`,
      }}
    >
      <p
        role="status"
        aria-live="polite"
        aria-label="You're offline. This book keeps working and your place is being saved on this device. The library needs a connection."
        className="flex items-center gap-[var(--leaf-space-2)] whitespace-nowrap rounded-pill border px-[var(--leaf-space-3)] font-mono uppercase [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-wide)]"
        style={{
          background: "var(--leaf-dock-bg)",
          borderColor: "var(--leaf-dock-border)",
          color: "var(--leaf-dock-text-muted)",
          height: "var(--leaf-dock-h)",
        }}
      >
        <NoConnectionIcon />
        <span aria-hidden>Offline — saved on this device</span>
      </p>
    </div>
  );
}
