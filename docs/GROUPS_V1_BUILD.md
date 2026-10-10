# Groups v1 — build plan

_Written 2026-10-11. Design source: `FEATURES_PLAN.md` §5 (decisions D4–D8 settled).
This file says **how** it gets built without breaking what is live._

Groups v1 ships in two workstreams, one after the other:

- **v1a — groups, invites, group reads, progress, milestones.** The core loop: create a
  group, invite someone, read the same book, see each other move.
- **v1b — page marks and notes (spoiler-gated), reading schedule.** Starts only after
  v1a is merged.

Each workstream is one feature branch, one integrator, one full-suite gate
(`TESTING.md`). Group reviews and ratings (FEATURES_PLAN §4.1) are a separate, later
workstream.

---

## 1. What "do not break anything live" means here

`dev` **is production**: a push to `dev` deploys to `leaf-black.vercel.app` (`DEPLOY.md`).
There is one Supabase project, and it is production. Every rule below follows from those
two facts.

| # | Guarantee | How it is enforced | Checked by |
|---|---|---|---|
| L1 | **Feature flag.** With the flag off, Leaf behaves exactly as today: no new UI, no new network calls. | `src/lib/groups/flag.ts`: `GROUPS_ENABLED = !IS_DEMO && process.env.NEXT_PUBLIC_LEAF_GROUPS === "1"`. Every entry point, route and reader hook checks it. Group routes return 404 when it is off. | Unit test; Levi; harness run with the flag off |
| L2 | **Additive migrations only.** New tables, functions and triggers. No `alter`/`drop` on any existing table, policy, function or storage policy. | Migration review | Levi greps every migration |
| L3 | **Book files never cross users.** Storage policies and upload paths are untouched. | No task owns `storage.objects` policies or `src/lib/upload-client.ts` | Levi |
| L4 | **Existing tests are never edited.** The test count only goes up. | Brief rule; stop-and-report | Delta in every report |
| L5 | **Demo mode is unaffected.** Groups are off in demo mode. | The flag includes `!IS_DEMO` | Levi; `npm run dev` with demo on |
| L6 | **The reader hot path cannot fail because of groups.** Group writes go through the outbox; errors are swallowed exactly like position writes. | Reader-hook task contract | Unit test that a throwing group write leaves reading untouched |
| L7 | **Offline is unchanged.** No service worker or cache changes in v1. Group pages are online-only and show the existing offline fallback. | No task owns `src/lib/offline/service-worker.ts` | Levi |
| L8 | **Account deletion still works** when the user owns a group or is a member of one. | Ownership-transfer trigger (S1) | RLS integration test |
| L10 | **Backup before any database change.** No migration is applied to the live project without a fresh, verified backup. | `scripts/db/backup.mjs` (S0); manifest row counts checked | Integrator, before each migration |
| L9 | **Rollback is one switch.** Turning the flag off hides everything. Each migration ships with a down script that is written and reviewed but never run unless needed. | `supabase/rollback/*.down.sql` | Levi reviews each down script |

### Rollout order

1. Build on `feat/groups-v1a` (task branches merge into it). Nothing is pushed to `dev`.
2. Take a backup (L10). The founder applies the migrations to the live project; they are
   additive and sit unused while the flag is off (L2). The integrator runs the RLS
   integration tests (temporary users, deleted afterwards, as today).
3. Push the integrated branch to `staging`. The founder tests on the staging link, with
   the flag on, against the same database.
4. Merge to `dev` with the **production flag off**. Production behaviour is unchanged (L1).
5. Turn the flag on in production. If anything is wrong, turn it off again (L9); if data
   is wrong, run the migration's down script, and restore from the backup only as a
   last resort.

---

## 2. Founder setup before the build starts

Decided 2026-10-11: **one database, two links.** A separate staging database was too much
setup for now. Safety comes from additive migrations (L2), the flag (L1), down
scripts (L9) and backups (L10).

| | Production | Staging |
|---|---|---|
| Git branch | `dev` | `staging` |
| Link | `leaf-black.vercel.app` | `leaf-git-staging-<scope>.vercel.app` (Vercel's branch URL, stable across pushes) |
| Supabase | live project | **the same live project** |
| `NEXT_PUBLIC_LEAF_GROUPS` | off until launch | `1` |

Anything done on the staging link is real data in the live database. Test groups are
visible only to their members.

- **F1 — Staging link (founder, one-time, about 5 minutes):**
  1. Vercel: add, for **Preview, branch `staging` only**, the same three Supabase vars as
     Production, plus `NEXT_PUBLIC_LEAF_GROUPS=1`.
  2. Supabase → Authentication → URL Configuration: add the staging link to Redirect URLs.
     Google needs no change, because its redirect goes to Supabase.
  3. Vercel Deployment Protection may put a Vercel login in front of preview links. To
     let a second tester in, turn it off for previews.
- **F2 — Commits and pushes:** agents commit on their own task branch. The integrator
  merges into `feat/groups-v1a` and pushes it to **`staging` only**. Nothing is pushed
  to `dev` until the founder signs off on the staging link.
- **F3 — Look of the group screens. Decided 2026-10-11:** consistent with the existing
  design language, clean, with minimal plain copy (§5). A full design review is in the
  backlog for after this version.

---

## 3. Schema contract (v1a)

Tasks run in parallel against this contract. A task that needs to change it stops and
reports; it does not improvise.

**`0008_groups_core.sql`**

```
groups         id uuid pk, name text not null (1–60 chars), created_at timestamptz
               -- no owner_id column: the owner is the group_members row with role 'owner'
group_members  group_id → groups on delete cascade, user_id → auth.users on delete cascade,
               role text check in ('owner','member'), joined_at timestamptz; pk (group_id, user_id)
               unique (group_id) where role = 'owner'          -- exactly one owner
group_invites  token text pk (≥ 32 random bytes, url-safe), group_id → groups on delete cascade,
               created_by → auth.users on delete cascade, expires_at timestamptz, max_uses int,
               uses int default 0
is_member(gid uuid) returns boolean              -- security definer, stable, search_path = ''
group_member_names(gid uuid) returns table (user_id, display_name, role, joined_at)
                                                 -- security definer; empty unless caller is a member
```

- **Every foreign key to `auth.users` states its `on delete` action.** A default
  `no action` key would block account deletion (`src/app/api/account/delete/route.ts`
  ends with `auth.admin.deleteUser`, which relies on cascades).
- **Display names:** `profiles` stays owner-only (its RLS is not touched, L2). Members
  see each other's names only through `group_member_names()`.
- **No policy recursion:** `group_members`' select policy calls `is_member()`, which reads
  `group_members` as `security definer` and so bypasses RLS. Every definer function
  sets `search_path = ''` and schema-qualifies every name.

- **Size cap:** a trigger rejects a 6th member. The cap is defined in one SQL function
  (`group_member_cap()` returns 5) so raising it later is a one-line migration.
- **Owner transfer:** an `after delete on group_members` trigger (security definer,
  `search_path = ''`). If the deleted row was the owner, it promotes the member with the
  earliest `joined_at`. If no members remain, it deletes the group. It fires the same
  way for leaving, removal and the cascade from account deletion. Since the owner is
  only a role, no foreign key can block deletion or take the group down with the owner.
- **RLS:**
  - `groups`: select if `is_member(id)`; no client insert, update or delete. Create
    and rename go through Route Handlers.
  - `group_members`: select if `is_member(group_id)`; delete own row (leave). All
    other writes go through Route Handlers.
  - `group_invites`: no client access at all.

**`0009_group_reads.sql`**

```
group_reads     id uuid pk, group_id → groups on delete cascade, title, author,
                source text check in ('standardebooks','gutenberg','upload'), source_ref text null,
                outline jsonb not null,   -- [{ index, label, depth, part_index|null }] labels only
                schedule jsonb null,      -- reserved for v1b; v1a writes null
                created_by → auth.users, created_at
read_copies     read_id → group_reads on delete cascade, user_id → auth.users on delete cascade,
                book_id → books on delete cascade, content_sha256 text null, alignment jsonb,
                pk (read_id, user_id)
read_progress   read_id, user_id, chapter_index int, chapter_fraction real (0–1), percent real,
                finished_at timestamptz null, manual boolean, updated_at; pk (read_id, user_id)
read_milestones read_id, user_id, point text, reached_at; pk (read_id, user_id, point)
```

- **RLS:**
  - `group_reads`: select if `is_member(group_id)`; insert and delete through Route
    Handlers only.
  - `read_copies`: owner-only (`user_id = auth.uid()`).
  - `read_progress`: select if a member of the read's group; insert and update only
    your own row, and only if you are a member.
  - `read_milestones`: select if a member; **no client writes at all**.
- **`group_reads.created_by`:** `→ auth.users on delete set null` (nullable), so a
  read outlives its creator's account.
- **Milestone trigger:** `after insert or update on read_progress`, `security definer`,
  `search_path = ''`. It writes only for `NEW.user_id`, whose membership the
  `read_progress` insert policy has already checked. For each point at or behind the new
  position (each Part start, `half`, `end`), it inserts into `read_milestones` with
  `on conflict do nothing`. It is append-only, so arrival order is fixed.
- **Row types:** `src/lib/types.ts` is hand-maintained in lockstep with the migrations
  (its header says so; `db:types` is not in use). S1 and S4 append the row types for
  their tables.

---

## 4. Tasks — v1a

Byte-sized, with one owner and a fixed set of files each. `→` means "depends on".

### Wave 0 — safety net (runs alongside wave 1)

| ID | Agent | Task | Owns | Done when |
|---|---|---|---|---|
| **S0** | senku | Backup and restore scripts for the live project, using the existing service-role env and supabase-js (no new dependencies; `pg_dump` is not installed). **Backup:** every `public` table, paginated, to JSON, plus every object in the `epubs` bucket, into `~/leaf-backups/<UTC timestamp>/` (outside the repo, never under it; the repo is public). A manifest records row counts, object counts and sha256 for each file. **Restore:** dry run by default (prints what it would change); applying needs `--apply --project-ref <ref>` matching the env. It upserts rows in foreign-key order and uploads only missing objects. It never deletes and never overwrites. | `scripts/db/backup.mjs`, `scripts/db/restore.mjs`, `scripts/db/lib/*.mjs`, their tests, an npm script entry each in `package.json` (scripts only) | Unit tests for the path guard (refuses a path inside the repo), pagination, FK order and dry-run default, with a mocked client. Agents never run either script against the live project; the integrator runs the first backup |

Schema is not dumped. It is the migrations, replayable in order (`DEPLOY.md`). `auth.users`
is not restored: Google sign-in recreates the user, and the scripts restore `public`
data only.

### Wave 1 — independent, run in parallel

| ID | Agent | Task | Owns (may create or edit) | Done when |
|---|---|---|---|---|
| **S1** | senku | Migration `0008_groups_core.sql` per §3, plus its down script, the row types, and a new RLS integration test file (written here; run only by the integrator in wave 5) | `supabase/migrations/0008_groups_core.sql`, `supabase/rollback/0008_groups_core.down.sql`, `src/lib/types.ts` (append only), new `src/lib/db/groups-rls.integration.test.ts` | Matches the contract; additive only; idempotency style matches `0005`. The test file covers each policy's allow and deny case, plus **deleting an owner's account transfers ownership** and **deleting the last member removes the group**. Typecheck and lint green |
| **S2** | senku | Pure modules: `flag.ts` (L1), `outline.ts` (TOC → outline, Parts detection, milestone points), `alignment.ts` (copy TOC → outline: normalise labels, Roman ↔ Arabic, order-preserving match, confidence 0–1; map `(spineHref, sectionFraction)` ↔ `(chapter_index, chapter_fraction)`) | `src/lib/groups/{flag,outline,alignment,types}.ts` + their tests | Unit tests cover: identical TOCs, renamed labels, an extra front-matter entry, a Parts → Chapters nesting, no TOC (confidence 0), and Roman numerals |
| **S3** | senku | Engine: add optional `spineIndex`, `spineHref`, `sectionFraction` to `ReaderLocation`. **First** confirm in `node_modules/epubjs` source that `located.start.displayed.page/total` count pages within the current section; if not, stop and report. | `src/reader/engine.ts`, new `src/reader/engine-section.test.ts` | Additive fields only; existing behaviour unchanged; **full suite** (shared module) green with a delta |

### Wave 2 — after S1 is reviewed

| ID | Agent | Task | Owns | Done when |
|---|---|---|---|---|
| **S4** | senku | Migration `0009_group_reads.sql` per §3, with the milestone trigger, plus its down script and row types; extends the S1 integration test file | `supabase/migrations/0009_*`, `supabase/rollback/0009_*`, `src/lib/types.ts` (append only), `src/lib/db/groups-rls.integration.test.ts` | As S1, plus: no client can write `read_milestones`; a member cannot write another member's progress; milestone rows appear in arrival order |
| **S5** | senku | Route Handlers: create group, rename, create invite link, accept invite (token, expiry, uses, cap; on accept, auto-import each catalog read into the new member's library through the existing ingest path. **If the member already has that book** (same `source` + `source_ref`), link the existing one instead of importing a duplicate), leave, remove a member (owner only), add a group read. Add `/groups` and `/invite` to the protected prefixes **only when the flag is on** (L1). | `src/app/api/groups/**`, `src/app/api/invites/**`, `src/lib/groups/server/*.ts`, `src/lib/supabase/middleware.ts` (one-line prefix add) | Each handler: the session decides the user (never a body field); 404 when the flag is off; tests for every rejection (expired, used up, full, not owner, not member) |

### Wave 3 — after S2, S3, S4

| ID | Agent | Task | Owns | Done when |
|---|---|---|---|---|
| **S6** | senku | Data client: my groups, group detail, member names, reads, members' progress, my copy link and alignment, manual progress setter. New outbox kind `group-progress`, complete: the `OutboxKind` union, a payload type, the `OutboxPayload` union, a handler in `realHandlers()`, an enqueue helper that coalesces on `${readId}:${userId}` (latest intent wins, as `book-status` does). | `src/lib/db/groups.ts`, `src/lib/offline/outbox.ts` (**additive only**), new `src/lib/offline/outbox-group-progress.test.ts` modelled on `outbox-book-status.test.ts` | Stale replays are harmless and the latest intent wins (tested); existing outbox tests untouched and green; **full suite** (shared module) |
| **S7** | senku | Reader hook: on each debounced position flush, if the flag is on and this book has a `read_copies` row, map the location through the alignment and enqueue `group-progress`. Never awaits the network on the reading path (L6). | new `src/reader/group-progress.ts` + test; minimal wiring at the existing flush call site | A throwing or offline group write never affects reading or position saving; tested |

### Wave 4 — UI, after S5 and S6 (sanji; F3 decides the look)

| ID | Agent | Task | Owns |
|---|---|---|---|
| **U1** | sanji | `/groups` list + create-group dialog + group page (members, copy invite link, leave, remove) | `src/app/(chrome)/groups/**`, `src/components/groups-ui/**` |
| **U2** | sanji | `/invite/[token]`: signed out → `/login?next=`; signed in → accept → land on the group | `src/app/(chrome)/invite/**`, `src/components/groups-ui/**` |
| **U3** | sanji | Group read page: outline with members' markers, milestone feed (arrival order, unreached labels masked), "I'm at chapter N" (manual), "Add your copy" (upload → link → confirm alignment when confidence is low) | `src/app/(chrome)/groups/[id]/reads/**`, `src/components/groups-ui/**` |
| **U4** | sanji | Reader: members' markers on the progress track; flag-gated; no change at all when the flag is off | `src/components/reader-ui/*` (named in the brief), tokens via `DESIGN.md` |
| **U5** | sanji | "Groups" entry in the chrome navigation, flag-gated | the nav component named in the brief |
| **U6** | sanji | `/privacy`: say what group members can see (display name, reading progress, milestones), and that book files are never shared | `src/app/(chrome)/privacy/**` |

U1–U3 share `src/components/groups-ui/` and run **in sequence**. U4, U5 and U6 touch
different files and can run alongside them.

Ownership is serial across waves where a shared file is touched twice:
- `src/lib/types.ts`: S1 (wave 1), then S4 (wave 2).
- the integration test file: S1, then S4.
- `src/lib/supabase/middleware.ts`: S5 only.
- `src/lib/offline/outbox.ts`: S6 only.

### Wave 5 — verification (integrator)

1. **Levi** reviews the integrated `feat/groups-v1a` diff against L1–L9 and the
   contract.
2. Backup taken (L10); migrations applied to the live project by the founder. RLS
   integration tests run by the integrator:
   - non-member denial on every table;
   - a member cannot write another member's progress;
   - nobody can write milestones;
   - invite misuse;
   - deleting the owner's account transfers ownership.
3. Integrator: full suite + `npm run build` in the **main checkout**. Turbopack cannot
   build in a worktree whose `node_modules` is a symlink (HANDOVER).
4. Tier 3: harness run with the flag off (proves no new requests and no visual change)
   and with it on; demo mode check.
5. Founder device test on the staging link: two accounts, one group, one catalog book, one
   uploaded book, manual progress, milestones.
6. **Robin:** the `CHANGELOG.md` entry, and any presentation/logic coupling the
   redesign must know about (CLAUDE.md asks for this).
7. Rollout steps 4–6 of §1.

---

## 5. Guardrails for every subagent brief

Every brief in this workstream includes these, verbatim or tighter:

- **Where:** the worktree path and task branch named in the brief. Never check out,
  merge into or push to `dev`. Never push at all.
- **Files:** only the files listed under "Owns". Need another file? Stop and report;
  do not edit it.
- **Database:** never run `db:push`, `db:link`, `supabase` commands, or any SQL against a
  remote project. Never run `*.integration.test.ts`; those hit a live database and
  belong to the integrator.
- **Migrations:** additive only (L2). Existing migrations are never edited.
- **Tests:** Tier 1 (`vitest related` + typecheck + lint). Escalate to the full suite if
  you touch `src/lib/*` shared modules, `src/reader/*`, `src/store/*` or
  `package.json`. **Never edit an existing test.** If one fails, stop and report. A
  regression test must be shown to fail without its fix.
- **Dependencies:** none added or upgraded.
- **Seams:** `src/lib` and `src/reader` stay style-agnostic and never import from
  `design` or `components`. Visuals only in `src/design`, `src/components/*-ui` and
  `primitives`; tokens only, no hard-coded colours, spacing or fonts. Read `DESIGN.md`
  before any visual work.
- **Flag:** every new entry point checks `GROUPS_ENABLED`. With the flag off, behaviour
  is identical to today (L1).
- **Security:** user identity comes from the session, never from the request body. The
  service-role key is used only in Route Handlers. No secrets in the client, or
  anywhere in the tree (the repo is public).
- **Copy (founder, 2026-10-11):** minimal and plain. Short labels and sentences;
  no exclamation marks, emoji, cheerleading ("Great!", "You're all set"), filler
  ("Let's…", "Simply…") or explanations of the obvious. Match the wording already in the
  app. Empty states give one line, not a paragraph.
- **Look (founder, 2026-10-11):** consistent with the existing design language: existing
  primitives, tokens and spacing scale; no new visual ideas. A full design review
  follows after this version (`BACKLOG.md`).
- **Next.js 16:** read the relevant guide in `node_modules/next/dist/docs/` before writing
  routes or pages.
- **Commits** (if F2 is granted): on the task branch only. One subject line,
  Conventional Commits, trailer exactly `Co-Authored-By: Claude`.
- **Report:** files changed with `path:line`, test delta (`764 → N`), and any contract
  deviation.

---

## 6. v1b (outline only; briefed after v1a merges)

- `0010_read_notes.sql`: `read_notes` per FEATURES_PLAN §5.3, owner-only direct select,
  and `visible_notes(read_id)` gated by the caller's own `read_progress`.
- Page marks and notes in the reader (created like a bookmark, no selection UI) and per
  chapter in the group read page.
- Reading schedule: checkpoints in `group_reads.schedule`, shown on the group read page.
  Checkpoints count as milestone points.
