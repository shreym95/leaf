# Backlog

Things deliberately deferred. Not bugs — decisions to revisit, with the evidence
that prompted them. See `SPEC.md` §9 for the milestone plan.

`REVISED_PLAN.md` §7 reconciles this list with the next design phase: the **shelf
redesign** and **highlight creation** are scheduled there (Phases 1 and 2);
**ratings**, **custom domain**, **hairline contrast**, **privacy email** and the
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

### Library shelf redesign

Part of the UI overhaul, not a standalone fix (founder's call). The shelf's
*data* problems are handled separately in M5/M6 — progress, sort order and real
cover art — so the redesign inherits a shelf with something worth showing.

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

### Highlight creation — currently DISABLED, needs a touch-first design

**Observed (founder, M4):** intrusive, didn't work properly, and would not go
away on its own. Removed rather than left in — see CHANGELOG.

The popover opened on *any* text selection, sat over the page, and had no
dismissal path except picking a colour or pressing `Esc` (which a phone does not
have). On touch, where selection is easy to trigger by accident, that made the
reader feel broken.

**Still working, untouched:** existing highlights render in the book, and the
notes panel reads, annotates, jumps to and deletes them. Only *creating* one from
a selection is gone. The whole data path (`src/reader/highlights.ts`,
`highlights` table, RLS, CFI round-trip) is intact and tested — this is a UI
problem, not a data one.

**Interaction decided (founder, 2026-08-31)** — see `REVISED_PLAN.md` §4C:
highlighting is an **explicit mode**, off by default, entered from a reader top-bar
control. Off, nothing listens to selection at all, so copying a word or looking up
its meaning behaves natively — that was the actual complaint, not the popover's
looks. On, a selection highlights in the active colour and a bottom ribbon offers
the four colours and a note. Long-press was rejected: on touch it *is* the native
selection gesture. `-webkit-touch-callout` is suppressed only while the mode is on.

Re-enable point is marked in `ReaderShell` where `controller.onSelected(...)`
was wired.

### `--leaf-rule` hairline contrast

The hairline rule sits at roughly 1.5:1 against its background — deliberate (it is
a hairline, not a border), but arguably short of WCAG 1.4.11 for a non-text
boundary. Worth fixing during the next pass over `tokens.css` rather than opening
that file twice.

## Infrastructure — after M4

### Migrations are applied by hand

`0001`–`0003` were run in the Supabase SQL editor; the CLI is not wired. They must
run **in order** if the project is ever rebuilt. This stops being housekeeping the
moment another migration is needed — the sepia theme in `REVISED_PLAN.md` needs
`0004` (the theme columns carry `check (… in ('day','night'))`), and the ribbon
bookmark needs storage of its own.

### Custom domain

Deferred from M4 (SPEC §9 lists it under "deploy to Vercel with a custom
domain"). Shipping on `leaf-black.vercel.app` for now.

**Why it matters beyond vanity:** Google's consent screen shows the host of the
OAuth redirect URI, so sign-in currently reads *"Sign in to
`<project-ref>.supabase.co`"*. The consent screen's app name and logo are
already set; the domain line is the part only a custom domain fixes.

**What it takes:**
1. Register the domain.
2. Vercel → project → Settings → Domains → add it; point DNS as instructed.
3. Supabase custom domain add-on (paid, ~$10/mo) so auth is served from
   e.g. `auth.<domain>` instead of the project-ref host.
4. Update Supabase Site URL + Redirect URLs, and the Google OAuth client's
   authorized origins / redirect URI, to the new domain.
5. Re-test sign-in on desktop and phone (the redirect allowlist is the usual
   breakage — see the M1 notes in CHANGELOG).

Steps 1–2 alone give a branded app URL; step 3 is what changes the Google
screen.
