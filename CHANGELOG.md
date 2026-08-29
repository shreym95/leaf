# Changelog

All notable changes to Leaf. Kept per milestone (see SPEC §9).

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

### Notes for the next-version redesign
- Next.js 16 renamed the `middleware` file convention to **`proxy`** — the root
  file is `src/proxy.ts` exporting `proxy()`. `src/lib/supabase/middleware.ts` is
  a plain helper module, not the framework file.
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
