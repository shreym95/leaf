# Supabase — Leaf database layer

The canonical schema lives in [`migrations/0001_init.sql`](./migrations/0001_init.sql):
all five tables (`profiles`, `books`, `reading_state`, `highlights`,
`reader_settings`), owner-only RLS on every one, the signup trigger that seeds
`profiles` + `reader_settings`, and the private `epubs` Storage bucket with
per-user-folder policies.

## Run it (once, against a fresh project)

1. Create a Supabase project. Enable the **Google** auth provider
   (Dashboard → Authentication → Providers).
2. Dashboard → **SQL Editor** → **New query**.
3. Paste the entire contents of `migrations/0001_init.sql`.
4. **Run.**

The script is wrapped in a single transaction. It is meant to run once on an
empty project — re-running it on a project that already has these tables will
fail at `create table` and roll back cleanly (the trigger/function/policy/bucket
parts are individually re-runnable via `create or replace` / `drop ... if
exists` / `on conflict do nothing`).

## Environment

Copy `.env.example` → `.env.local` and fill from Dashboard → Project Settings →
API:

| var                              | where            | notes                                   |
| -------------------------------- | ---------------- | --------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`       | client + server  | project URL                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | client + server  | safe to ship — RLS protects every table |
| `SUPABASE_SERVICE_ROLE_KEY`      | **server only**  | bypasses RLS; never expose to the client |

With real values in `.env.local`, the RLS isolation test
(`src/lib/db/rls.integration.test.ts`) runs against the live project; without
them it is skipped.

## Types

`src/lib/types.ts` is currently hand-maintained and must be kept in lockstep
with `0001_init.sql`. Once the Supabase CLI is set up (M1 tail / M2) it will be
regenerated and this hand-maintenance ends:

```
supabase gen types typescript --project-id <ref> > src/lib/types.ts
```
