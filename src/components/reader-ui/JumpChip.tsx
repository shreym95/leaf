"use client";

/**
 * JumpChip — the shared shell behind the reader's two "your place moved"
 * prompts: `ReturnChip` (undo a jump you just made) and `SyncOfferChip`
 * (offered a further position synced from another device). Both are meant to
 * read as the SAME layer of chrome — the dock's own surface tokens, not a
 * notification — so this is the one place that markup and tokens live; the
 * two callers differ only in icon, copy, and what their primary action does.
 *
 * Two sibling `<button>`s, never a button nested inside a button: a control
 * cannot contain another interactive element (invalid HTML, and it breaks
 * keyboard traversal and screen readers). The dismiss control is entirely
 * optional (`onDismiss` omitted) — a caller with nothing to dismiss just gets
 * the single primary action, which is also what keeps `ReturnChip`'s
 * existing call sites (and tests) working unchanged. A hairline divider (the
 * dock's own border token, not a new colour) is what keeps the pair reading
 * as one object instead of two floating pills; the outer border + shadow is
 * drawn once, around both, for the same reason.
 */

export interface JumpChipProps {
  icon: React.ReactNode;
  label: string;
  ariaLabel: string;
  onActivate: () => void;
  /** Omit to render the primary action alone, with no dismiss control. */
  onDismiss?: () => void;
  /** Required together with `onDismiss` — what, specifically, is being
   *  dismissed ("Dismiss" alone doesn't say). */
  dismissAriaLabel?: string;
}

export function JumpChip({
  icon,
  label,
  ariaLabel,
  onActivate,
  onDismiss,
  dismissAriaLabel,
}: JumpChipProps) {
  return (
    <div
      // `max-width` is viewport-relative, not a fixed character count: a
      // fixed `18ch` cut a real chapter title off with no way to read it (a
      // production defect, founder 2026-09-28 — the chip read "Continue
      // from…" and named no destination). This instead takes whatever room
      // the screen has, short of its own side margins, so the label
      // (shortened first — see `chapter-label.ts`'s `shortenForJumpChip` —
      // and only truncated by CSS as a last resort) gets the width it needs
      // rather than an arbitrary cap.
      className="absolute left-1/2 z-30 flex -translate-x-1/2 items-stretch border"
      style={{
        top: "var(--leaf-jump-chip-top)",
        maxWidth:
          "calc(100vw - (2 * var(--leaf-space-4)) - var(--leaf-safe-left) - var(--leaf-safe-right))",
        background: "var(--leaf-dock-bg)",
        borderColor: "var(--leaf-dock-border)",
        color: "var(--leaf-dock-text)",
        boxShadow: "var(--leaf-dock-shadow)",
        height: "var(--leaf-dock-h)",
        borderRadius: "var(--leaf-dock-radius)",
      }}
    >
      <button
        type="button"
        onClick={onActivate}
        aria-label={ariaLabel}
        className="flex min-w-0 items-center gap-[var(--leaf-space-2)] px-[var(--leaf-space-4)] font-mono uppercase outline-none [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-wide)] [transition:background_var(--leaf-dur-ui)_var(--leaf-ease)] hover:[background:var(--leaf-dock-hover)] focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
        style={{
          borderRadius: onDismiss
            ? "var(--leaf-dock-radius) 0 0 var(--leaf-dock-radius)"
            : "var(--leaf-dock-radius)",
        }}
      >
        {icon}
        {/* `min-w-0` lets this shrink inside the flex button — without it a
            flex item's default `min-width: auto` refuses to shrink below its
            content's natural width, and `truncate` never gets the chance to
            fire at all. `truncate` itself is now a rare safety net (the
            content's own length is already bounded by `shortenForJumpChip`),
            not the primary way this label gets kept short. */}
        <span className="min-w-0 truncate">{label}</span>
      </button>

      {onDismiss && (
        <>
          {/* Hairline divider, inset from the top/bottom edge — a full-height
              line would visually merge with the outer border. */}
          <span
            aria-hidden
            className="my-[var(--leaf-space-2)] w-px flex-none"
            style={{ background: "var(--leaf-dock-border)" }}
          />
          <button
            type="button"
            onClick={onDismiss}
            aria-label={dismissAriaLabel}
            // Square tap target matching the chip's own height (40px, the
            // dock's established control size app-wide) — comfortably above
            // the WCAG 2.5.8 24px floor, and separated from the primary
            // button by the divider's own padding rather than sitting flush
            // against it, so reaching for one control doesn't risk the other.
            className="flex items-center justify-center outline-none [transition:background_var(--leaf-dur-ui)_var(--leaf-ease)] hover:[background:var(--leaf-dock-hover)] focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
            style={{
              minWidth: "var(--leaf-dock-h)",
              borderRadius: "0 var(--leaf-dock-radius) var(--leaf-dock-radius) 0",
            }}
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-[calc(var(--leaf-dock-icon)-4px)] w-[calc(var(--leaf-dock-icon)-4px)]"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
