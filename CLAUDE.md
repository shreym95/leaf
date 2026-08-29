# Project: Leaf — a web e-reader (MVP 1)

Read SPEC.md fully. v0.1 reader prototype (epub.js + fine-press design, Day/Night) is APPROVED;
MVP 1 wraps library + accounts + sync + import around it. NO AI features this version.

Stack: Next.js (App Router) + TS + Tailwind v4 (CSS-first `@theme` + token layer) · epub.js
(real pagination, don't hand-roll) · Supabase (Postgres/Auth/Storage, RLS owner-only) · deploy on Vercel.

## HARD RULES

- UI is a SWAPPABLE layer: visuals only in `src/design` + `src/components/*-ui` + `src/components/primitives`;
  `src/reader` / `src/lib` / `src/store` stay style-agnostic and never import from `design`/`components`.
- No hard-coded colors/space/fonts in components — use tokens (`var(--leaf-*)` or mapped Tailwind utilities).
- No secrets client-side; RLS on every table (test cross-user denial).
- Only Standard Ebooks / Gutenberg / DRM-free uploads; never DRM removal.
- a11y floor + reduced-motion always; tests on CFI position, highlights, RLS, import.
- Ask founder on product ambiguity; pick boring on technical ambiguity.

## Current milestone: M0 — scaffold & the swappable UI seam.

Build: `npm run dev`  ·  Test: `npm test`  ·  Lint: `npm run lint`  ·  Types: `npm run typecheck`

Reference (untracked source of truth for look + logic, under `reference/`):
approved v0.1 reader HTML, Python normalizer. Chapter fixtures in `src/normalizer/fixtures/`.

Expect major UI overhauls next version — keep the seam clean. Log any logic/presentation
coupling in CHANGELOG.md so the redesign knows where to look.
