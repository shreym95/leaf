-- Leaf — 0002_book_cover.sql
--
-- Covers (M6). The cover image is extracted from the EPUB at import/upload and
-- stored in the user's own folder in the `epubs` bucket, so it inherits exactly
-- the same owner-only RLS as the book file — no new bucket, no new policies.
--
-- A separate column from `cover_url` on purpose: this holds a Storage *path*
-- (`<uid>/<book-id>-cover.jpg`) which the app signs at render time, whereas
-- `cover_url` remains free for a genuine remote URL if one is ever wanted.
-- Overloading one column with two meanings is how you end up signing an http
-- link or rendering a bare path.
--
-- Run once: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- Safe to re-run.

alter table public.books
  add column if not exists cover_path text;

comment on column public.books.cover_path is
  'Storage key in the `epubs` bucket for the cover image extracted from the EPUB. Signed at render time. Null when the file carried no cover.';
