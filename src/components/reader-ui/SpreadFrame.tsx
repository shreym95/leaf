"use client";

import type { ReactNode, RefObject } from "react";

/**
 * SpreadFrame — the open-book frame (SPEC §8). Presentational + token-driven;
 * recreates the approved v0.1 `.book-frame` / `.book` / `.book::after` gutter /
 * `.folio` / `.turnzone` rules with Leaf tokens.
 *
 * epub.js mounts its paginated rendition into `viewerRef` and swaps page
 * content itself. Page turns are instant — no fade (the opacity-dip version
 * read as text flicker against the static paper). Motion is a next-version
 * polish item per SPEC §8.
 */

export interface SpreadFrameProps {
  viewerRef: RefObject<HTMLDivElement | null>;
  frameRef: RefObject<HTMLDivElement | null>;
  loading: boolean;
  folioLeft?: number;
  folioRight?: number;
  onPrev: () => void;
  onNext: () => void;
  children?: ReactNode;
}

const folioClass =
  "pointer-events-none absolute bottom-6 z-10 font-mono uppercase text-faint " +
  "[letter-spacing:var(--leaf-tracking-label)] [font-size:var(--leaf-text-3xs)]";

export function SpreadFrame({
  viewerRef,
  frameRef,
  loading,
  folioLeft,
  folioRight,
  onPrev,
  onNext,
  children,
}: SpreadFrameProps) {
  return (
    <main
      aria-label="Reader"
      className="flex min-h-0 flex-1 items-center justify-center"
      style={{
        // The safe-area insets go on THIS element, not on the viewer: the viewer
        // is epub.js's container and padding it desynchronises the column width
        // from the visible box. Here the whole page is inset instead, so epub.js
        // still measures an unpadded box — just a smaller one.
        paddingLeft: `calc(var(--leaf-reader-frame-pad-x) + var(--leaf-safe-left))`,
        paddingRight: `calc(var(--leaf-reader-frame-pad-x) + var(--leaf-safe-right))`,
        paddingTop: "var(--leaf-safe-top)",
        paddingBottom: `calc(var(--leaf-reader-frame-pad-b) + var(--leaf-safe-bottom))`,
      }}
    >
      <div
        ref={frameRef}
        className="relative h-full overflow-hidden bg-page"
        style={{
          borderRadius: "var(--leaf-reader-frame-radius)",
          boxShadow: "var(--leaf-reader-frame-shadow)",
          width: "var(--leaf-reader-frame-w)",
          maxHeight: "var(--leaf-reader-frame-max-h)",
        }}
      >
        {/* Centred gutter shadow — desktop only (hidden < 1024px). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 z-[5] hidden -translate-x-1/2 lg:block"
          style={{
            width: "var(--leaf-reader-gutter-w)",
            background: "var(--leaf-reader-gutter-bg)",
          }}
        />

        {/* epub.js rendition target. */}
        <div
          ref={viewerRef}
          className="absolute inset-0"
          style={{
            padding:
              "var(--leaf-reader-viewer-pad-y) var(--leaf-reader-viewer-pad-x)",
          }}
        />

        {/* Tap zones for turning — supplementary to the labelled bottom-bar
            buttons and the ←/→ keys. Kept out of the tab sequence (tabIndex
            -1) but given real names rather than aria-hidden, so they are not
            focusable-yet-hidden (an axe violation). */}
        <button
          type="button"
          aria-label="Previous page"
          tabIndex={-1}
          onClick={onPrev}
          className="absolute inset-y-0 left-0 z-[7] w-[14%] cursor-pointer"
        />
        <button
          type="button"
          aria-label="Next page"
          tabIndex={-1}
          onClick={onNext}
          className="absolute inset-y-0 right-0 z-[7] w-[14%] cursor-pointer"
        />

        {/* Folios are a framed-page affordance: with the mat gone below `lg`
            they land on top of the prose, so they only appear alongside the
            frame. Progress lives in the bottom bar regardless. */}
        {folioLeft != null && (
          <span className={`${folioClass} left-8 hidden lg:block`}>
            {folioLeft}
          </span>
        )}
        {folioRight != null && (
          <span className={`${folioClass} right-8 hidden lg:block`}>
            {folioRight}
          </span>
        )}

        {loading && (
          <p className="absolute inset-0 z-10 flex items-center justify-center font-mono uppercase text-faint [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-label)]">
            Opening the book…
          </p>
        )}

        {children}
      </div>
    </main>
  );
}
