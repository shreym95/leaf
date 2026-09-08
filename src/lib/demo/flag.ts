// Demo mode — the single source of truth for whether Leaf serves in-memory
// fixtures instead of talking to Supabase. See docs/DESIGN-LOCAL.md.
//
// Demo mode lets a designer clone the repo and run the real app on localhost
// with NO Supabase project, NO `.env`, NO login and NO live data, so they can
// edit the shipping design files (`src/design/`, `src/components/*-ui/`,
// `src/components/primitives/`) and see the result immediately.
//
// ── SAFETY: demo mode is NEVER reachable in production ──────────────────────
// Production (Vercel) always sets NEXT_PUBLIC_SUPABASE_URL and
// NEXT_PUBLIC_SUPABASE_ANON_KEY, and never sets LEAF_DEMO. `IS_DEMO` is false
// whenever Supabase is configured AND the flag is unset — exactly the
// production state — so no build with a real backend can take a demo path.
// `src/lib/demo/flag.test.ts` pins this.
//
// This module is dependency-free and browser-safe: `NEXT_PUBLIC_`-prefixed env
// vars are inlined into the client bundle by Next, so `IS_DEMO` evaluates the
// same on the server and in the browser.

function present(value: string | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}

/**
 * Supabase env present? Mirrors `isSupabaseConfigured` in `src/lib/supabase/`
 * (same two vars, same `.length > 0` test) so the two never disagree.
 */
const supabaseConfigured =
  present(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  present(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/**
 * Explicit opt-in from `npm run design`. Both names are accepted: `LEAF_DEMO`
 * for server code, `NEXT_PUBLIC_LEAF_DEMO` so the browser bundle sees it too
 * (the `design` script sets both).
 */
const demoFlag =
  process.env.LEAF_DEMO === "1" || process.env.NEXT_PUBLIC_LEAF_DEMO === "1";

/**
 * True when Leaf should run against fixtures:
 *   - `npm run design` set the flag, OR
 *   - Supabase is not configured — a bare `npm run dev` after a fresh clone,
 *     which is exactly the state where the real path cannot work anyway (the
 *     Supabase client throws on an empty URL/key).
 *
 * False whenever Supabase IS configured and the flag is unset (production).
 */
export const IS_DEMO: boolean = demoFlag || !supabaseConfigured;
