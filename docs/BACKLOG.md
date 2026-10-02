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

## Dropped

- Highlight creation and the highlights list were dropped on 2026-10-02 and will be redesigned from scratch later. Existing highlights in books are still rendered, and `ReaderShell` still runs `manageHighlights` — only the UI to create new ones from a selection was disabled.
- Custom domain was dropped on 2026-10-02; Leaf stays on `leaf-black.vercel.app`. Google's sign-in consent screen continues to show the Supabase project host rather than a Leaf domain.
