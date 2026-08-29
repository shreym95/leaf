# Changelog

All notable changes to Leaf. Kept per milestone (see SPEC §9).

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
