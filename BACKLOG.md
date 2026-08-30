# Backlog

Things deliberately deferred. Not bugs — decisions to revisit, with the evidence
that prompted them. See `SPEC.md` §9 for the milestone plan.

## Design — after M4

### Reclaim reader space, especially on phone

**Observed (founder, M3):** too much empty space around the text; the reading
area should be bigger, most noticeably on a phone.

**Measured** (browser harness, iPhone-class viewport 390px wide, Normal margins):

| Step | Width | Lost | Source |
|---|---|---|---|
| viewport | 390px | — | |
| book frame | 351px | 39px | `--leaf-reader-frame-pad-x` (`clamp(1rem, 5vw, 5rem)`) |
| viewer box | 300px | 51px | `--leaf-reader-viewer-pad-x/y` (`clamp(1.6rem, 3.4vw, 3rem)`) |
| content body | 276px | 24px | epub.js column gap padding (it owns this) |
| text column | 236px | 40px | `.chapter` side padding — the Margins setting |

Net: **~60% of the screen width is text**, ~40% is padding — and the top and
bottom bars take vertical space on top of that.

**Directions to consider** (not decided):
- Make the frame/viewer padding responsive rather than `clamp()`-uniform — a
  phone does not need the same breathing room as a 1180px spread.
- Drop the open-book frame chrome (gutter shadow, folio slots) below the spread
  breakpoint, where there is no second page to suggest anyway.
- Let immersive mode (`F`) be the default on small screens, or auto-hide the
  bars while reading.
- Re-tune the Margins scale for phones — "Narrow" could legitimately be 0.
- The `--leaf-reader-frame-max-h` cap and vertical padding deserve the same pass.

**Constraint:** all of it is token + `*-ui` work. The engine, normalizer and
content pipeline must not need to change — this is exactly the swappable-layer
seam MVP 1 was built to protect (SPEC §10).

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

### Highlighting on a phone

**Observed (founder, M4):** the highlight flow is not intuitive on a phone.

Desktop assumes a mouse selection followed by a popover. On touch, the native
selection handles and the OS text-selection menu compete with our popover, and
the popover is anchored to the top of the frame rather than to the selection.

Lower priority than the loading states. Directions: anchor the popover to the
selection rectangle, suppress the native callout inside the book iframe
(`-webkit-touch-callout`), consider long-press-to-highlight, and make the tap
target for an existing highlight bigger than the text itself.

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
