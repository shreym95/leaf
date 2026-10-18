# Backlog

Things deliberately deferred. Not bugs — decisions to revisit, with the evidence
that prompted them. See `SPEC.md` §9 for the milestone plan.

`REVISED_PLAN.md` §7 reconciles this list with the next design phase: the **shelf
redesign** was Phase 1 and is done; **highlight creation**, Phase 2, has since been
dropped (see the end of this file);
**ratings**, **privacy email** and the
**hand-applied migrations** are not, and stay open here.

## Design — after M4

### ~~Reclaim reader space, especially on phone~~ — done

Shipped after M4. The reader now goes full-bleed below the two-page-spread
breakpoint (1024px): no frame padding, no mat, no shadow or rounded corners, a
tighter viewer inset and slimmer bars. The open-book frame was a desktop
metaphor — on a phone there is no second page for the gutter to divide.

Measured at 390×844: text **236px → 304px** (61% → **78%** of the width), bars
**140px → 100px** (17% → 12% of the height). Desktop is unchanged — it keeps the
framed spread, gutter and folios.

Followed up with **immersive reading on touch** (see CHANGELOG): a top-bar
control enters it, a single back arrow leaves it, and it takes the browser's
own chrome with it via the Fullscreen API — plus a PWA manifest so a home-screen
launch is chrome-free on iOS, where fullscreen is unavailable. Immersive gives
the page 820px of 844 on a phone.

Not pursued: immersive-by-*default* (the reader should choose it, and a mode
with no visible way out is a trap on first use) and re-tuning the Margins scale
(the reader's own control; "Narrow" already gives a zero inset).

### ~~Loading states~~ — done

Shipped after M4. `loading.tsx` for the library (a shelf-shaped skeleton), the
rest of the chrome routes (generic), and the reader (the same "Opening the
book…" line the reader itself shows, so opening a book reads as one continuous
wait rather than two different screens). Skeletons are shaped like the content
they stand in for, not spinners, and the pulse is dropped under
`prefers-reduced-motion`.

Note: with prefetching, navigation between chrome routes is usually instant and
the fallback never appears — that is the intended outcome. It earns its keep on
a cold start or a poor connection, which is exactly when the app used to look
dead. `useLinkStatus` was considered and skipped: Next's own docs prefer
route-level `loading.js`, which is what we now have everywhere.

### ~~Library shelf redesign~~ — done (design iteration 1)

Delivered by design iteration 1: the "Continue reading" hero (`HeroCard.tsx`), the
no-box shelf card (`BookCard.tsx`) and the shelf grid (`Shelf.tsx`).

### ~~Metadata enrichment — covers~~ — done (M6)

Covers are extracted from the EPUB itself at import and upload, stored beside
the book in Storage, and backfilled for older books from Settings → Library.

**Ratings remain undone and Goodreads remains impossible** — its API was retired
in 2020. Open Library is the option if this is ever revisited: free, no key,
reasonable coverage of public-domain classics. Deferred deliberately, not
forgotten.

### Privacy policy contact address

`/privacy` still says `[your contact email]`. Low priority (founder's call) but
it is the last thing that would embarrass a real launch.

### ~~`--leaf-rule` hairline contrast~~ — done (2026-10-02)

`--leaf-rule` now clears 3:1 on both grounds in both themes (day `#867650`: 3.46 on
page, 3.15 on paper; night 3.09 / 3.33), asserted in `tokens.test.ts`.
`--leaf-rule-soft` stays decorative only (cover outlines) and is deliberately lighter.

## Infrastructure — after M4

### Migrations are applied by hand

`0001`–`0003` were run in the Supabase SQL editor; the CLI is not wired. They must
run **in order** if the project is ever rebuilt. This stops being housekeeping the
moment another migration is needed — the sepia theme in `REVISED_PLAN.md` needs
`0004` (the theme columns carry `check (… in ('day','night'))`), and bookmarks
need storage of their own: `0005_bookmarks.sql` (the `bookmarks` table) is
written and also hand-applied. The visible bookmark treatment (`REVISED_PLAN`
§4A) is still an open design question — only the schema and data layer are settled.

## Features — deferred 2026-10-11

### AI reading aids (features 1, 2, 3, 5)

Recap up to the current page, a spoiler-free premise, context-aware word meanings, and a
character who's-who. Researched and architected in `FEATURES_PLAN.md` §3 (one cached
chapter pass per edition serves both the recap and the who's-who; text is bounded to the
reader's position, so the model cannot spoil). Deferred by the founder so that reading
groups ship first. Reviving it needs three decisions first (`FEATURES_PLAN.md` §8):
**D1** AI budget and quota, **D2** AI on uploaded books, **D3** word-lookup trigger.
`CLAUDE.md`'s "NO AI features" line stays until then.

### Full design review — after Groups v1

Founder, 2026-10-11. The group screens ship in the existing design language with
minimal copy and no designer handoff (`GROUPS_V1_BUILD.md` §2 F3). Once that version is
built, review the whole app: groups, library, reader chrome, and copy tone. Then
decide whether a design iteration (as `design-iterations/2026-09-09-shelf-and-dock`) is
needed.

Include: the contents popover tabs (`TocPopover.tsx`, now with a Group tab) use
`role="tab"` without a `tabpanel` / `aria-controls` association (found in v1b QA).

### Test suite audit — with the Notes cleanup migration

Founder, 2026-10-17. After this version ships, Levi lists tests that cover removed or
compatibility-only code (legacy bookmark/highlight db modules kept for outbox replay,
`TocPopover`'s deprecated Bookmarks/Group tab props) or that pin copy rather than
behaviour. The founder approves the list; the tests are deleted together with the code in
the Phase 4 cleanup (`NOTES_PLAN.md`). Also give the live-database integration tests a
longer per-test timeout in config: "leaving deletes that member's progress…" takes over
5 s against the live project and times out though its assertions pass (measured with
`--testTimeout=30000`).

## Reader and sync — accepted debt, 2026-10-18

Accepted with the 2026-10-18 changes (see CHANGELOG, 2026-10-18). Each is a decision to revisit.

- **Touch to Search workaround is not device-verified.** `src/reader/engine.ts:811-819`
  marks reported taps so Chrome Android's Touch to Search does not select on tap. Basis: Chrome's
  2015 tap-to-search doc and an older Blink heuristic. Decision: remove it if a device test
  shows Touch to Search still selects on tap.
- **Scroll lock depends on an epub.js internal.** `bracketManagerDisplay`
  (`src/reader/engine.ts:339-346`) wraps `rendition.manager.display` in epub.js 0.3.93. Re-check
  on any epub.js upgrade.
- **No drag-to-edge page turning.** Selections may extend past the page edge
  (`src/reader/scroll-lock.ts:11-12`).
- **Cross-device clock skew.** Both sides of the newest-write comparison use client clocks
  (`src/lib/offline/outbox.ts:254`, `src/reader/position.ts:165-176`).
- **Read-then-upsert is not atomic.** `src/lib/offline/outbox.ts:900-911`. A server-side
  conditional upsert is the later fix.
- **Position timestamp lag.** A cache or queue timestamp can lag the read by up to the 1500 ms
  debounce (`src/reader/position.ts:86`).
- **First jump after opening can go unsaved.** If restore's landing is reported before display
  settles, the reader's first jump after opening is not saved; the next page turn saves
  (`src/reader/position.ts:305-311`).
- **Dismissed offer is not remembered.** The offer can reappear on the next open until the reader
  turns a page.
- **Unused helpers.** `pickFurthestPosition` (`src/reader/position.ts:268`) and
  `isMeaningfullyAhead` (`src/reader/position.ts:143`) have no production callers.
- **Test: closed write gate on pagehide and stop.** Add a test asserting that a closed write gate
  writes nothing on `pagehide` and on `stop()` (`src/reader/position.ts:297-339`, `:424-440`).
- **Flaky focus assertion under parallel runs.** `src/components/reader-ui/ReaderShell.bar.test.tsx:254`
  (`toHaveFocus` in the Note editor test) fails intermittently under parallel runs.
- **Duplicated iframe pointer and selection tracking.** `src/reader/engine.ts:781`,
  `src/reader/selection.ts:75-76` and `src/reader/scroll-lock.ts:207-210` each track it. Merge them.

## Dropped

- Highlight creation and the highlights list were dropped on 2026-10-02 and will be redesigned from scratch later. Existing highlights in books are still rendered, and `ReaderShell` still runs `manageHighlights` — only the UI to create new ones from a selection was disabled.
- Highlight creation is being rebuilt in `NOTES_PLAN.md` (2026-10-17). The mode in `REVISED_PLAN.md` §4C is reversed there: highlights use a selection bar on any selection.
- Custom domain was dropped on 2026-10-02; Leaf stays on `leaf-black.vercel.app`. Google's sign-in consent screen continues to show the Supabase project host rather than a Leaf domain.

- **Touch bars, keyboard on a touch device (accepted gap, 2026-10-18).** On a coarse pointer, a keyboard page turn with focus on the page hides the bars; inert bars cannot be reached by Tab, so a keyboard-only reader recovers them only with a middle tap. Fix: show the bars on Tab when they are hidden. Related: a touch page tap or middle-tap deck close drops focus to body (`ReaderShell.tsx:964-965`, `:1005-1006`).
- **Layer rule breach (pre-existing).** `src/reader/content-hook.ts:38` imports `@/design/themes`; `src/reader` must not import from design. Pass the theme values in from the UI layer instead.
