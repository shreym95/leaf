-- Leaf — 0012_annotations.sql
--
-- Notes v1 (NOTES_PLAN §4): one personal table for page marks, highlights and
-- their notes, a share link from `read_notes` to an annotation, and the
-- replaced `visible_notes` return shape.
--
-- Requires 0005_bookmarks.sql (bookmarks), 0001_init.sql (highlights) and
-- 0010/0011 (read_notes, visible_notes, read_notes_insert_own).
--
-- N2 AMENDMENT (NOTES_PLAN §2). This file alters two existing objects, and only
-- these: it adds `read_notes.annotation_id`, and it replaces `visible_notes(uuid)`
-- (drop, then create, because its return type changes). It also replaces the
-- policy `read_notes_insert_own` (drop, then create under the same name).
-- `bookmarks` and `highlights` are NOT altered, dropped or deleted (N3).
--
-- PERSONAL ITEMS. `annotations.kind` is 'page' (a position, the old bookmark)
-- or 'range' (a quoted selection, the old highlight). `quote` is null for 'page'
-- and required for 'range'. There is no database cap on `quote`: the client caps
-- it at 5000 characters. Only the shared copy in `read_notes` is capped (300).
--
-- COPY FROM THE OLD TABLES. `copy_legacy_annotations()` copies `bookmarks` to
-- kind 'page' and `highlights` to kind 'range', with the same ids. It is
-- idempotent (`on conflict (id) do nothing`). It runs once here and again at
-- release, for rows that production v1 writes between the two runs (§4.1).
--
-- SHARE LINK. `read_notes.annotation_id` ties a group copy to its personal item.
-- Deleting the item cascades to the group copy. A note edit on the item is
-- copied to the group copy by `annotations_sync_read_notes` (§4.2).
--
-- SPOILER GATE. Unchanged. `visible_notes` keeps the 0010 gate body byte for
-- byte. It adds the quote columns to its output, and not `annotation_id`.
--
-- NOTE LENGTH. 1-500 characters when present (§4.1), the same cap as read_notes.
--
-- Run once: Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
-- Take a backup first (GROUPS_V1_BUILD L10 / NOTES_PLAN N9). Down script:
-- supabase/rollback/0012_annotations.down.sql (never run unless instructed).
--
-- Idempotency: `create table` is deliberately NOT `if not exists` (it cannot
-- carry the constraints); re-running on a project that already has the table
-- fails there and the transaction rolls back cleanly. Columns, indexes,
-- functions, triggers, policies and the copy are individually re-runnable
-- (`add column if not exists`, `create index if not exists`,
-- `create or replace`, `drop ... if exists` then `create`, `on conflict`).

begin;

-- ===========================================================================
-- Tables
-- ===========================================================================

-- annotations ---------------------------------------------------------------
-- Owner-only. Shape per NOTES_PLAN §4.1.
create table public.annotations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  book_id    uuid not null references public.books (id) on delete cascade,
  kind       text not null check (kind in ('page', 'range')),
  cfi        text not null,
  -- The full selected text for 'range'; null for 'page'. No database length cap.
  quote      text,
  note       text check (note is null or char_length(note) between 1 and 500),
  -- Chapter title at creation (denormalised, as in 0005). Null when unknown.
  label      text,
  -- 0..1 progress at creation (denormalised, as in 0005). Null when unknown.
  percent    real,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint annotations_quote_matches_kind check (
    (kind = 'page' and quote is null)
    or (kind = 'range' and quote is not null)
  )
);
create index if not exists annotations_book_id_idx on public.annotations (book_id);
create index if not exists annotations_user_id_idx on public.annotations (user_id);

-- read_notes: the share link (NOTES_PLAN §4.2). Nullable, so every existing
-- group row stays valid. Deleting the personal item removes its group copy.
alter table public.read_notes
  add column if not exists annotation_id uuid null
    references public.annotations (id) on delete cascade;

-- One group copy per (item, read). The same item may be shared to two reads.
create unique index if not exists read_notes_annotation_read_uidx
  on public.read_notes (annotation_id, read_id)
  where annotation_id is not null;

-- ===========================================================================
-- Functions
-- ===========================================================================
-- Every function sets `search_path = ''` and schema-qualifies every name
-- (same pattern as 0008-0011).

-- Before update of note: a note change is the one update that stamps
-- updated_at. Other column updates leave it alone.
create or replace function public.touch_annotation_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- After update of note (NOTES_PLAN §4.2): copy the new note to the group copy
-- of this item, if it is shared. A page item flips between 'mark' (no note) and
-- 'note' (note present), so the read_notes table checks keep holding. A range
-- item stays 'highlight'.
create or replace function public.sync_read_notes_from_annotation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.read_notes r
     set note = new.note,
         kind = case
                  when new.kind = 'range' then 'highlight'
                  when new.note is null then 'mark'
                  else 'note'
                end
   where r.annotation_id = new.id;

  return null;
end;
$$;

-- Copy legacy rows into annotations. Re-runnable: `on conflict (id) do nothing`
-- keeps every row already copied, including rows the user has since edited.
-- Returns the number of rows inserted by this call.
-- Callable only by the service role or the database owner: the migration runs
-- it once, and the release runs it again (NOTES_PLAN §4.1).
create or replace function public.copy_legacy_annotations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pages  integer;
  v_ranges integer;
begin
  insert into public.annotations
    (id, user_id, book_id, kind, cfi, quote, note, label, percent, created_at, updated_at)
  select b.id, b.user_id, b.book_id, 'page', b.cfi, null, null, b.label, b.percent,
         b.created_at, b.created_at
  from public.bookmarks b
  on conflict (id) do nothing;
  get diagnostics v_pages = row_count;

  insert into public.annotations
    (id, user_id, book_id, kind, cfi, quote, note, label, percent, created_at, updated_at)
  -- A legacy note that is empty or over 500 characters would fail the note check and
  -- abort the whole copy. It is trimmed to 500 or nulled here; the legacy row keeps
  -- the original until the cleanup migration. A highlight with no text is skipped.
  select h.id, h.user_id, h.book_id, 'range', h.cfi_range, h.text,
         nullif(left(h.note, 500), ''), null, null,
         h.created_at, h.created_at
  from public.highlights h
  where coalesce(h.text, '') <> ''
  on conflict (id) do nothing;
  get diagnostics v_ranges = row_count;

  return v_pages + v_ranges;
end;
$$;

-- REPLACED (drop, then create: the return type gains the quote columns).
-- The gate (the where clause and the exists checks) is the 0010 text, unchanged.
drop function if exists public.visible_notes(uuid);
create function public.visible_notes(rid uuid)
returns table (
  id               uuid,
  read_id          uuid,
  user_id          uuid,
  chapter_index    int,
  chapter_fraction real,
  kind             text,
  note             text,
  cfi              text,
  content_sha256   text,
  created_at       timestamptz,
  quote_exact      text,
  quote_prefix     text,
  quote_suffix     text
)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.read_id, n.user_id, n.chapter_index, n.chapter_fraction,
         n.kind, n.note, n.cfi, n.content_sha256, n.created_at,
         n.quote_exact, n.quote_prefix, n.quote_suffix
  from public.read_notes n
  where n.read_id = rid
    and public.is_read_member(rid)
    and (
      n.user_id = (select auth.uid())
      or (
        exists (
          select 1
          from public.group_reads r
          join public.group_members m on m.group_id = r.group_id
          where r.id = rid
            and m.user_id = n.user_id
        )
        and exists (
          select 1
          from public.read_progress p
          where p.read_id = rid
            and p.user_id = (select auth.uid())
            and (
              p.finished_at is not null
              or (n.chapter_index, n.chapter_fraction)
                 <= (p.chapter_index, p.chapter_fraction)
            )
        )
      )
    )
  order by n.chapter_index, n.chapter_fraction, n.created_at;
$$;

-- ===========================================================================
-- Triggers
-- ===========================================================================

drop trigger if exists annotations_touch_updated_at on public.annotations;
create trigger annotations_touch_updated_at
  before update of note on public.annotations
  for each row
  when (new.note is distinct from old.note)
  execute function public.touch_annotation_updated_at();

drop trigger if exists annotations_sync_read_notes on public.annotations;
create trigger annotations_sync_read_notes
  after update of note on public.annotations
  for each row
  when (new.note is distinct from old.note)
  execute function public.sync_read_notes_from_annotation();

-- ===========================================================================
-- Function privileges
-- ===========================================================================
-- Same pattern as 0008-0011: strip PUBLIC and the Supabase default grants, then
-- grant back only what the client needs. service_role keeps its default grant.

revoke all on function public.touch_annotation_updated_at()     from public, anon, authenticated;
revoke all on function public.sync_read_notes_from_annotation() from public, anon, authenticated;
revoke all on function public.copy_legacy_annotations()         from public, anon, authenticated;

-- Only the note of an annotation can be changed by its owner: anchor, quote and
-- kind are fixed at creation, so a shared copy can never drift from its source.
revoke update on table public.annotations from authenticated;
grant update (note) on table public.annotations to authenticated;

revoke all on function public.visible_notes(uuid) from public, anon;
grant execute on function public.visible_notes(uuid) to authenticated;

-- ===========================================================================
-- Row-Level Security
-- ===========================================================================

alter table public.annotations enable row level security;

-- Owner-only, identical in shape to bookmarks_owner_all (0005).
drop policy if exists annotations_owner_all on public.annotations;
create policy annotations_owner_all on public.annotations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- REPLACED (drop, then create under the same name). Starts from the 0011 text.
-- Changes: highlights are admitted, with a quote; a quote is required exactly
-- when kind = 'highlight'; and an annotation link must be one of the caller's
-- own items. The quote caps (300 / 32) are the read_notes table checks and are
-- unchanged. The chapter bound is kept as 0011 wrote it.
drop policy if exists read_notes_insert_own on public.read_notes;
create policy read_notes_insert_own on public.read_notes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_read_member(read_id)
    and chapter_index < (
      select jsonb_array_length(r.outline)
      from public.group_reads r
      where r.id = read_id
    )
    and kind in ('mark', 'note', 'highlight')
    and (kind = 'highlight') = (quote_exact is not null)
    and (
      annotation_id is null
      or exists (
        select 1
        from public.annotations a
        where a.id = read_notes.annotation_id
          and a.user_id = (select auth.uid())
      )
    )
  );

-- ===========================================================================
-- Copy (run once here; re-run at release, NOTES_PLAN §4.1)
-- ===========================================================================

select public.copy_legacy_annotations();

commit;

-- ===========================================================================
-- Verify (read-only) — run after the migration. Every line should be 1 or t.
-- Counts are equal when nothing has been written to the new table yet.
-- ===========================================================================
-- select
--   (select count(*) from pg_tables
--      where schemaname = 'public' and tablename = 'annotations')           as table_exists,
--   (select relrowsecurity from pg_class
--      where oid = 'public.annotations'::regclass)                          as rls_enabled,
--   (select count(*) from pg_policies
--      where schemaname = 'public' and tablename = 'annotations'
--        and policyname = 'annotations_owner_all')                          as policy_exists,
--   (select count(*) from pg_indexes
--      where schemaname = 'public' and tablename = 'annotations'
--        and indexname in ('annotations_book_id_idx', 'annotations_user_id_idx')) as indexes,
--   (select count(*) from pg_attribute
--      where attrelid = 'public.read_notes'::regclass
--        and attname = 'annotation_id' and not attisdropped)                 as link_column,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'visible_notes'
--        and pg_get_function_result(p.oid) like '%quote_exact%')              as visible_has_quotes,
--   (select count(*) from public.annotations where kind = 'page')
--     = (select count(*) from public.bookmarks)                               as pages_copied,
--   (select count(*) from public.annotations where kind = 'range')
--     = (select count(*) from public.highlights)                              as ranges_copied;
