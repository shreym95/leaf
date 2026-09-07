# Leaf

A calm web e-reader for public-domain classics and your own DRM-free EPUBs.
Real epub.js pagination, fine-press typography, Day/Sepia/Night themes, synced library.

All project documentation lives in [`docs/`](./docs) — see
[`docs/README.md`](./docs/README.md) for the map. Most-used:
[`DESIGN.md`](./docs/DESIGN.md) (design language — **start there for any visual or
theme work**), [`SPEC.md`](./docs/SPEC.md) (scope + architecture),
[`REVISED_PLAN.md`](./docs/REVISED_PLAN.md) (UI/UX roadmap),
[`BACKLOG.md`](./docs/BACKLOG.md) (open work),
[`DEPLOY.md`](./docs/DEPLOY.md) (deploys + migrations).
Build rules for agents are in [`CLAUDE.md`](./CLAUDE.md), at the root.

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

- `src/design/` — all design tokens (the only place with literal colors/sizes/fonts);
  documented in [`DESIGN.md`](./docs/DESIGN.md)
- `src/components/` — presentational chrome (primitives, reader-ui, library-ui)

Logic (`src/reader`, `src/lib`, `src/store`) is style-agnostic and may not import from
`design/` or `components/`. Enforced by ESLint.

## Environment

Copy `.env.example` to `.env.local` and fill it from your own Supabase project.
No real values are committed — this repo is public.

## License

MIT — see [`LICENSE`](./LICENSE).
