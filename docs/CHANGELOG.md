# Changelog

All notable changes to Leaf. Kept per milestone (see SPEC §9).

## Feature — reader dock (design iteration 1 §9B, stage 2)

The reader's `ReaderTopBar` + `ReaderBottomBar` chrome is replaced by the
two-state **dock** from `FRONTEND_HANDOFF.md` §3.

### What shipped

- **State A — resting pill.** One `<button>` in the bottom safe zone: chapter
  badge · 130px hairline progress · percent badge · settings-hint circle. Its
  accessible name carries the live percent + chapter; the visuals are
  `aria-hidden`. Tapping / Enter opens state B.
- **State B — expanded deck.** Tier 1: `‹` · progress island (chapter title +
  page ratio) · `›`. Tier 2: sun/moon theme toggle · `A− / A+` font stepper ·
  `≡` contents popover · `⋯` settings · `✕` close. Closes on `✕`, Esc, a tap
  outside the deck, or a page turn from outside the deck.
- **`TocPopover`** — chapter drawer above the `≡` pod, built as a tabbed panel
  whose tab bar renders only when `TABS.length > 1` (one tab, "Contents", today).
- **`RibbonBookmark`** — 18×28 tab on the frame's top edge, right-aligned to the
  text column, wired to `ReaderShell.toggleBookmark`; fill goes `--leaf-rule` →
  `--leaf-accent` and the name flips when the current CFI is bookmarked.
- **Top bar** slimmed to `← Library` + `Leaf` wordmark. Book title/author now
  set `document.title` (the browser tab) instead of painting in the bar.
- **`src/reader/engine.ts`** gains `toc(): { href, label }[]` — the EPUB
  navigation flattened depth-first, reusing `chapterLabelForHref`'s machinery.
  Style-agnostic; the seam rule is untouched.

### Files

- **New:** `ReaderDock.tsx`, `TocPopover.tsx`, `RibbonBookmark.tsx` (+ tests).
- **Changed:** `ReaderShell.tsx`, `ReaderTopBar.tsx`, `SpreadFrame.tsx`,
  `useImmersive.ts` (doc only — API unchanged), `reader-ui/index.ts`,
  `src/reader/engine.ts`, `src/design/tokens.css` (added `--leaf-dock-popover-w`
  and the `--leaf-ribbon-*` family — geometry only, no colour).
- **Deleted:** `ReaderBottomBar.tsx` (had no test); `ImmersiveExit.tsx` — see
  below.

### `ImmersiveExit` did not survive

Its whole job was "there is no way out of immersive on a touch device once every
bar is hidden". Immersive no longer hides Leaf's chrome (decision 3) — the
resting pill and top bar stay up — so there is nothing to be trapped in, and the
browser's own Esc / back-gesture leaves fullscreen (`fullscreenchange` already
syncs the flag). `useImmersive` keeps its Fullscreen-API logic unchanged and is
still bound to `F`.

### Deviations from the handoff, and why

1. **Applied over the existing epub.js spread, not the prototype's single
   column** (REVISED_PLAN §9D1). The dock is chrome; it does not touch the
   book's pagination or the `content-hook` pipeline.
2. **Motion tokens, not literal 180–240ms / `cubic-bezier(…)`.** Everything uses
   `--leaf-dur-ui` (250ms) + `--leaf-ease` (already the handoff's exact curve),
   so the reduced-motion block at the foot of `tokens.css` zeroes it for free.
   The handoff's `@keyframes flatSlideUp` / `popoverFade` became plain
   opacity+transform transitions on a state flip — no keyframes, same effect,
   reduced-motion-correct.
3. **Tier 1 gains real `‹` / `›` buttons** the handoff did not draw (decision 2).
   `SpreadFrame`'s tap zones are `tabIndex=-1`, so deleting the bottom bar
   without these would drop the only keyboard/AT-reachable page turns. They are
   in the tab order and do **not** close the deck (so a keyboard user can page
   with it open); page turns from *outside* the deck do close it.
4. **Tier 2 has five pods, not four.** The brief adds `⋯ settings` (opens the
   existing `ReaderSettingsSheet`) since "Aa" left the top bar. Bookmark stays
   removed from the deck; the ribbon is separate.
5. **The resting badge shows the truncated current chapter label, not "Ch. 4".**
   EPUB TOCs are free-text with no reliable ordinal; a synthetic number would be
   wrong for any book with front matter. Truncated to 11ch with a `title`
   tooltip; the full label is in the button's accessible name.
6. **Tier 1's right-hand metric is "Page N of M" (per section) or the percent —
   never a time estimate.** The WPM model (§4D / §9B req 1) is unbuilt and the
   brief forbids a fabricated "~14m left".
7. **The progress track is a static `progressbar`, not the handoff's seekable
   `slider`.** Drag-to-seek is stage 4 and needs `book.locations` (§9D6). The
   element is marked `STAGE 4 SEAM` — swapping in `role="slider"` + pointer
   handlers is a local change; the groove/fill geometry is already a slider's.
8. **The `≡` popover is a non-modal `role="dialog"` disclosure** (trigger
   `aria-expanded` + `aria-controls`, focus to the first chapter on open, Esc /
   outside-tap close, focus back to the trigger) — not a focus-trapped modal.
9. **No touch entry point to immersive.** The top bar's fullscreen button was
   removed with the rest of the bar and the centre tap band now drives the deck
   (decision 4). `F` is the only trigger — a deliberate downgrade of a
   feature decision 3 already shrank to "hide the browser URL bar". Worth a
   look in review if a touch affordance is still wanted.

### Decision the brief left to me

- **The centre tap band and the arrow keys close the deck on a page turn; the
  deck's own `‹` / `›` do not.** "Closes on … a page turn" would otherwise make
  the keyboard/AT page-turn buttons collapse the deck under the user on every
  press. `ReaderShell` splits `turn()` (dock arrows) from `turnAndCloseDeck()`
  (tap zones, arrow keys).
- **Opening the `⋯` settings sheet collapses the deck.** The deck and Radix both
  listen for Escape; leaving both open makes one Escape ambiguous.
- **A TOC jump closes the deck** (it is a navigation, like a page turn) and
  returns focus to the resting pill.
- **Font stepper range: 0.9–1.45 rem, step 0.06** (the handoff's numbers).

### Logic ↔ presentation couplings a future redesign must know

- **Theme toggle assumes exactly two registered themes.** It slides between
  `THEME_IDS[0]` and `THEME_IDS[THEME_IDS.length - 1]` and is registry-driven,
  but a third theme makes it lossy — it must revert to a picker (the pattern is
  the `ReaderSettingsSheet` "Theme" segmented control).
- **The dock font stepper writes a continuous `reader_settings.fontSize`; the
  settings sheet snaps the same column to S/M/L.** A value set in one shows
  rounded in the other. Both are the only writers of that column.
- **`chapterLabel` does double duty:** the resting badge, the progress-island
  title, and the "current chapter" mark in the TOC popover (matched by label
  equality against `toc()` entries — both derive from the same EPUB navigation).
- **`ReaderShell` owns `deckOpen`.** Lifted out of `ReaderDock` because a page
  turn and the `SpreadFrame` centre-tap band both need to reach it.
- **`--leaf-reader-progress-w` / `--leaf-reader-progress-h`** are now orphaned
  (only `ReaderBottomBar` used them). Left in `tokens.css` — harmless, and
  removing tokens is the stage-3/other-agent hazard the token skeleton was
  added to avoid.

### Tests

+33 tests (331 → 364), +3 files: `ReaderDock.test.tsx`, `TocPopover.test.tsx`,
`RibbonBookmark.test.tsx`. `SpreadFrame.test.tsx` and `ReaderShell.test.tsx`
updated for the new structure; `ReaderSettingsSheet.test.tsx` gains the Notes
row. `ReaderBottomBar` had no test to delete.

### Not verified: `next build` / `next dev`

Both panic in this worktree — Turbopack rejects the symlinked `node_modules`
("Symlink … points out of the filesystem root"), a pre-existing environment
issue unrelated to this change. `npm run typecheck`, `npm run lint` and
`npm test` are all green.
## Phase 2 — library shelf: "Continue reading" hero + fixed-column grid

Design iteration 1, requirement 1 (`REVISED_PLAN.md` §9A, stage 1). The library
gains a spotlight for the book you last had open, and the shelf grid stops
drifting between column counts.

### Added
- **`HeroCard.tsx`** — the "Continue reading" spotlight, pinned above the grid:
  mono-uppercase eyebrow, Fraunces title, author, a progress track with its
  percent, and a `Continue Reading →` link to `/reader/<id>`. Cover on the left
  with the 12px spine crease. Presentational; the only interactive element is
  the CTA link, so the card itself has no hover state.
- **`splitHeroBook(books, { enabled })`** (exported from `HeroCard.tsx`) — picks
  the hero (most recent `lastReadAt`) and returns the rest for the grid with the
  hero removed, so it never renders twice. `enabled: false` for the `?hidden=1`
  view; no hero at all until some book has been opened.
- **`--leaf-crease`** (`tokens.css`) — the spine-crease gradient, theme-
  independent, width set per surface by the existing `--leaf-hero-crease-w` /
  `--leaf-card-crease-w`.

### Changed
- **`Shelf.tsx`** — fixed columns (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`)
  replacing `auto-fill/minmax(10rem,1fr)`, which rendered anywhere from 3 to 5
  columns depending on width. `loading.tsx`'s skeleton grid matches.
- **`BookCard.tsx`** — the on-cover progress ribbon is gone; a card now carries
  a plain state label under the author: `UNREAD` (percent null *or* 0),
  `NN% READ`, `COMPLETED` (100%). The crease is now the `--leaf-crease` gradient
  at `--leaf-card-crease-w`, not `--leaf-shadow-spine`.
- **`library/page.tsx`** — composes `splitHeroBook`; renders `<HeroCard>` then
  `<Shelf>` with the hero-less list. Hidden view unchanged.
- **`DESIGN.md` §11** — rewritten for the gradient crease, the state label vs.
  the retired ribbon, and the hero cover following the same 2:3 `object-contain`
  rule.

### Decisions the brief left open
- **Hero cover ratio.** The handoff drew `3/4`; used 2:3 `object-contain` like
  `BookCard` (DEFECTS D3 — cropping covers was the bug). Deliberate deviation,
  per the task.
- **No hero hover-lift.** The prototype lifts the whole hero card on hover; kept
  it static because only the CTA is interactive and a lifting non-link reads as
  clickable. Cards keep their lift — they *are* links.
- **Hero eyebrow colour.** Prototype CSS says `--leaf-accent` (the handoff prose
  says `ink-mid`); matched the prototype and the existing library-page eyebrow.
- **Progress fill vs. track** on the hero is `--leaf-accent` on `--leaf-rule`
  (~2.7:1, under 1.4.11's 3:1). Accepted because the percent is also printed as
  text beside the bar and mirrored in `aria-valuenow` — value is never carried
  by the fill alone. This is the prototype's own choice.
- **Selection lives in the component layer** (`splitHeroBook`), not `@/lib` — it
  is view composition, tied to the hero presentation, and needs a plain unit
  test rather than a page render.
- **`loading.tsx`** was updated though it is outside the brief's file list — its
  whole job is to mirror `page.tsx`'s shape, so a stale grid would defeat it. No
  hero skeleton (it is conditional; would flash for readers with no history).

### Logic/presentation coupling (for the redesign)
- **`splitHeroBook` reads `LibraryBook.lastReadAt` and `.id`.** "Most recently
  read" is computed explicitly here, *not* inherited from `listBooks`' sort, so
  a query change cannot silently move the hero — but the two now encode the same
  rule in two places. If the shelf order changes, check this too.
- **`UNREAD` folds "never opened" (`percent: null`) and "opened, 0%"
  (`percent: 0`) together.** `reading_state` still distinguishes them; the shelf
  no longer does. A future "recently added" treatment that needs the difference
  must go back to the raw field.
- **`--leaf-shadow-spine` is now unused** (kept in `tokens.css`, with its night
  override, as documentation). Safe to delete when someone next touches that
  block.

## Change — two reading themes; sepia retired

Founder call, 2026-09-09: Leaf ships **Day** and **Night**. Sepia was built in
Phase 1 and is now removed everywhere.

### Why
Sepia's paper (`#ede2cb`) sat a shade off Day's (`#f1ebdc`), so it read as a
variant of Day rather than a distinct choice. Two themes also make the theme
control a *toggle* rather than a picker, which is what the reader dock in
`REVISED_PLAN.md` §9 specifies — the handoff's 2-state sun/moon slider now maps
exactly onto what exists.

### Removed
- `ThemeName` is `"day" | "night"` (`src/lib/types.ts`).
- The `[data-theme="sepia"]` palette block (`tokens.css`), the `PALETTES` entry
  (`content-theme.ts`), the `WASH` entry (`highlight-theme.ts`), and the registry
  entry (`themes.ts`). Steps 3–5 of "how to add a theme" are all
  `Record<ThemeName, …>`, so the compiler drove the removal.

### Added
- **`supabase/migrations/0006_two_themes.sql`** — narrows both CHECK constraints
  back to `{day, night}`.

### The one thing that is not symmetric
`0004` widened the constraints, which is free — no existing row could violate a
*larger* allowed set. **Narrowing is not.** A CHECK is validated against existing
rows when it is added, so `0006` moves the data first and tightens second; the
reverse order fails with "check constraint is violated by some row" and leaves
the schema untouched. Sepia rows fold to **day**, not night — sepia was a warm
*light* paper, and sending a reader who chose it to a near-black page would be a
far bigger change than the one they are actually losing.

### Also in this commit — token skeleton for design iteration 1
Added ahead of the stage 1 / stage 2 implementation agents, because `tokens.css`
is the one file both of them would otherwise have touched:
- `--leaf-dock-*` — dock geometry on `:root`, dock surface colours per theme.
  Motion deliberately reuses the existing `--leaf-ease` (already the iteration's
  exact `cubic-bezier(0.22, 0.61, 0.36, 1)`) and `--leaf-dur-ui` (250ms, inside
  the iteration's 180–240ms band), so the reduced-motion block at the foot of
  `tokens.css` keeps governing the dock for free rather than needing new gates.
- `--leaf-dim`, `--leaf-dim-scrim`, `--leaf-dim-max` — reading brightness
  (stage 3). The scrim is a warm near-black (`#0b0805`), not pure black, so
  dimming doubles as night-shift. `--leaf-dim-max` is a per-theme **ceiling, not
  a preference**: dimming costs contrast, and a black scrim at ~50% takes Day
  from ~14.6:1 to ~4.5:1. Night starts dark and so has far less headroom (0.25).
- `--leaf-hero-cover-w`, `--leaf-hero-crease-w`, `--leaf-card-crease-w` — shelf.

## Fix — progress percent no longer sits at 0 after opening a book (D7)

`book.locations.generate(1200)` walks every section to build the CFI table that
`percentageFromCfi` needs. It ran on every open, in the background, and percent
was honestly 0 until it finished — seconds on a full-length EPUB, which reads as
a broken progress bar. Founder's ask was "pre-load, then open".

Two changes, because neither alone covers both the first open and the rest.

### Added
- **`src/reader/locations-cache.ts`** — the generated table cached in
  `localStorage` as `leaf:locations:v1:<bookId>:<chars>`, loaded synchronously on
  the next open. Every open after the first has an exact percent before the first
  page paints.
- **`estimateProgress()`** (`src/reader/engine.ts`, exported for test) — a
  spine-position estimate, `(sectionIndex + pageFractionWithinSection) / sectionCount`,
  used only while the table is still generating.
- **`ReaderEngineOptions.bookId`** — keys the cache. Passed from `ReaderShell`.
  Omitted (tests, one-off renders), the engine behaves exactly as before.
- **`ReaderLocation.estimated`** — true while `percent` is the estimate rather
  than a locations reading. `cfi` is exact either way.
- `src/reader/locations-cache.test.ts` — 14 tests: round-trip, per-book and
  per-granularity keying, truncated entry, storage that throws, quota eviction,
  and the estimate's bounds.

### Decisions
- **`localStorage`, not a `books.locations` column.** The table is derived, not
  state; per-device is fine; and a book's bytes never change after upload (a
  re-upload mints a new row and a new `bookId`), so the id alone is a sound key.
  That avoids a migration and a server round-trip, and `localStorage` is
  synchronous — a cache hit is ready *before* the first `relocated` event, where
  an IndexedDB read would land a tick late and still flash a 0. Phase 3 moves
  book bytes into IndexedDB (`REVISED_PLAN.md` §5); the table belongs beside them
  then, and `locations-cache.ts` is the only file that changes.
- **The estimate weights every section equally**, so it is not the real
  percentage — a long chapter advances it too slowly. It is monotonic, instant,
  and never a flat 0 on chapter twelve, which is the whole complaint. The exact
  value replaces it as soon as the table is ready.
- **A truncated cache entry is treated as a miss.** `locations.load()` accepts it
  happily and leaves `total` at -1, which makes every percentage NaN — worse than
  no cache. Read validates the JSON array delimiters and `length() > 0`.
- **Quota errors evict other books' tables and retry once**, so the book being
  read now is the one that stays cached.

### Logic/presentation coupling (for the redesign)
- None. `locations-cache.ts` is pure logic; the only UI-visible change is that
  `percent` arrives non-zero sooner. A future dock with a drag-to-seek track
  (`REVISED_PLAN.md` §9) depends on the same `book.locations`, so it inherits
  this for free.

### Known gap
- The very first open of a book still generates the table in the background. The
  estimate hides it; nothing removes the work.

## Docs — design iteration 1 filed (library shelf + reader dock)

Founder handed over a redesign on 2026-09-09: a spec plus two runnable
prototypes. Nothing shipped — this entry records where it lives and what it
implies, so the implementation does not have to re-derive it.

### Added
- **`docs/design-iterations/2026-09-09-shelf-and-dock/`** — `FRONTEND_HANDOFF.md`
  (v2.1.0), `index.html` (library prototype), `reader.html` (reader prototype),
  plus a `README.md` naming the two things that do not survive the copy: the
  handoff's `/home/shrey/leaf-design/…` paths are the designer's machine, and the
  prototypes style prose as ordinary DOM where Leaf styles it inside the epub.js
  iframe.
- **`REVISED_PLAN.md` §9** — the two requirements scoped against the shipped
  code, plus §6 Phase 2 items 4 and 5.

### Findings worth keeping
- **The one structural fork (§9D1):** the reader prototype is a single 620px
  column. The shipped reader is a two-page spread above 1024px (D4). Requirement
  2's dock works over either, but "strict single-page pagination" would delete
  the spread. Founder decision, not an implementation detail.
- **The hero card needs a field we do not store.** `reading_state` holds
  `cfi, percent, updated_at`; the hero wants a chapter label, and resolving a CFI
  to a chapter title needs the EPUB open — which the shelf will not do. Shape of
  the fix: `chapter_label text` in migration `0006`, written from the debounced
  flush in `src/reader/position.ts`, which already has `currentChapterLabel()`
  from the bookmarks work.
- **Time-remaining ("~18m left") has no data behind it.** It needs the WPM model
  in REVISED_PLAN §4D, which is unbuilt. Render percent only until it exists.
- **The ribbon bookmark is unblocked.** `reader.html` specifies it as an 18×28px
  top-edge tab with a `clip-path` notch — the visible design Phase 2 item 1 was
  waiting on. The handoff removes the bookmark *pod* from the dock but keeps the
  ribbon; those are not in conflict.
- **No font or theme work.** All four faces (`Fraunces`, `EB Garamond`,
  `Source Sans 3`, `JetBrains Mono`) are already loaded in `layout.tsx` and bound
  to token variables, and `day`/`sepia`/`night` already exist.
- **Token names differ, deliberately do not rename.** The handoff uses
  `--leaf-ink-primary/mid/faint`, `--leaf-bg-paper/page`, `--leaf-shadow-flat`.
  Map them onto the existing scale and add only the genuinely new `--leaf-dock-*`
  family; the current names are referenced from tests and `content-theme.ts`.
- **Two constraints the handoff omits:** its 180–240ms transitions must be gated
  behind `prefers-reduced-motion`, and the Tier 1 seek bar depends on
  `book.locations` — the same structure DEFECTS D7 is about, so D7 should land
  first or the scrub is dead until locations finish generating.

## Phase 2 — printer's fleuron at chapter ends

A small centred typographic ornament closing each real chapter (REVISED_PLAN
§4B / §6 Phase 2), for visual breath between chapters.

### Added
- **`CHAPTER_END_ORNAMENT`** (`src/design/content-theme.ts`) — the glyph, one
  exported constant (`❦`; alternatives named in a comment). Its one style rule
  is `.chapter-end` in `buildContentTheme` (centred, accent, display face,
  `text-indent:0`, generous space above). Swapping the glyph or restyling is a
  one-line edit in that file — nothing else moves.
- **`appendChapterEndOrnament`** (`src/reader/content-hook.ts`) — appends
  `<p class="chapter-end" aria-hidden="true">` to the normalized
  `<article class="chapter">`, in the per-chapter pipeline right after
  normalization and **before** the stylesheet inject + `"expand"` re-measure, so
  the extra trailing height is counted when epub.js re-measures the column
  (D2 / D5). `aria-hidden` — decoration, never voiced.

### Logic/presentation coupling (for the redesign)
- The ornament node is minted in `content-hook.ts` (logic) but its glyph and
  its only style rule live in `content-theme.ts` (design) — the same sanctioned
  bridge already used for the fine-press theme. To change how it looks, touch
  `content-theme.ts` only.
- **Non-chapter exclusion rule** (stated in `content-hook.ts`): skip the
  ornament when ANY of — (1) the raw section is tagged front/back matter via
  `epub:type` (`NON_CHAPTER_EPUB_TYPES`, read before the normalizer strips it),
  (2) under `MIN_CHAPTER_TEXT` (500) chars of text, or (3) the normalizer found
  no heading (`§` ordinal fallback) and it is under
  `MIN_UNSTRUCTURED_CHAPTER_TEXT` (1200) chars. Front matter, title pages,
  copyright/"Also by"/author-bio pages, part dividers, dedications and epigraphs
  each fail at least one; a real chapter clears all three. Verified on Apollo
  (Calibre export, every section is `§`): 40/40 chapters get it, 8/8 front/back
  matter stay clean, idempotent across pipeline re-runs, every chapter still
  walks to its last page.
- **Pagination note:** the ornament adds ~one line + its top margin to the final
  column, so a chapter whose text fills its last page can gain one trailing page
  carrying only the ornament. No content or reading position is lost (D2/D5
  clean); reduce `.chapter-end` `margin` in `content-theme.ts` if that trailing
  page is unwanted.

---

## Phase 2 — bookmarks (durable backend, placeholder UI)

The schema and data layer are the deliverable and are meant to be stable. The
UI is deliberately minimal and disposable: the bookmark design (REVISED_PLAN
§4A, the silk ribbon) is **not approved**, so nothing of it is built.

### Added — schema + data layer (the stable part)
- **`supabase/migrations/0005_bookmarks.sql`** — `bookmarks(id, book_id,
  user_id, cfi, label, percent, created_at)`, an index on `book_id`,
  `enable row level security`, and an owner-only `bookmarks_owner_all` policy —
  modelled on `highlights` (0001). A separate table, not a column on
  `reading_state` (which is one row per book; bookmarks are many). `label` (the
  chapter title at save time) and `percent` are **denormalised on purpose** so a
  bookmark list renders without opening the EPUB or resolving a CFI; both are
  nullable snapshots. Hand-apply in the SQL editor like the others.
- **`src/lib/db/bookmarks.ts`** — `listBookmarks` / `createBookmark` /
  `deleteBookmark`, mirroring `highlights.ts` (explicit Supabase client,
  browser-safe, RLS is the guard). Exported from `src/lib/db/index.ts`.
- **`src/reader/bookmarks.ts`** — `manageBookmarks(bookId)`, a load / add /
  remove / subscribe manager mirroring the highlight manager but with no
  rendition painting (there is no approved visible treatment). Best-effort
  writes, same as `position.ts`.
- Cross-user denial covered in `src/lib/db/rls.integration.test.ts`.

### Changed — engine, additively
- `ReaderController.currentChapterLabel()` — best-effort current chapter title
  from the EPUB's own TOC (fragments / leading `./` normalised away). Used only
  to denormalise `bookmarks.label` at save time; returns `undefined` on any miss.

### Added — placeholder UI (the disposable part)
- The existing **Notes** sheet (`src/components/reader-ui/NotesPanel.tsx`) grows
  a second section: a single "Bookmark this page / Remove bookmark" control and
  a flat list. No new panel, no new route, and **no new tap target over the
  page** (page-turn zones cover the whole touch screen — DEFECTS D1). Tapping a
  row navigates to its CFI via the controller's `goTo`. Tokens only, real
  labels, keyboard-reachable, focus-visible. The file header says plainly that
  only this surface changes when the design is decided.

---


## Phase 2 — on-device instrumentation for the skipped last page (D2)

Temporary diagnostic build. The "last page of a chapter is skipped" defect
reproduces on a real phone but **not** in the Playwright harness, so the reader
can now be asked for its own numbers on the device where it fails.

### Added — an opt-in reader debug readout
- **`src/reader/debug.ts`** — a style-agnostic probe that emits plain data:
  spine section, `displayed.page`/`total`, the epub.js container's
  `scrollLeft`/`offsetWidth`/`scrollWidth`, every `layout.*` value, the CFI, the
  content box `relayout()` would hand `rendition.resize`, iframe/view widths,
  epub.js's own advance test (`scrollLeft + offsetWidth + delta <= scrollWidth`),
  per-section image-load timing, and a rolling 12-entry turn log that keeps the
  state each turn *started* from.
- **`ReaderDebugOverlay`** (`src/components/reader-ui/`) paints it — monospace,
  token-driven, scrollable, with a copy-to-clipboard button. The seam holds:
  the engine emits data, the component owns every pixel.
- **Gate:** `/reader/<bookId>?debug=1`, and nothing else — not `true`, not a bare
  `?debug`. Without it `createReader` is never even asked for the probe, so a
  normal reader carries no instrumentation at all. `debugRequested` lives in its
  own non-`"use client"` module so the Server Component route can call it.

### Changed — signatures, additively
- `ReaderController.next()/prev()` take an optional `source` label (`"tap-next"`,
  `"key-right"`…) used **only** for the debug turn log.
- `createReader(bytes, settings, { debug })` — third argument, default off.

### Observation only
Nothing about pagination or layout changed. The probe reads geometry (a
measurement, never a mutation) and attaches image listeners with
`addEventListener`, never `img.onload =` — epub.js assigns that itself
(`contents.js` `imageLoadListeners()`) to trigger its own re-flow, and clobbering
it would *cause* a defect instead of measuring one. A test pins that.

---

## Phase 0–1 — sepia, theme picker, tactile shelf

Roadmap and rationale in `REVISED_PLAN.md` §7.

### Added — Sepia, and one canonical theme union
- **`sepia`** (warm natural paper) joins Day and Night. Registry order is now
  display order, light → dark. `DEFAULT_THEME` is unchanged (`night`).
- **A theme id is now data, not style.** The union lives in `src/lib/types.ts`
  as `ThemeName`; `src/design/themes.ts` keys `THEMES` off it and re-exports it
  as `ThemeId`; `ReaderTheme` in the store is an alias. Design imports a type
  from lib, never the reverse — the seam still points the right way (SPEC §3.1).
  There were **four** independent `"day" | "night"` unions before this; the
  compiler now rejects a theme the database would refuse.
- `supabase/migrations/0004_sepia_theme.sql` widens the two CHECK constraints
  (`profiles.default_theme`, `reader_settings.theme`). **Must be applied before
  deploying** — see DEPLOY.md.

### Fixed — an unknown theme rendered the book as Day
`content-hook.ts`'s `themeId()` was `s.theme === "night" ? "night" : "day"`, so
any theme it did not know about was painted Day. Sepia would have turned the app
chrome sepia and left the page white — the same "the theme changed on its own"
class of bug reported twice in M7. Now narrows via the registry and falls back to
`DEFAULT_THEME`. Regression tests assert every registered theme paints
distinctly, and were confirmed to fail against the old code.

### Changed — one theme control, chosen not cycled
- **`ThemePicker`** (new) — a WAI-ARIA radio group showing every theme at once,
  registry-driven. Replaces `ThemeToggle`, which was labelled with the *next*
  theme: readable at two themes, a guessing game at three.
- **`ThemeToggle` deleted.** A second way to set the theme is how the two M7
  theme bugs happened; the dual write (store first, then document) is preserved
  and still covered by the ported regression tests.
- The reader's top bar no longer carries a theme button — it duplicated the
  control in the "Aa" sheet and the bar already had four controls competing for
  a phone's width. `ReaderSettingsSheet`'s theme field is now registry-driven,
  so a new theme cannot be unreachable while reading.

### Changed — tactile book cards
Spine crease, hover elevation (motion-safe only), an integrated progress meter
replacing the flat `12%` text, and a frosted disc under the actions menu. The
meter is a `role="progressbar"` whose `aria-valuetext` speaks the same words the
old text did, so nothing was lost to screen readers. The card is still one
focusable link with the actions button outside it.

### Fixed — hairline contrast (backlog)
`--leaf-rule` was ~1.5:1 in every theme, short of WCAG 1.4.11's 3:1 for
non-text boundaries. Now 3.09–3.18:1 across Day, Sepia and Night. Sepia's
`--leaf-faint` also came in at 4.02:1 and was raised to 5.05:1 — the same
failure the founder reported as "unreadable in night mode".

### Infrastructure
- Supabase CLI wired (`db:link`, `db:push`, `db:diff`, `db:types`).
  `0001`–`0003` were applied by hand and are absent from the remote migration
  history, so a bare `db push` would try to re-run them — DEPLOY.md carries the
  one-time `migration repair` baseline runbook.
- `/privacy`'s contact address is now a single `CONTACT_EMAIL` constant. Still
  the placeholder; it is a one-line change when the founder picks an address.

## M4 — highlights, polish, ship

### Added — analytics + crash reporting (SPEC §9 M4)
- **Vercel Analytics + Speed Insights**: `@vercel/analytics`, `@vercel/speed-insights`
  installed; `<Analytics />` + `<SpeedInsights />` mounted in the root
  `layout.tsx` (`/next` entrypoints).
- **`src/lib/analytics.ts`** — the only place `track()` is called. Surface is
  four functions: `trackScreen(name)`, `trackImport({ source })`, `trackUpload()`,
  `trackHighlightCreated()`. Payloads are built here from frozen enums
  (`SCREENS`, `IMPORT_SOURCES`) — caller input is never spread or forwarded
  key-for-key and is re-validated against the allow-list, so no title / author /
  file name / CFI / highlight text / email / id can physically reach the vendor.
  Property value types are closed literal unions (no `string`, no
  `Record<string, unknown>`). Tests in `src/lib/analytics.test.ts`.
- **`src/components/analytics/ScreenView.tsx`** — renders nothing, fires
  `trackScreen` in an effect. Wired on `/library` (`library`) and in
  `ReaderShell` (`reader`). Settings screen is owned by another agent — see
  report (flagged).
- Import success in `ImportSheet` → `trackImport({ source })`; upload success in
  `AddBooksBar` → `trackUpload()`. UI layer only — the reader engine / content
  pipeline are untouched.
- **`src/app/global-error.tsx`** + **`src/app/(chrome)/error.tsx`** — calm,
  token-driven crash fallbacks; `console.error(error)` (what Vercel captures);
  `retry` prop (Next 16.3 stable). `global-error` imports `globals.css` and runs
  the pre-paint theme script itself (it replaces the root layout, so it inherits
  no tokens / `data-theme` / ThemeProvider).

### Added — a11y + reduced-motion pass (SPEC §3.6)
- Reader now has a `main` landmark: `SpreadFrame`'s outer element is `<main
  aria-label="Reader">` (previously a bare `<div>` — the reader route had no
  `main`).
- `ReaderSettingsSheet` `Segmented` is now a valid WAI-ARIA radio group: roving
  `tabIndex` (group is one Tab stop), Arrow / Home / End move + select, checked
  option is the tab target.
- `ReaderShell` announces reading progress on a **polite, throttled** live
  region (`role="status"`, whole-5% steps only) — previously nothing announced
  progress at all.
- `EmptyState` heading promoted `<h2>` → `<h1>` (it is the only page heading
  when the shelf is empty).

### Coupling note (for the next-version redesign)
- `src/components/**` and `src/app/**` now import `@/lib/analytics` (a
  logic-layer module, allowed direction). Swapping the design layer does not
  touch analytics; removing analytics is a delete of `src/lib/analytics.ts` +
  its call sites (grep `@/lib/analytics`).

## Post-M7

### Fixed
- **A theme chosen in the reader was undone by returning to the library.**
  Introduced by the fix below: the chrome layout re-renders on the server when
  you navigate to it, and the settings write is debounced, so that render can
  carry a value *older* than what was just chosen — and re-seeding from it threw
  the choice away. Seeding is now once per user per page load rather than once
  per mount; after the first seed the store is the authority. A different user
  still re-seeds, and `reset()` clears the seed for sign-out.
- **The theme changed by itself when opening a book.** There were two sources of
  truth for one setting: the chrome's toggle wrote `<html data-theme>` and
  localStorage, while the reader read `reader_settings.theme` from the database.
  Switch the library to Day, open a book, and the stored Night value won — the
  app appeared to flip on its own.
  - The persisted setting is now the single source of truth. `ThemeSync` seeds
    the shared store in the chrome layout and reflects it to the document;
    `ThemeToggle` writes through the store rather than only the DOM. localStorage
    stays as the pre-paint cache that prevents a flash.
  - A toggle now follows the reader across devices, which it never did before.
  - The chrome seeds the **whole** settings row, not just the theme: the store
    persists all five values together, so a partial hydrate would have written
    typography defaults over the reader's real choices on the next toggle.
  - `settingsFromRow` is now shared by the reader page and the chrome layout —
    the mapping existed in one place and was about to exist in two.

## M7 — hide and delete books

### Added
- **Hide a book from the shelf, or delete it for good** — a menu on each card.
  Two different verbs on purpose: hiding is reversible and keeps the file, the
  highlights and the reading position; deleting takes all of it. Offering only
  "delete" would make people either keep books they don't want to see or lose
  ones they only wanted out of the way.
  - Deleting asks first and names exactly what goes. Hiding does not ask — a
    confirmation on a reversible action is only friction.
  - **Files are removed before the row.** An orphaned row is visible and
    fixable; an orphaned file is invisible and bills the reader's storage
    forever. If storage cleanup fails, nothing is deleted at all rather than
    half of it.
  - `highlights` and `reading_state` cascade from `books` (0001), so a delete
    takes them with it.
- **Hidden books live behind a quiet link** under the shelf (`3 hidden books`),
  not mixed in — the point of hiding is a shelf you can take in at a glance.
- `books.archived_at` (migration `0003_archive_books.sql`) — a timestamp rather
  than a boolean: it records *when* for free, sorts, and cannot reach the
  ambiguous `false`/`null` state a nullable boolean can.
- Ownership always comes from the session: rows are matched on `id` AND
  `user_id`, so someone else's id matches nothing (and RLS would refuse anyway).

### Fixed
- **Uneven page margins on the desktop spread.** The text crowded the fold and
  drifted from the outer edge: outer margins measured **113px against 65px** at
  the spine. The cause was our own horizontal padding on the viewer — that
  element is epub.js's container and sits *outside* the iframe, so padding it
  reaches only the two outer page edges and can never touch the gutter. It is
  now zero at every width; the insets come from epub.js's body padding (half the
  column gap, symmetric by construction) plus the Margins setting. All four
  margins now measure **69px**. Breathing room around the book is
  `--leaf-reader-frame-pad-x`, which pads the mat rather than the container.
- **`relayout()` measured the padded box**, telling epub.js the page was bigger
  than it is whenever the container had padding. It now measures the content
  box — the same class of bug, one layer up.
- **Facing-page folios on the desktop spread.** The right-hand folio was showing
  the section's page *count*, so a spread read "3 … 10" — a page number beside a
  total. It now reads 3 and 4. Only ever visible on desktop, where the right
  folio is shown.

## M6 — real cover art

### Added
- **Covers are extracted from the EPUB itself** (`src/lib/epub/cover.ts`), not
  taken from the catalogue's search result. One code path for Standard Ebooks,
  Gutenberg *and* uploads — uploads have no catalogue entry, so it is the only
  way they could ever get a cover — with no second network call and nothing that
  can rot or start blocking hotlinks later.
  - Tiered the way the chapter normalizer is: EPUB 3 `properties="cover-image"`,
    then EPUB 2's `<meta name="cover">` id, then an image simply named "cover".
    Returns null rather than throwing — a book without a picture is still a
    complete book, and the shelf keeps its title-initial fallback.
  - Verified against all three bundled Standard Ebooks titles and a real retail
    upload (72 KB JPEG).
- **`books.cover_path`** (migration `0002_book_cover.sql`) holds a Storage key in
  the user's own folder in the `epubs` bucket, so covers inherit the same
  owner-only RLS as the book file — no new bucket, no new policies. Kept
  separate from `cover_url` so one column never means two things.
- **The shelf signs every cover in one batch** (`signCoverUrls`) rather than one
  round trip per book — the same mistake the auth layer made before M5.
- **Backfill in Settings → Library.** Books added before M6 have no cover, and
  re-importing a library to get pictures would be absurd. It re-reads the EPUBs
  already in Storage, in bounded batches so a run can't outlast the serverless
  time limit, and reports what it actually found rather than claiming success.
- `next.config.ts` allow-lists the Supabase Storage host for `next/image`,
  derived from the public env var so preview and production work unedited.

### Not done
- **Ratings.** Goodreads' API was shut down in 2020 (no new keys, existing ones
  retired), so it is not an option. Open Library would be the realistic source.
  Founder's call: skipped — ratings on public-domain classics are thin enough to
  be closer to noise than signal.

## M5 — the shelf tells you where you are

### Changed
- **Progress replaces the reading status on each book.** "Reading" was true of
  nearly every book and said nothing; the card now shows how far in you are
  (`42%`), `Not started` for a book never opened, and `Finished` at 100%.
  Never-opened is deliberately distinct from 0%.
- **The shelf is ordered by what you read last**, then by newest addition among
  books never opened — so a book you are in the middle of is always near the
  top. Sorted in `listBooks` rather than the query: ordering by an embedded
  relation is fragile in PostgREST, and the two-key rule with its null handling
  reads far more clearly in code.
- **The source line is much quieter** — smallest type, faint colour, no letter
  tracking, on its own line. It is provenance, not something to scan for.
- `listBooks` now embeds `reading_state` and returns `LibraryBook`
  (`percent`, `lastReadAt`). No schema change was needed — the columns existed
  since M1, the query just never asked for them.

## Post-M4 — loading states

### Added
- **`loading.tsx` fallbacks** so a tap is acknowledged immediately instead of
  leaving the old page on screen: a shelf-shaped skeleton for the library, a
  generic one for the other chrome routes, and — for the reader — the same
  "Opening the book…" line `ReaderShell` shows once mounted, so opening a book
  is one continuous wait rather than two different screens.
- `Skeleton` is shaped like the content it replaces rather than a spinner, and
  drops its pulse under `prefers-reduced-motion` (the duration tokens collapse
  to `0s`, which would freeze a keyframe rather than stop it).
- Every route here is server-rendered on demand (the nav shows signed-in state),
  so there was no fallback to show at all before this.

## Post-M4 — reader space on small screens

### Fixed
- **Text no longer runs under a notch or camera cutout.** Going edge-to-edge
  means opting into the whole screen (`viewport-fit=cover`), which is exactly
  what lets content sit under a cutout — the same trade native apps make. The
  fix is the same one they use: the system reports what is obstructed, and the
  layout insets by it. `env(safe-area-inset-*)` is exposed as `--leaf-safe-*`
  tokens and applied to the page, both bars and the immersive exit control.
  - The insets go on the page *wrapper*, never on the viewer — the viewer is
    epub.js's container, and padding it desynchronises the column width from the
    visible box (the bug that made the margins unequal). The full-bleed frame is
    now `100%` rather than `100vw` so it sizes to that inset parent.
  - `--leaf-reader-surface` puts the *page* colour behind the safe areas when
    full-bleed, so the cutout strip is part of the book instead of a band of mat
    across the top.
  - Verified by simulating a 47px notch and a 34px home indicator: the page
    insets to 47/34, text clears both, side margins stay 36/36, and the exit
    control moves below the cutout.
- **The full-bleed page was not actually seamless.** Three separate causes,
  all visible at once on a phone:
  - *Bands above and below the text* — `--leaf-reader-frame-max-h: 820px` on an
    844px screen (plus the mat's bottom padding) left strips of `--leaf-paper`
    showing around the `--leaf-page` surface. The cap and that padding are now
    `none` / `0` below the frame breakpoint. Gaps measured 16px/8px → **0/0**.
  - *Unequal left and right margins* — the viewer element **is** epub.js's
    container, and it sizes its columns to that box. Our padding shrank the
    iframe *after* the column width was fixed, so the column (390px) overhung
    its 374px viewport and the right edge clipped. Viewer padding is now zero on
    small screens; the insets come from epub.js's own body padding plus the
    Margins setting, which are symmetric by construction. Measured **36px on
    both sides**.
  - *Chrome sitting on the prose* — with the mat gone, the folio number landed
    on the text and the immersive exit button covered the chapter heading.
    Folios now appear only alongside the frame (progress is in the bottom bar
    regardless), and the exit control **auto-hides after ~2.6s**, the way a
    video player's does; tapping the middle of the page brings it back. The
    reveal layer only exists while the button is hidden, so it never swallows a
    selection, and the page-turn edges keep working throughout.

### Removed
- **Highlight creation from a text selection is disabled.** The popover opened
  on any selection, covered the page, and had no way to dismiss itself — on a
  phone that made the reader feel broken. Both triggers (selection, and tapping
  an existing highlight) are gone along with the component.
  Existing highlights still render, and the notes panel still reads, annotates,
  jumps to and deletes them; the data path is untouched and still tested. This
  is a UI redesign, not a data change — see BACKLOG for the decisions to make
  before re-enabling, and the marked spot in `ReaderShell` to restore it.

### Added
- **Immersive reading works on touch, and hides the browser too.** A control in
  the top bar enters it (phones have no `F` key), and a single quiet back arrow
  is the only thing left on screen to leave — `Esc` and the Android back gesture
  also work. Alongside Leaf's own bars it requests **fullscreen**, so the URL bar
  and toolbars go as well. `fullscreenchange` keeps our state honest when the
  browser exits on its own, and unmounting never leaves the page stuck.
- **The hidden bars now leave the layout**, rather than fading in place: they
  become absolutely positioned so the page grows into their space. epub.js caches
  its container size, so `relayout()` additionally re-measures (`rendition.resize`,
  passing the current CFI to hold the reader's place). At 390×844 the page goes
  **704px → 820px** tall in immersive; leaving immersive now also re-measures, so
  the normal view gained height too (704 → 728).
- **PWA manifest + icons.** iOS Safari has no Fullscreen API for arbitrary
  elements, so a home-screen launch (`display: standalone`) is the only
  chrome-free window there. Icons are generated from the brand copper on the
  night paper; `theme_color` matches, so there is no white flash on launch.

### Changed
- **The reader goes full-bleed on phones and tablets** (below the 1024px
  two-page-spread breakpoint): the frame padding, mat, shadow and rounded
  corners are dropped, the viewer inset shrinks, and the top/bottom bars get
  tighter padding. The open-book frame is a desktop metaphor — on a phone there
  is no second page for the gutter to divide, and the framing was costing ~39%
  of the screen width.
- Measured at 390×844: text **236px → 304px** (61% → **78%** of the width), bars
  **140px → 100px** (17% → 12% of the height). Desktop is untouched: still the
  framed two-page spread with gutter and folios.
- Implemented purely in the swappable layer — a `@media (max-width: 1023px)`
  block in `tokens.css` plus new `--leaf-reader-frame-radius/-shadow` and
  `--leaf-reader-bar-pad-*` tokens that `SpreadFrame` and the bars consume. No
  change to `src/reader`, the normalizer or the content pipeline (SPEC §10).

## M4 — Highlights, polish, ship

### Added
- **Highlights + notes, anchored by CFI** (SPEC §8). `src/reader/highlights.ts`
  manages them (style-agnostic — it only ever handles a colour *name*); the
  engine gained `onSelected` / `addHighlight` / `removeHighlight` /
  `clearSelection` over `rendition.annotations`. Persisted to `highlights` via
  the browser client + RLS, restored and re-painted on reopen.
- **Highlight UI**: a colour popover on selection (and on tapping an existing
  highlight — recolour / remove / add note) plus a per-book notes panel in the
  top bar, with jump-to-passage, inline note editing and delete.
- **Highlight palette** (`src/design/highlight-theme.ts` + `--leaf-hl-*` tokens):
  four washes per theme. The book iframe cannot read host CSS vars, so concrete
  values live in the design layer and reach the logic layer as a `stylesFor`
  callback — a lockstep test keeps them equal to `tokens.css`.
- **Account deletion** (`/api/account/delete`): Storage objects → owned rows →
  auth user, in that order, behind a typed `DELETE` confirmation. Storage must
  fully succeed first, so a failure can never leave a half-deleted account. The
  service-role client (`src/lib/supabase/admin.ts`) is `import "server-only"`
  plus a runtime window guard, and is imported by that one route.
- **Settings screen** with identity + a danger zone, and a **privacy policy**
  (`/privacy`) stating plainly that reading content is never collected.
- **Analytics** (Vercel Analytics + Speed Insights) behind `src/lib/analytics.ts`:
  four events (`screen_view`, `book_import`, `book_upload`, `highlight_created`).
  Payloads are rebuilt inside the module from allow-listed literals and
  re-validated, so a title, CFI, note, email or user id cannot be sent — it is a
  compile error *and* dropped at runtime. Error boundaries at
  `app/global-error.tsx` and `(chrome)/error.tsx`.

### Performance
- **Functions now run in Mumbai (`bom1`), next to Supabase.** They were
  defaulting to Washington DC, so every request went India → Vercel edge Mumbai
  → function in `iad1` → Supabase back in Asia → back. `vercel.json` pins the
  region. Warm TTFB roughly halved (`/styleguide` 344ms → ~145ms).
- **Auth is fetched once per request, not three times.** A page load called
  `supabase.auth.getUser()` in the proxy, again in the page, and again in the
  NavBar — three separate network round trips to the auth server, because
  `getUser()` deliberately revalidates the JWT rather than trusting the cookie.
  `getUser` is now wrapped in React `cache()`, so everything inside one render
  shares a single call. Not a cross-request cache — each request still
  revalidates.
- **No auth round trip at all when there is no session cookie.** A signed-out
  visitor has nothing to validate or refresh, so the proxy short-circuits to
  route protection alone.

### Fixed
- **Sign out did nothing.** The POST form was nested inside a Radix `MenuItem`,
  so selecting it closed and unmounted the menu — tearing the form out of the
  DOM before the browser's native submit could run. The form now lives outside
  the menu and is submitted from `onSelect`; it is still a POST, never a link.
  Regression-tested (asserts a real form submission, and that the form is not
  inside `[role=menu]`).

### Changed
- **One search, both catalogues.** The Standard Ebooks / Project Gutenberg
  toggle is gone — choosing a library was a decision the reader had no basis to
  make. `/api/import/search` already queried both when no source was given; it
  now also de-duplicates a work that appears in both (Standard Ebooks wins, its
  markup is uniform — SPEC §6), interleaves so neither catalogue buries the
  other, and reports which sources were unreachable. Each result shows its
  source as subtext, and a catalogue being down is stated instead of silently
  halving the results.
- **App bar rebuilt for narrow screens.** Five inline items in a three-column
  flex collided with the wordmark and wrapped "Sign out" onto two lines on a
  phone. The bar is now three stable slots — wordmark, theme toggle, one account
  menu — with Library/Settings also inline from `sm:` up. Privacy, sign-out and
  the signed-in identity moved into the menu. Verified as a single 57px row with
  no overflow at 360 / 390 / 768 / 1280px. (`UserMenu` superseded by
  `AccountMenu`.)

### Accessibility (SPEC §3.6)
- Reader gained a `main` landmark; the settings `radiogroup` is now APG-conformant
  (one tab stop, arrow/Home/End); reading progress is announced politely and only
  on whole-5% steps; tap zones are no longer focusable-yet-`aria-hidden`; the
  empty-library heading is an `h1`.
- Contrast audited in both themes — every text pair passes AA (tightest:
  `faint` 4.69:1). No token changed.
- Flagged, not changed: `--leaf-rule` hairlines sit ~1.5:1, arguably short of
  SC 1.4.11 for the search input's resting border. Raising it thickens every
  hairline app-wide — a visual-design call, see BACKLOG.

### Verification
- Highlight loop driven in a real browser: select → popover → pick colour →
  epub.js paints the wash (`fill: rgba(126,168,112,0.30)`, the sage token) →
  persisted → listed in the notes panel.
- 157 tests green.

## M3 — the reader (core)

### Added
- **Reader engine** (`src/reader/engine.ts`): `createReader(bytes, settings)` →
  a `ReaderController`. epub.js `renderTo` with the approved-prototype config
  (`manager:"default"`, `flow:"paginated"`); two-page spread ≥1024px / single
  below, `relayout()` debounced on resize; `book.locations.generate(1200)` runs
  unawaited so `attach()` resolves fast and `percent` fills in when ready. epub.js
  owns all column/clip math (SPEC §3.4). Takes an **ArrayBuffer**, not a URL
  (a signed URL made epub.js hang — M2 finding).
- **Reading-position sync** (`src/reader/position.ts`): `trackPosition` writes
  the CFI + percent to `reading_state` (browser client + RLS, debounced 1.5 s);
  `restore()` reads the last CFI and `goTo`s it on open. Cross-device: read on
  open picks up the other device's last write. **CFI round-trip is tested.**
- **Chapter normalizer, DOM port** (`src/normalizer/normalize.ts`):
  `normalizeChapterDom(doc, meta)` ports `reference/normalizer.py` to an in-place
  DOM rewrite — wrapper → `<article class="chapter">` with a clean
  `<header class="chapter-head">` (tiered: ordinal `<p class="chapter-ordinal">`
  + Fraunces `<h1 class="chapter-title">`, ordinal-only, or `§` fallback), first
  body `<p>` flagged `para first` (drop cap + small-caps lede), publisher
  attributes/`epub:type` reset (inline `em/i/strong/b`, and `<a href>`, kept).
  Idempotent (won't double-wrap). Pure — DOM + strings only.
- **Content pipeline** (`src/reader/content-hook.ts`):
  `registerContentPipeline(rendition, getSettings)` registers one
  `rendition.hooks.content` handler that runs the normalizer over each chapter
  and injects a single `<style id="leaf-content-pipeline">` (fine-press rules
  from `buildContentTheme` + live settings: font stack / size / line spacing /
  measure) plus an `!important` palette override, re-appended last so it always
  wins the cascade. Returns a callable handle with `refresh()` + `destroy()`.
  Deliberately does NOT use `rendition.themes.select` for Day/Night — epub.js
  keeps every registered theme's rules present and won't cleanly toggle, which
  left the theme stuck after one flip.
- **`reader_settings` db helper** (`src/lib/db/reader-settings.ts`, in the
  `@/lib/db` barrel): `getReaderSettings(uid)` / `upsertReaderSettings(uid,
  patch)`. `src/lib/db/reading-state.ts` reworked to take an **explicit**
  Supabase client (no server-client fallback) — it is imported into the
  reader's client bundle via `position.ts`, so it must never reach
  `@/lib/supabase/server` (`next/headers`).
- **Reader route group** (`src/app/(reader)/`): the reader moved to
  `(reader)/reader/[bookId]` with a minimal layout that renders **no app
  NavBar** (SPEC §8 immersive). Every other page moved to a sibling
  `(chrome)/` group whose layout owns the NavBar. The root `layout.tsx` now
  holds only `<html>`/`<body>`/`ThemeProvider` — a single root layout, so
  chrome↔reader navigation is a normal client transition (no full reload). URLs
  unchanged (`/reader/[bookId]`, `/library`, …); the proxy's `PROTECTED_PREFIXES`
  still match.
- **Reader chrome** (`src/components/reader-ui/`, presentational, token-driven,
  no literal style values): `ReaderShell` (client — owns the epub.js container +
  `createReader`/`trackPosition` lifecycle, fetches EPUB bytes from the signed
  URL, resize→`relayout`, keyboard ←/→/`F`/`Esc`),
  `ReaderTopBar` (Library · book meta · centred LEAF · theme · Aa),
  `ReaderBottomBar` (prev · `--leaf-accent` progress fill · next · `NN%`),
  `SpreadFrame` (open-book frame + `--leaf-shadow-book` + desktop-only gutter
  shadow + folio slots + tap zones), `ReaderSettingsSheet` (text size, body
  font, line spacing, margins, theme — each change → store setter). Recreates
  the approved v0.1 look from Leaf tokens.
- **Reader settings store** (`src/store/reader-settings.ts`): `hydrate(row, uid)`
  from the server-loaded `reader_settings` row; every setter also persists
  (debounced) to `reader_settings` via the browser Supabase client + RLS, so
  choices survive reload and follow the user across devices (SPEC §8).
- **Reader layout tokens** (`src/design/tokens.css`): `--leaf-reader-frame-*`,
  `--leaf-reader-viewer-pad-*`, `--leaf-reader-gutter-w`/`-bg`,
  `--leaf-reader-progress-*`.

### Changed
- Text size is **S / M / L**, not a stepper. The original continuous 0.04rem
  step moved the text by under a pixel per tap and read as a dead button.
- **Margins actually move the text.** They were a `max-width` only, which is a
  no-op on a phone (the column is far narrower than any sane measure) — the
  setting now drives side padding on the text block, with the measure kept as a
  cap for wide screens.
- **Publisher weight / style / insets are normalised too.** A retail upload set
  `font-weight:bold` on a container so every paragraph rendered bold; Gutenberg
  wraps content in divs with `margin:10%` and hanging indents that stacked on
  top of the margins setting. Containers are reset and paragraph indentation is
  ours. Real markup emphasis (`<strong>`, `<em>`) is explicitly preserved.
  All three sources now render at identical column widths at phone and desktop.
- **The reading size no longer depends on the file.** The injected stylesheet
  now pins `.chapter` (our wrapper) to the chosen size in absolute units,
  resets every container a publisher can inflate (`div/section/article/main`)
  to `1em`, and forces the text elements to `1em` — all `!important`.
  Previously a retail EPUB with `font-size:2em` on a container cascaded into
  the wrapper and rendered every paragraph at 2x (unreadable on a phone), and
  Gutenberg's per-element sizes out-specified our inherited `body` rule.
  Headings are left relative so they still scale with S/M/L but keep hierarchy.
  Verified in a real browser (Standard Ebooks, Project Gutenberg and a retail
  upload now render at identical sizes: S 14.4px / M 16.96px / L 20.16px).
- Reader theme is **single-source**: the toggle writes only the reader-settings
  store; the chrome (`<html data-theme>`) and the book both follow from it.

### Removed
- Page turns are **instant** — the opacity-dip crossfade read as text flicker
  against the static paper and was removed. Motion stays a next-version item (SPEC §8).
- `src/reader/bootstrap.ts` + `src/components/reader-ui/ReaderBootstrap.tsx`
  (the M2 smoke reader) — superseded by `engine.ts` + the chrome above.

### Presentation ↔ logic coupling (for the next redesign)
- **Reader theme flows one way**: `useReaderSettings.theme` (persisted to
  `reader_settings`) → an effect in `ReaderShell` mirrors it to
  `ThemeProvider.setTheme` (`<html data-theme>` + localStorage) → the
  `[settings]` effect pushes it to the book via `controller.applySettings`.
  A redesign that reworks theming touches `ReaderShell` + `ReaderTopBar` +
  `ReaderSettingsSheet`, not the engine.
- `src/reader/content-hook.ts` is the **one sanctioned import** from `src/reader`
  into `src/design`: it pulls `buildContentTheme` from
  `src/design/content-theme.ts` (a plain selector→declaration map — data, not
  presentation code). `eslint.config.mjs` carries a matching per-file exception
  to the `src/reader → src/design` seam ban (components stay banned).
- `src/design/content-theme.ts`: added a `.chapter-head` rule (left align, bottom
  margin) — the only change needed once the stylesheet was wired to a live
  iframe.

## M2 — Import + upload

### Added
- **EPUB toolkit** (`src/lib/epub/`): `assertValidEpub` (structure), `checkDrm`
  (rejects `rights.xml` / `license.lcpl` / ADEPT / content-encrypting
  `encryption.xml`; allows IDPF/Adobe font obfuscation), `extractEpubMetadata`
  (container.xml → OPF → `dc:title`/`dc:creator`). `fast-xml-parser` added.
- **Book import** (`src/lib/import/`, `/api/import` + `/api/import/search`):
  - Standard Ebooks via the open OPDS search feed
    (`/feeds/opds/all?query=`); download URL constructed with the required
    `?source=feed` marker.
  - Project Gutenberg via Gutendex (`gutendex.com/books/?search=`); author names
    flipped "Last, First" → "First Last".
  - All third-party bytes are fetched server-side (SPEC §6); `User-Agent: Leaf/0.1`.
- **Shared ingest** (`src/lib/books/ingest.ts`): `ingestEpub` (from bytes) and
  `registerUploadedEpub` (already-in-Storage). validate → DRM gate → metadata →
  Storage `${uid}/${bookId}.epub` → `books` row, with rollback.
- **DRM-checked upload**: direct-to-Storage via a signed URL (`/api/upload/sign`),
  then `/api/books/register` downloads + validates + inserts, deleting the
  orphaned object on any failure. `uploadEpub()` client helper.
- **Discovery UI**: `AddBooksBar` + `ImportSheet` (Standard Ebooks / Gutenberg
  search, per-row add), real `EmptyState` CTAs, `/api/library/seed`.
- **Bundled classics** (`public/bundled/`): Frankenstein, The Wonderful Wizard of
  Oz, The Time Machine (Standard Ebooks EPUBs, ~1.9 MB) — added by "Add starter
  books", deduped by `source_ref`.
- **Thin reader bootstrap** (`/reader/[bookId]`): `src/reader/bootstrap.ts` (logic,
  dynamic `import("epubjs")`, SSR-safe) + `ReaderBootstrap` (minimal paginated
  view, section count, prev/next). Proves the pipeline; the designed reader is M3.

### Verification
- Import (Standard Ebooks + Gutenberg), upload, "Add starter books", reload-shelf
  all work against the live project. Rows in `books`, files in the `epubs` bucket.
- Catalog fetches were flaky from the dev server (`fetch failed` / IPv6) — fixed
  with an IPv4-preferring retry wrapper (`src/lib/import/http.ts`).
- Reader bootstrap opens SE/Gutenberg/uploaded EPUBs and reports section count,
  but its minimal `renderTo` only paginates the first section for Standard Ebooks
  books. **Deferred to M3**, which replaces the bootstrap with the approved v0.1
  prototype's proven epub.js config. Files verified intact (multi-section spine).

### Notes for the next-version redesign
- `source_ref`: Standard Ebooks slug (`mary-shelley/frankenstein`), Gutenberg id
  as string (`"84"`), `null` for uploads.
- Gutenberg serves the `.epub3.images` edition (large — Pride & Prejudice ~24 MB).
- Standard Ebooks now gates its crawlable OPDS feeds (401 / Patrons Circle); the
  `?query=` search feed stays open. If it closes, add HTTP Basic (email as user,
  blank password).
- `ReaderBootstrap` / `src/reader/bootstrap.ts` are throwaway scaffolding for M3.

## M1 — Auth + library shell + data

### Added
- **Schema** (`supabase/migrations/0001_init.sql`, run-once): `profiles`, `books`,
  `reading_state`, `highlights`, `reader_settings`. Owner-only RLS on all five
  (`auth.uid() = user_id`, or `= id` for `profiles`). `handle_new_user()` trigger
  seeds `profiles` + `reader_settings` on signup. Private `epubs` Storage bucket
  with per-user-folder policies (ready for M2 upload).
- **Google auth** (Supabase SSR): `src/lib/supabase/{client,server,middleware}.ts`
  on the current `getAll`/`setAll` cookie API; `/login` + `GoogleSignInButton`;
  `/auth/callback` (PKCE code exchange) and `/auth/signout` (POST); `getUser()` /
  `requireUser()` server helpers.
- **Route protection** in `src/proxy.ts` (single enforcement point) —
  `/library`, `/settings`, `/reader/*` redirect to `/login?next=…` when signed out.
  `requireUser()` is kept as defence-in-depth in server routes.
- **Library shell**: server `library/page.tsx` fetches the user's books via RLS;
  presentational `Shelf` / `BookCard` / `EmptyState`. NavBar shows signed-in
  identity + sign-out.
- `src/lib/db/` typed query helpers (`listBooks`, `getBook`, `getProfile`,
  `ensureProfile`). `src/lib/safe-redirect.ts` guards the `next=` round-trip
  against open redirects.
- RLS cross-user isolation test (`src/lib/db/rls.integration.test.ts`) — runs
  against a live project when `.env.local` has real keys, skipped otherwise.

### Verification
- Desktop: Google sign-in + sign-out work end to end.
- RLS cross-user isolation test: 6/6 green against the live project.
- **Phone sign-in deferred to the first Vercel deploy** — `http://<LAN-IP>:3000`
  is not a secure context and Supabase falls back to the Site URL (localhost)
  for bare-IP `http` redirects. Not reproducible on HTTPS. Nothing mobile-specific
  is untested (auth flow is device-agnostic; shell is responsive).

### Notes for the next-version redesign
- Next.js 16 renamed the `middleware` file convention to **`proxy`** — the root
  file is `src/proxy.ts` exporting `proxy()`. `src/lib/supabase/middleware.ts` is
  a plain helper module, not the framework file.
- `next.config.ts` carries `allowedDevOrigins` for LAN mobile testing (dev-only).
- `src/lib/types.ts` stays hand-maintained in lockstep with `0001_init.sql` until
  the Supabase CLI is set up (M1 tail / M2), then `supabase gen types` takes over.

## M0 — Scaffold & the swappable UI seam

### Added
- Next.js 16 (App Router) + TypeScript + Tailwind v4 + ESLint scaffold.
- `src/design/` token layer: `tokens.css` (both themes, type scale, spacing, radii, motion),
  `themes.ts` registry, `content-theme.ts` (epub.js content stylesheet builder — inert until M3).
- Token-driven primitives (`Button`, `Sheet`, `Dialog`, `Menu`) on Radix headless.
- `ThemeProvider` / `ThemeToggle` — sets `data-theme` on `<html>`, persists to `localStorage`
  (moves to `profiles.default_theme` in M1), honours `prefers-reduced-motion`. Default theme: **night**.
- `/styleguide` route rendering all tokens + primitives in both themes.
- Empty placeholder routes: `/login`, `/library`, `/reader/[bookId]`, `/settings` behind a nav shell.
- Supabase client stubs (`src/lib/supabase/{client,server}.ts`) + `.env.example`. Not wired to a
  live project — full setup lands in M1.
- `src/normalizer/` — chapter fixtures + `extractChapterHeading()` (faithful port of the
  Python prototype's tiered heading logic, fixture-tested) + `normalizeChapterDom()` stub (M3).
- `src/store/` — Zustand stores for reader settings and session (stubs, no persistence yet).
- Vitest + Testing Library (14 tests: theme toggle, Button, normalizer headings).

### Changed
- Night accent recoloured from the prototype's gold `#e0a03c` to a metallic
  copper `#c58a52` (founder call — calmer, more mature, ~6.5:1 on paper).
  `--leaf-focus` / `--leaf-selection` follow. Day theme unchanged.
- Contrast pass: `--leaf-faint` darkened (day `#8a7d5e`→`#6a5f45`) / lightened
  (night `#7c6f52`→`#8f815f`) to clear WCAG AA — the prototype values failed on
  small text. Mono chrome labels bumped to weight 500 for legibility at small sizes.
- `content-theme.ts` had drifted from `tokens.css` (its night `faint` still held
  the pre-contrast value). Re-synced, and added `content-theme.test.ts` asserting
  the two palettes stay in lockstep.
- Font roles split (founder call — the prototype's mono UI text read poorly):
  - `--leaf-font-ui` = Source Sans 3 (humanist sans) — app chrome default: nav,
    captions, helper text, buttons, menu items. `<body>` now defaults to this.
  - `--leaf-font-body` = EB Garamond — reading serif, for book content and
    long-form host text only (styleguide type-scale sample still demos it).
  - `--leaf-font-mono` = JetBrains Mono (was IBM Plex Mono) — eyebrows, folios,
    technical labels. Uppercase-eyebrow treatment kept.
  - `--leaf-font-display` = Fraunces — unchanged.
- `<html suppressHydrationWarning>` — the pre-paint theme script sets `data-theme`
  before React hydrates, which is expected, not a bug.
- Swappable-seam enforcement via core ESLint `no-restricted-imports` (chosen over
  `eslint-plugin-boundaries`, whose v5→v7 config churn wasn't worth the dependency):
  `src/{reader,lib,store,normalizer}` cannot import from `src/design` or `src/components`.

### Notes for the next-version redesign
- Tailwind v4 is CSS-first: there is **no `tailwind.config.ts`**. Design tokens live in
  `src/design/tokens.css` and are exposed to utilities via `@theme` in `src/app/globals.css`.
  A redesign edits `tokens.css` + `themes.ts` + `src/components/*` and touches no logic.
- CSS-var token prefix is `--leaf-*`.
- Spacing tokens (`--leaf-space-*`) are intentionally NOT mapped into Tailwind's `@theme`
  (their non-linear ramp would shadow v4's built-in numeric spacing scale). Components use
  Tailwind's default spacing scale; the design layer uses `--leaf-space-*` directly.
- `RootLayout` uses an explicit prop type, not Next's generated `LayoutProps`, so
  `tsc --noEmit` passes without a prior `next build`.

### Known issues
- `epubjs@0.3.93` pulls a vulnerable `@xmldom/xmldom` (high, XML injection/DoS in Node XML
  serialization). Only exercised server-side from M3. Track upstream; do not force-downgrade
  epub.js (0.4.x is breaking and unreleased-stable). Revisit before M2/M3.

### Renamed
- Project renamed **Marginalia → Leaf** at handoff. `SPEC.md` and all identifiers use "Leaf".
