# Supabase — Leaf database layer

The canonical schema lives in [`migrations/0001_init.sql`](./migrations/0001_init.sql):
all five tables (`profiles`, `books`, `reading_state`, `highlights`,
`reader_settings`; `bookmarks` follows in `0005`), owner-only RLS on every one,
the signup trigger that seeds
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

## Migrations & the CLI

The Supabase CLI is wired up as a devDependency (pinned in `package.json`).
`supabase/config.toml` is intentionally minimal; secrets never live in it.

npm scripts (run from the repo root):

| script         | does                                                        |
| -------------- | ---------------------------------------------------------- |
| `npm run db:link`  | link the working tree to project `emvasvbeypkrfnlzjxaz` |
| `npm run db:push`  | apply migrations not yet in the remote history table     |
| `npm run db:diff`  | diff `supabase/migrations` against the linked project    |
| `npm run db:types` | regenerate `src/lib/types.ts` from the remote schema     |

Secrets come from the environment or an interactive prompt, never a committed
file:

- **Access token** — `supabase login`, or export `SUPABASE_ACCESS_TOKEN`.
- **DB password** — the `db:link` prompt (cached under `~/.supabase`), or
  export `SUPABASE_DB_PASSWORD`.

The CLI writes only to `supabase/.temp/` and `supabase/.branches/`, both covered
by `supabase/.gitignore` (which also ignores `.env.local` / `.env.keys`).

### One-time baseline — 0001–0003 were applied BY HAND

Migrations `0001`–`0003` were pasted into the SQL editor and run manually. They
are **not** recorded in the remote `supabase_migrations.schema_migrations`
table, which does not exist yet. A plain `supabase db push` would therefore try
to re-apply `0001` (which fails at `create table` and rolls back) instead of
just applying the new migration.

Fix it once, then `db:push` works normally forever after. Run from the repo root:

```bash
# 1. Authenticate (opens a browser) — or export SUPABASE_ACCESS_TOKEN instead.
supabase login

# 2. Link. Prompts for the DB password (Dashboard → Project Settings → Database).
#    Or: export SUPABASE_DB_PASSWORD=... first.
npm run db:link

# 3. Confirm the split: 0001–0003 present locally, remote history empty.
supabase migration list --linked

# 4. Tell the history table 0001–0003 are already applied, WITHOUT running them.
#    This creates the schema_migrations table if it is missing.
supabase migration repair --status applied 0001 0002 0003 --linked

# 5. Verify: 0001–0003 now show on both sides, 0004 is local-only.
supabase migration list --linked

# 6. Apply 0004 (and only 0004).
npm run db:push

# 7. Regenerate types for the widened theme union.
npm run db:types
```

If you would rather not baseline yet, apply `0004` the old way — paste
`migrations/0004_sepia_theme.sql` into the SQL editor and Run — and do steps
4–5 later for `0001 0002 0003 0004` together. `0004` is idempotent, so a repair
that later marks it "applied" after a hand-run is harmless.

### Order dependency

If the project is ever rebuilt from scratch, the migrations must run in
filename order: `0001` → `0002` → `0003` → `0004` → `0005` → `0006`. `0004`
alters CHECK constraints created in `0001` and will fail against a database that
has not run `0001`; `0005` (the `bookmarks` table) references `books` and
`auth.users`; `0006` narrows the theme set `0004` widened, and moves any `sepia`
rows to `day` before it tightens the constraint — order matters inside that file
too. `supabase db push` against a fresh project handles the ordering itself.

`0005_bookmarks.sql` is a hand-apply like the others: Dashboard → SQL Editor →
paste → Run. Its `create table` is not `if not exists` (same as `0001`), so a
re-run fails at the table and rolls back; the index and policy are re-runnable.

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

`src/lib/types.ts` is still hand-maintained and must be kept in lockstep with
the migrations. The CLI is now wired up, so once the migration history is
baselined (see above) this can be regenerated instead:

```
npm run db:types   # supabase gen types typescript --project-id <ref> > src/lib/types.ts
```

Until someone does that switch-over, edit `src/lib/types.ts` by hand alongside
each migration.
