-- Leaf — 0005_bookmarks.sql
--
-- Bookmarks (REVISED_PLAN §6 Phase 2). A reader drops a marker on a page and
-- comes back to it later. Modelled on `highlights` from 0001: same column
-- idiom, same owner-only RLS shape, same idempotency style as 0002–0004.
--
-- WHY A SEPARATE TABLE, not a column on `reading_state`:
--   `reading_state` is one row per (book, user) — the single *current*
--   position. Bookmarks are many per book, so they get their own table with
--   their own generated id, exactly like `highlights`.
--
-- WHY `label` AND `percent` ARE DENORMALISED HERE:
--   a bookmark list must render without opening the EPUB or resolving a single
--   CFI. `label` is the chapter title captured at save time (from the book's
--   own table of contents); `percent` is the 0..1 progress at save time (the
--   same value `reading_state.percent` holds). Both are point-in-time
--   snapshots — they are NOT kept in sync if the book is re-imported or
--   re-paginated, and that is fine: they exist only to caption a row in a list.
--   `cfi` is the single source of truth for where the bookmark points.
--   Both are nullable: a bookmark saved before `book.locations` is ready has no
--   percent, and a book with no usable TOC entry for the section has no label.
--
-- Run once: Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--
-- Idempotency matches 0001: `create table` is deliberately NOT `if not exists`
-- (it cannot carry the constraints); re-running on a project that already has
-- the table fails at `create table` and the transaction rolls back cleanly.
-- The index and the policy are individually re-runnable
-- (`create index if not exists`, `drop policy if exists` then `create`).

begin;

create table public.bookmarks (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references public.books (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  cfi        text not null,
  label      text,
  percent    real,
  created_at timestamptz not null default now()
);
create index if not exists bookmarks_book_id_idx on public.bookmarks (book_id);

-- Row-Level Security — owner-only, identical shape to `highlights_owner_all`
-- (0001 / SPEC §3.3).
alter table public.bookmarks enable row level security;

drop policy if exists bookmarks_owner_all on public.bookmarks;
create policy bookmarks_owner_all on public.bookmarks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

commit;

-- ===========================================================================
-- Verify (read-only) — run after the migration; every column should be 1 / t.
-- ===========================================================================
-- select
--   (select count(*) from pg_tables
--      where schemaname = 'public' and tablename = 'bookmarks')            as table_exists,
--   (select relrowsecurity from pg_class
--      where oid = 'public.bookmarks'::regclass)                           as rls_enabled,
--   (select count(*) from pg_policies
--      where schemaname = 'public' and tablename = 'bookmarks'
--        and policyname = 'bookmarks_owner_all')                           as policy_exists,
--   (select count(*) from pg_indexes
--      where schemaname = 'public' and tablename = 'bookmarks'
--        and indexname = 'bookmarks_book_id_idx')                          as index_exists;
