"use client";

import type { ReactNode, RefObject } from "react";

/**
 * SpreadFrame — the open-book frame (SPEC §8). Presentational + token-driven;
 * recreates the approved v0.1 `.book-frame` / `.book` / `.book::after` gutter /
 * `.folio` / `.turnzone` rules with Leaf tokens.
 *
 * epub.js mounts its paginated rendition into `viewerRef`. The crossfade on a
 * page turn is a plain opacity dip driven by `--leaf-reader-turn-opacity` +
 * `--leaf-dur-turn` (both collapse to a no-op under prefers-reduced-motion);
 * ReaderShell toggles `turning`.
 */

export interface SpreadFrameProps {
  viewerRef: RefObject<HTMLDivElement | null>;
  frameRef: RefObject<HTMLDivElement | null>;
  turning: boolean;
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
  turning,
  loading,
  folioLeft,
  folioRight,
  onPrev,
  onNext,
  children,
}: SpreadFrameProps) {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center pb-4"
      style={{ paddingInline: "var(--leaf-reader-frame-pad-x)" }}
    >
      <div
        ref={frameRef}
        className="relative h-full overflow-hidden rounded-sm bg-page transition-opacity [box-shadow:var(--leaf-shadow-book)] [transition-duration:var(--leaf-dur-turn)] [transition-timing-function:var(--leaf-ease-inout)]"
        style={{
          width: "var(--leaf-reader-frame-w)",
          maxHeight: "var(--leaf-reader-frame-max-h)",
          opacity: turning ? "var(--leaf-reader-turn-opacity)" : 1,
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

        {/* Tap zones for turning (supplementary to the bottom-bar buttons). */}
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={onPrev}
          className="absolute inset-y-0 left-0 z-[7] w-[14%] cursor-pointer"
        />
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={onNext}
          className="absolute inset-y-0 right-0 z-[7] w-[14%] cursor-pointer"
        />

        {folioLeft != null && (
          <span className={`${folioClass} left-8`}>{folioLeft}</span>
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
    </div>
  );
}
