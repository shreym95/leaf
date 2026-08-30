-- Leaf — 0003_archive_books.sql
--
-- Hiding books from the shelf (post-M6). A large library does not need to be
-- entirely on screen at once, but "I have read this and don't want to see it"
-- is a different thing from "delete this forever" — so hiding is reversible and
-- keeps the file, the highlights and the reading position intact.
--
-- A timestamp rather than a boolean: it records *when*, which is free, sorts,
-- and cannot end up in the ambiguous `false`/`null` state a nullable boolean
-- can. Null means visible.
--
-- Deleting is not modelled here — it removes the row, and `highlights` /
-- `reading_state` already cascade from `books` (0001).
--
-- Run once: Supabase Dashboard -> SQL Editor -> paste -> Run. Safe to re-run.

alter table public.books
  add column if not exists archived_at timestamptz;

comment on column public.books.archived_at is
  'When the reader hid this book from the shelf. Null = visible. Hiding is reversible and keeps the file, highlights and reading position.';

-- The shelf always filters on this, per user.
create index if not exists books_user_archived_idx
  on public.books (user_id, archived_at);
