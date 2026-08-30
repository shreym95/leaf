"use client";

/**
 * ReaderBottomBar — the reader footer (SPEC §8). Layout mirrors the approved
 * v0.1 `.footer`: prev · progress track (`--leaf-accent` fill) · next · `NN%`.
 * Presentational + token-driven. Hidden (not unmounted) in immersive mode.
 */

export interface ReaderBottomBarProps {
  /** 0–1 progress through the book. */
  percent: number;
  hidden: boolean;
  onPrev: () => void;
  onNext: () => void;
}

const navClass =
  "rounded-sm px-3 py-1 font-mono text-ink-mid transition-colors hover:bg-rule hover:text-ink " +
  "[font-size:var(--leaf-text-lg)] [transition-duration:var(--leaf-dur-ui)] " +
  "focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]";

export function ReaderBottomBar({
  percent,
  hidden,
  onPrev,
  onNext,
}: ReaderBottomBarProps) {
  const pct = Math.round(Math.min(1, Math.max(0, percent)) * 100);

  return (
    <footer
      className="z-30 flex flex-none items-center justify-center gap-6 transition-opacity [transition-duration:var(--leaf-dur-ui)] [padding-block:var(--leaf-reader-bar-pad-y)] [padding-inline:var(--leaf-reader-bar-pad-x)]"
      aria-hidden={hidden}
      inert={hidden}
      style={hidden ? { opacity: 0 } : { opacity: 1 }}
    >
      <button
        type="button"
        onClick={onPrev}
        aria-label="Previous page"
        className={navClass}
      >
        ‹
      </button>

      <div
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="relative overflow-hidden rounded-xs bg-rule"
        style={{
          width: "var(--leaf-reader-progress-w)",
          height: "var(--leaf-reader-progress-h)",
        }}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-xs [background:var(--leaf-accent)] [transition:width_var(--leaf-dur-ui)_var(--leaf-ease-inout)]"
          style={{ width: `${pct}%` }}
        />
      </div>

      <button
        type="button"
        onClick={onNext}
        aria-label="Next page"
        className={navClass}
      >
        ›
      </button>

      <span
        aria-hidden
        className="min-w-[7ch] text-center font-mono text-faint [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-wide)]"
      >
        {pct}%
      </span>
    </footer>
  );
}
