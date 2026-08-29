# Leaf

A calm web e-reader for public-domain classics and your own DRM-free EPUBs.
Real epub.js pagination, fine-press typography, Day/Night themes, synced library.

MVP 1 — see [`SPEC.md`](./SPEC.md) for scope, architecture, and milestones,
and [`CLAUDE.md`](./CLAUDE.md) for the build rules.

## Develop

```bash
nvm use            # Node 22
npm install
npm run dev        # http://localhost:3000
```

| Script | Does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm test` | Vitest |
| `npm run lint` | ESLint (incl. import-boundary seam rule) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format` | Prettier write |

## Architecture

The UI is a **swappable layer** — a redesign next version should touch only:

- `src/design/` — all design tokens (the only place with literal colors/sizes/fonts)
- `src/components/` — presentational chrome (primitives, reader-ui, library-ui)

Logic (`src/reader`, `src/lib`, `src/store`) is style-agnostic and may not import from
`design/` or `components/`. Enforced by ESLint.

## Environment

Copy `.env.example` to `.env.local`. Supabase is wired in M1 — until then the values
are placeholders.
