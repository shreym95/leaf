# Implementation plan — design iteration 1

Agreed with the founder 2026-09-09. Four stages. Stages 1 and 2 were briefed and
handed to agents on the same day; 3 and 4 are planned but not yet approved in detail.

| Stage | Scope | Branch | State |
|---|---|---|---|
| 1 | Library shelf — hero card, fixed-column grid, card treatment | `feat/shelf` | briefed |
| 2 | Reader dock — resting pill, expanded deck, TOC, ribbon bookmark | `feat/dock` | briefed |
| 3 | Reading brightness in the dock | — | planned |
| 4 | Seekable progress + hero chapter label (migration `0007`) | — | planned |

Stages 1 and 2 touch disjoint files and run in parallel. `tokens.css` was the one
file both would have needed, so its skeleton went in first, on `dev`, before either
branch was cut (commit `8017d83`).

---

## Decisions taken before briefing

These are settled. They are recorded because several of them contradict the
handoff, and a future reader will otherwise "fix" them back.

**The dock goes over the existing two-page spread**, not the prototype's single
620px column. Deleting the spread would discard D2's undrift tuning and D4's
aspect lock, and the prototype was authored at phone width — where Leaf is already
single-column. Single-column-everywhere remains available later as a change to
`--leaf-reader-frame-*`, not a rewrite.

**Two themes, not three.** Sepia was retired the same day (migration `0006`). This
makes the handoff's 2-state sun/moon slider correct as drawn rather than a
simplification — three themes would have needed a picker.

**Hero covers stay 2:3 with `object-contain`,** against the handoff's `3/4`.
Cropping covers was defect D3; 2:3 is the ratio nearly every real cover uses. See
`DESIGN.md` §11.

**Immersive keeps only its fullscreen half.** Its value was never hiding Leaf's own
bars — it is removing the *browser's* URL bar, which is 56–90px that no dock design
can reclaim, and which never auto-collapses here because `100dvh` + `overflow:
hidden` means nothing scrolls. The resting pill is small enough to stay visible, so
the top bar and dock no longer hide, and the centre tap band opens the deck instead
of toggling chrome. D1's fix (no inert middle of the screen) survives intact.

**Tier 1 keeps labelled `‹` / `›` buttons.** The tap zones are `tabIndex={-1}` by
design, so the bottom bar currently holds the only keyboard- and AT-reachable page
turns. Deleting it without replacement would be an a11y regression the handoff did
not consider.

**Motion reuses `--leaf-ease` and `--leaf-dur-ui`.** `--leaf-ease` is already the
handoff's exact `cubic-bezier(0.22, 0.61, 0.36, 1)`, and the reduced-motion block at
the foot of `tokens.css` zeroes both. Hard-coding the handoff's 180–240ms would
silently escape reduced motion.

**Notes are deferred.** The `≡` pod ships Contents-only, built as a tabbed panel
whose tab bar appears only above one tab, so Notes slots in later without a
redesign. To avoid stranding the bookmark list when the top bar's Notes button
goes, the `⋯` settings sheet gains one row opening the existing `NotesPanel`.

---

## Stage 3 — reading brightness (planned)

Web cannot touch the backlight, so brightness is a rendering choice. Founder picked
the **warm scrim**: one fixed overlay above everything, `pointer-events: none`,
`background: var(--leaf-dim-scrim)` (a warm near-black `#0b0805`, not pure black, so
dimming doubles as night-shift), `opacity: var(--leaf-dim)`.

Rejected: `filter: brightness()`, outright — `filter` makes an element the containing
block for `position: fixed` descendants, which would break the dock. Also rejected:
driving the paper/ink tokens via `color-mix()`, which holds contrast constant by
construction but hits the two-documents problem and would re-inject styles into the
epub.js iframe on every slider move.

**The real work is the clamp, not the slider.** Dimming costs contrast: a scrim at
~50% takes Day from roughly 14.6:1 to roughly 4.5:1, the AA floor. So the slider's
range is bounded per theme by `--leaf-dim-max`, which is a computed accessibility
ceiling and not a preference. Night starts dark and has far less headroom. A test
must assert that composited body text clears 4.5:1 at `--leaf-dim-max` for every
theme, so adding a theme later cannot quietly break it.

**Persistence is per-device (`localStorage`), deliberately not synced.** Brightness
is ambient, like volume — a phone's midnight setting should not follow the reader to
a daylight laptop. No migration.

**Placement:** a sixth pod opening a slider popover, reusing the `≡` popover
mechanism. Six pods plus the font stepper is roughly 300px on a 360px phone, which
fits but is tight; if it proves cramped, the deck's Tier 2 wraps to two rows below
~340px rather than the pod being moved somewhere less discoverable.

## Stage 4 — seek and chapter label (planned)

**Drag-to-seek** on the Tier 1 track. Maps a fraction to a CFI via `book.locations`,
which is why D7 (cached locations) had to land first — without it the scrub is dead
for the first seconds of every open. Stage 2 builds the track's structure so the
handler drops in without a redesign.

**Hero chapter label.** `reading_state` holds only `cfi, percent, updated_at`, and
resolving a CFI to a chapter title needs the EPUB open, which the shelf will not do.
Add `chapter_label text` in migration `0007` and write it from the debounced flush in
`src/reader/position.ts`, which already has `currentChapterLabel()` from the bookmarks
work. Books already in progress show no label until their next page turn — acceptable,
and cheaper than a backfill that would have to open every book.

**Time remaining** ("~18m left") stays unbuilt: it needs the WPM model in
`REVISED_PLAN.md` §4D. Rendering a fabricated estimate is worse than omitting it.
