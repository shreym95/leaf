# Changelog

All notable changes to Leaf. Kept per milestone (see SPEC §9).

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
  measure). Also registers `leaf-day` / `leaf-night` with `rendition.themes`.
  Returns a callable handle (`() === destroy()`) with `refresh()` + `destroy()`.
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
  URL, resize→`relayout`, keyboard ←/→/`F`/`Esc`, the page-turn crossfade),
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
  `--leaf-reader-progress-*`, `--leaf-reader-turn-opacity` (→ `1` under
  `prefers-reduced-motion`, collapsing the crossfade to a no-op).

### Removed
- `src/reader/bootstrap.ts` + `src/components/reader-ui/ReaderBootstrap.tsx`
  (the M2 smoke reader) — superseded by `engine.ts` + the chrome above.

### Presentation ↔ logic coupling (for the next redesign)
- **Reader theme is a dual write.** The reader's Day/Night control writes both
  the reader-settings store (persisted to `reader_settings`) *and*
  `ThemeProvider.setTheme` (`<html data-theme>` + localStorage). `ReaderShell`
  owns `setReaderTheme` and a mount effect that aligns `<html data-theme>` with
  the persisted setting. A redesign that reworks theming touches
  `ReaderShell` + `ReaderTopBar` + `ReaderSettingsSheet`, not the engine.
- **The page-turn duration is read from the token at runtime.** `ReaderShell`
  reads the computed `--leaf-dur-turn` off the frame element to time the
  crossfade class removal (rather than hard-coding 320ms) — the token stays the
  single source of truth, including its `0s` reduced-motion value.
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
