# Running Leaf locally for design work

You do **not** need a Supabase account, a `.env` file, a login, or any live data
to work on how Leaf looks. Demo mode serves a fixed library and the three
bundled public-domain books entirely from fixtures.

```bash
nvm use            # Node 22
npm install
npm run design     # http://localhost:3000  — demo mode
```

`npm run design` is `next dev` with `LEAF_DEMO=1`. A bare `npm run dev` also
falls back to demo mode automatically whenever the Supabase env vars are absent,
so a fresh clone gives you a working app instead of a crash.

What works in demo mode: the **library shelf** (16 books — real covers,
placeholder covers, no-cover fallbacks, every progress state, plus a couple of
hidden books), the **reader** for the three bundled EPUBs (they really open and
paginate), and the reader's **"Aa" settings sheet** (theme / font / size /
spacing / margins). Your choices and reading position are saved to
`localStorage`, so they survive a reload exactly like the real app.

What doesn't: sign-in, importing or uploading books, and opening a
metadata-only book (it 404s). None of these crash — they are simply out of
scope for design work.

## Which files you may edit

| Edit freely | Why |
|---|---|
| `src/design/` | all design tokens — the only place with literal colours/sizes/fonts |
| `src/app/globals.css` | maps tokens to Tailwind utilities + the base layer |
| `src/components/primitives/`, `src/components/*-ui/`, `src/components/ui/` | the presentational chrome — tokens only, no literals |

**Read [`DESIGN.md`](./DESIGN.md) first** — it is the single source of truth for
the design language (tokens, the three themes, type scale, motion, the a11y
floor, how to add a theme).

## Which files you must not touch

`src/reader/`, `src/lib/`, `src/store/`, `src/normalizer/` are the
**style-agnostic logic layer**. ESLint forbids them from importing anything in
`src/design/` or `src/components/` (`eslint.config.mjs`), so a redesign touches
only the UI layer and never the engine, data, or sync code. If a visual change
seems to need a logic-layer edit, that is a seam leak worth raising — see
`DESIGN.md` §2 and §10.

Demo mode itself lives in `src/lib/demo/` (fixtures + the `IS_DEMO` flag). It is
an additive branch that can never activate in production — `src/lib/demo/flag.ts`
returns false whenever the Supabase env vars are present and `LEAF_DEMO` is
unset. Leave it alone.
