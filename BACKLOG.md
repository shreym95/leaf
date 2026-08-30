# Backlog

Things deliberately deferred. Not bugs — decisions to revisit, with the evidence
that prompted them. See `SPEC.md` §9 for the milestone plan.

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

### Loading states

**Observed (founder, M4):** navigation feels unresponsive — nothing happens on
screen while a page is being fetched, so a slow load reads as a broken tap.

Every route is server-rendered on demand and there is no `loading.tsx` anywhere,
so Next has no fallback to show during navigation. Cheap to fix:

- `loading.tsx` for `(chrome)` (library / settings / privacy) and for the reader
  route — a calm skeleton in the shape of the real page, not a spinner.
- The reader already has an "Opening the book…" state once `ReaderShell` mounts;
  the gap is *before* that, while the server component is fetching.
- Consider `useLinkStatus` / a pending style on nav links so the tapped item
  acknowledges the tap immediately.

Small, self-contained, `*-ui` only. Worth doing early in the next pass — it
changes perceived speed more than most real speed-ups.

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

**Before re-enabling, decide the interaction:**
- what opens it (long-press? a dedicated highlight mode? the OS share sheet?)
  rather than every selection;
- how it dismisses — outside tap, scroll, page turn, and a visible close, not
  just `Esc`;
- where it sits — anchored to the selection rectangle, never covering it;
- whether to suppress the native iOS/Android selection callout that competes
  with it (`-webkit-touch-callout`).

Re-enable point is marked in `ReaderShell` where `controller.onSelected(...)`
was wired.

## Infrastructure — after M4

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
