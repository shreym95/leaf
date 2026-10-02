-- Leaf — 0007_finished_books.sql
--
-- Records that a reader finished a book.
--
-- `books.status` has existed since 0001 with `check (status in ('reading',
-- 'finished'))` and has never been written by any code path — the default
-- 'reading' is the only value in the table. This migration keeps that column as
-- the state and adds `finished_at` as the timestamp, following `archived_at`
-- (0003): a timestamp records *when*, which is free, sorts, and never lands in
-- the ambiguous false/null state a nullable boolean can.
--
-- Two fields describing one fact can drift, so the CHECK below makes that
-- impossible: status is 'finished' exactly when finished_at is set. A write
-- must set both or neither. The constraint is validated against existing rows
-- when added — every row today is ('reading', null), which satisfies it.
--
-- No index. The library already loads a user's whole shelf in one query
-- (`listBooks`) and partitions it in memory; a finished-books index would serve
-- no query that exists.
--
-- Run once: Supabase Dashboard -> SQL Editor -> paste -> Run. Safe to re-run.

alter table public.books
  add column if not exists finished_at timestamptz;

comment on column public.books.finished_at is
  'When the reader reached the end of this book. Null = not finished. Always set together with status = ''finished'' (see books_finished_consistent).';

-- Drop-if-exists then re-add is how a CHECK is made idempotent — Postgres has
-- no `add constraint if not exists`.
alter table public.books
  drop constraint if exists books_finished_consistent;
alter table public.books
  add constraint books_finished_consistent
  check ((status = 'finished') = (finished_at is not null));
