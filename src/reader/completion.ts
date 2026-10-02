// Finished-book detection (Stage 1: detect and record). LOGIC ONLY — pure and
// framework-free; it reads the engine's `relocated` stream and calls back once.
//
// The rule, and why it is shaped this way:
//
//   - `percentageFromCfi` rarely reaches 1.0, and back matter (colophon,
//     licence, endnotes) keeps the last page well below it. So percent cannot
//     be the trigger: `atEnd` — epub.js's own "final page of the final
//     section" — is, and percent is only a sanity check that the reader is
//     really near the end of the text.
//   - The end must be reached by TURNING PAGES, never by a jump. Landing on the
//     last page from the contents, a bookmark or a sync offer says where the
//     reader is, not that they read there.
//   - A reader who jumps from the contents to the last chapter and pages to the
//     end has not finished the book. So a skip ahead is remembered, and blocks
//     the finish until the reader returns to where they skipped from.
//   - When unsure, do nothing. A missed finish costs the reader one more
//     page-turn at the end of some later session; a wrongly marked one tells
//     them they finished a book they did not read. Every ambiguous case below
//     resolves to "do not fire".

import type { ReaderLocation } from "./engine";

/**
 * The reader must be at least this far through the book (`percent`, 0..1) for
 * `atEnd` to count. A sanity floor only — NOT the trigger (see header). Set
 * well below 1.0 because back matter and the locations table's granularity
 * leave the true last page at roughly 0.95–0.99; set high enough that a
 * misreported `atEnd` on a short or oddly-spined book cannot fire mid-text.
 */
export const MIN_FINISH_PERCENT = 0.9;

/**
 * An UNTRUSTED jump landing more than this far past the furthest point read by
 * turning pages is a skip ahead. 5% is roughly a chapter or two of a novel —
 * far enough that float rounding, a re-flow after a font change, or the
 * spine-estimate wobble on a first open (see `ReaderLocation.estimated`) never
 * reads as a skip, near enough that a contents jump over real text does.
 */
export const SKIP_AHEAD_MARGIN = 0.05;

/**
 * A jump back to within this of where the reader skipped from counts as
 * "returned to where they were", clearing the skip. The same width as the skip
 * margin, deliberately: a landing that close to the skip point would not have
 * counted as a skip ahead of it in the first place. This is what lets the
 * return chip work WITHOUT being trusted — it brings a reader back to genuine
 * ground, which this margin recognises, and nowhere else.
 */
export const RETURN_MARGIN = SKIP_AHEAD_MARGIN;

export interface CompletionTracker {
  /**
   * Start tracking from `initialPercent` (0..1; 0 if the book has no saved
   * position). Everything observed before this is ignored — the engine emits
   * relocations during open that say nothing about reading.
   */
  arm(initialPercent: number): void;
  /**
   * The next `"jump"` is one the reader's own saved place caused (restore,
   * accepting a cross-device sync offer, the return chip) — not a skip. It
   * moves `furthest` instead of counting as skipping ahead. Consumed by that
   * jump, and cleared by any page turn so a jump that never relocated cannot
   * leave a later contents jump trusted.
   */
  markTrusted(): void;
  observe(loc: ReaderLocation): void;
}

export function createCompletionTracker(opts: {
  alreadyFinished: boolean;
  onFinished: () => void;
}): CompletionTracker {
  let armed = false;
  let fired = false;
  let trusted = false;
  // Furthest point reached by turning pages (or restored to), 0..1.
  let furthest = 0;
  // Where the reader stood when they last skipped ahead, if they have not since
  // come back. Undefined = no unresolved skip.
  let skippedFrom: number | undefined;

  return {
    arm(initialPercent) {
      armed = true;
      furthest = Number.isFinite(initialPercent) ? initialPercent : 0;
    },

    markTrusted() {
      if (!armed) return;
      trusted = true;
    },

    observe(loc) {
      if (!armed) return;
      const percent = loc.percent;
      if (!Number.isFinite(percent)) return;

      switch (loc.cause) {
        case "next":
        case "prev":
          furthest = Math.max(furthest, percent);
          trusted = false;
          break;

        case "jump":
          if (trusted) {
            furthest = Math.max(furthest, percent);
            skippedFrom = undefined;
            trusted = false;
          } else if (percent > furthest + SKIP_AHEAD_MARGIN) {
            // Keep the EARLIEST skip point. Paging on after a skip raises
            // `furthest`, so a second skip measured from there would forget
            // the unread stretch behind the first one.
            skippedFrom =
              skippedFrom === undefined ? furthest : Math.min(skippedFrom, furthest);
          } else if (
            skippedFrom !== undefined &&
            percent <= skippedFrom + RETURN_MARGIN
          ) {
            skippedFrom = undefined;
          }
          break;

        default:
          // "other" (or absent): the engine could not attribute it — a
          // resize, a scroll-settle duplicate, locations finishing. Unknown
          // is never evidence of reading.
          return;
      }

      if (
        loc.cause === "next" &&
        loc.atEnd === true &&
        percent >= MIN_FINISH_PERCENT &&
        (skippedFrom === undefined || skippedFrom >= MIN_FINISH_PERCENT) &&
        !opts.alreadyFinished &&
        !fired
      ) {
        fired = true;
        opts.onFinished();
      }
    },
  };
}
