-- Leaf — 0010_read_notes.sql
--
-- Reading groups, v1b (FEATURES_PLAN §5.3, §5.5, §5.6, §5.8, GROUPS_V1_BUILD §3):
-- page marks and notes inside a group read, behind a database-enforced spoiler
-- gate, plus schedule checkpoint milestones.
--
-- Requires 0008_groups_core.sql (group_members) and 0009_group_reads.sql
-- (group_reads, read_progress, record_read_milestones).
--
-- ADDITIVE ONLY. Creates one table, two functions, one trigger, policies and
-- indexes. It replaces one existing function, `record_read_milestones()`: its
-- body is extended with schedule checkpoints, its signature is unchanged, and
-- every rule it already applied is unchanged. Its trigger keeps its name and
-- grants (CREATE OR REPLACE keeps the existing privileges).
-- `remove_member_read_data()` is not touched: leave cleanup for notes is its own
-- trigger and function.
--
-- EVERY FOREIGN KEY TO auth.users STATES ITS `on delete` ACTION (cascade).
--
-- NOTES ARE NOT HIGHLIGHTS. `kind` is 'mark', 'note' or 'highlight'. The table
-- admits 'highlight' and the quote columns so the v2 redesign needs no table
-- change, but the insert policy admits only 'mark' and 'note', with no quote.
-- Notes are create and delete only: there is no update policy.
--
-- THE SPOILER GATE. Direct select is owner-only. Other members read notes only
-- through `visible_notes(read_id)`, which returns another member's note only
-- when the caller has reached it (equal position counts) or has finished the
-- book, and only while that member is still in the group. The gate is in the
-- database, not in the UI.
--
-- POSITIONS are outline coordinates (chapter_index, chapter_fraction), as in
-- read_progress. chapter_fraction is `real`, the type read_progress uses, so a
-- note and a progress row at the same position compare equal.
--
-- SCHEDULE CHECKPOINTS. `group_reads.schedule` is null or an array of
-- { "chapter_index": int, "due_on": "YYYY-MM-DD" }. The app Route Handler
-- validates the shape; this file does not. The milestone trigger records
-- 'checkpoint:<chapter_index>' for a member who is at that chapter with
-- fraction >= 0.98, or past it, or who has finished the book. That rule MUST
-- match checkpointsReached() and milestonePoints() in src/lib/groups/outline.ts.
--
-- LEAVING. FEATURES_PLAN §5.6: notes are deleted when a member leaves or is
-- removed. An `after delete on group_members` trigger removes that user's notes
-- for the group's reads. It does nothing when the group itself is being deleted
-- (the cascade through group_reads removes the notes).
--
-- Run once: Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
-- Take a backup first (GROUPS_V1_BUILD L10). Down script:
-- supabase/rollback/0010_read_notes.down.sql (never run unless instructed).
--
-- Idempotency matches 0008/0009: `create table` is deliberately NOT
-- `if not exists`; re-running on a project that already has the table fails
-- there and the transaction rolls back cleanly. Indexes, functions, triggers
-- and policies are individually re-runnable (`if not exists`,
-- `create or replace`, `drop ... if exists` then `create`).

begin;

-- ===========================================================================
-- Tables
-- ===========================================================================

create table public.read_notes (
  id               uuid primary key default gen_random_uuid(),
  read_id          uuid not null references public.group_reads (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  chapter_index    int not null check (chapter_index >= 0),
  chapter_fraction real not null check (chapter_fraction between 0 and 1),
  kind             text not null check (kind in ('mark', 'note', 'highlight')),
  note             text check (char_length(note) between 1 and 500),
  -- Quotes are highlight-only (v2). FEATURES_PLAN §5.5: capped at 300 / 32.
  quote_exact      text check (char_length(quote_exact) <= 300),
  quote_prefix     text check (char_length(quote_prefix) <= 32),
  quote_suffix     text check (char_length(quote_suffix) <= 32),
  cfi              text check (char_length(cfi) <= 2000),
  content_sha256   text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at       timestamptz not null default now(),
  constraint read_notes_note_matches_kind check (
    (kind <> 'note' or note is not null)
    and (kind <> 'mark' or note is null)
  ),
  constraint read_notes_quote_only_highlight check (
    kind = 'highlight'
    or (quote_exact is null and quote_prefix is null and quote_suffix is null)
  )
);
create index if not exists read_notes_read_position_idx
  on public.read_notes (read_id, chapter_index, chapter_fraction);
create index if not exists read_notes_user_id_idx
  on public.read_notes (user_id);

-- ===========================================================================
-- Functions
-- ===========================================================================
-- Every function below sets `search_path = ''` and schema-qualifies every name
-- (same pattern as 0008/0009).

-- The caller's view of a read's notes. Empty unless the caller is a member of
-- the read's group. The caller's own notes are always returned. Another
-- member's note is returned only while that member is still in the group, and
-- only when the caller's read_progress row has finished_at set or sits at or
-- past the note's position. A caller with no progress row sees only their own.
create or replace function public.visible_notes(rid uuid)
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
  created_at       timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.read_id, n.user_id, n.chapter_index, n.chapter_fraction,
         n.kind, n.note, n.cfi, n.content_sha256, n.created_at
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

-- After delete on group_members: remove the departing user's notes for the
-- reads of that group. Fires for leaving, removal and the auth.users cascade.
-- When the delete is itself the cascade from `groups`, the group row is already
-- gone and the function returns (the cascade through group_reads removes the rows).
create or replace function public.remove_member_notes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.groups g where g.id = old.group_id;
  if not found then
    return null;
  end if;

  delete from public.read_notes x
   where x.user_id = old.user_id
     and x.read_id in (select r.id from public.group_reads r where r.group_id = old.group_id);

  return null;
end;
$$;

-- REPLACED (body extended, signature unchanged). Every 0009 rule is kept as it
-- was; the schedule branch is the only addition.
create or replace function public.record_read_milestones()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outline  jsonb;
  v_schedule jsonb;
  v_len      int;
begin
  select r.outline, r.schedule into v_outline, v_schedule
  from public.group_reads r
  where r.id = new.read_id;

  -- The read no longer exists: nothing to record.
  if not found then
    return null;
  end if;

  v_len := jsonb_array_length(v_outline);

  insert into public.read_milestones (read_id, user_id, point, reached_at)
  select new.read_id, new.user_id, pts.point, now()
  from (
    -- Each Part: reached at the first chapter index that carries it.
    select 'part:' || p.part_index as point
    from (
      select (e.value ->> 'partIndex')::numeric::int as part_index,
             min((e.value ->> 'index')::numeric::int) as first_index
      from jsonb_array_elements(v_outline) e
      where jsonb_typeof(e.value -> 'partIndex') = 'number'
      group by 1
    ) p
    where new.chapter_index >= p.first_index

    union all

    -- Same rule as milestonePoints() in src/lib/groups/outline.ts:
    -- floor(len / 2), and no half for a one-chapter book.
    select 'half'
    where v_len >= 2 and new.chapter_index >= v_len / 2

    union all

    select 'end'
    where (new.chapter_index = v_len - 1 and new.chapter_fraction >= 0.98)
       or new.finished_at is not null

    union all

    -- Schedule checkpoints (FEATURES_PLAN §5.8). A null or non-array schedule,
    -- and an entry whose chapter_index is not a number, records nothing.
    -- Same rule as checkpointsReached() and milestonePoints() in
    -- src/lib/groups/outline.ts: reached at the checkpoint chapter with fraction
    -- >= 0.98, or past that chapter, or when the book is finished.
    select 'checkpoint:' || c.checkpoint_index as point
    from (
      select (e.value ->> 'chapter_index')::numeric::int as checkpoint_index
      from jsonb_array_elements(
             case when jsonb_typeof(v_schedule) = 'array' then v_schedule else '[]'::jsonb end
           ) e
      where jsonb_typeof(e.value -> 'chapter_index') = 'number'
    ) c
    where new.chapter_index > c.checkpoint_index
       or (new.chapter_index = c.checkpoint_index and new.chapter_fraction >= 0.98)
       or new.finished_at is not null
  ) pts
  on conflict do nothing;

  return null;
end;
$$;

-- ===========================================================================
-- Triggers
-- ===========================================================================

-- Independent of 0008's group_members_transfer_ownership and 0009's
-- group_members_remove_read_data: none reads what another writes.
drop trigger if exists group_members_remove_notes on public.group_members;
create trigger group_members_remove_notes
  after delete on public.group_members
  for each row execute function public.remove_member_notes();

-- ===========================================================================
-- Function and table privileges
-- ===========================================================================
-- Same pattern as 0008/0009: strip PUBLIC and the Supabase default grants, then
-- grant back only what the client needs. service_role keeps its default grant.

revoke all on function public.remove_member_notes() from public, anon, authenticated;
revoke all on function public.visible_notes(uuid)   from public, anon;

grant execute on function public.visible_notes(uuid) to authenticated;

-- Notes are create and delete only: no update privilege at all.
revoke all on table public.read_notes from public, anon, authenticated;
grant select, insert, delete on table public.read_notes to authenticated;

-- ===========================================================================
-- Row-Level Security
-- ===========================================================================

alter table public.read_notes enable row level security;

-- Direct select is owner-only. Other members' notes are reachable only through
-- visible_notes(), which applies the spoiler gate.
drop policy if exists read_notes_select_own on public.read_notes;
create policy read_notes_select_own on public.read_notes
  for select to authenticated
  using (user_id = (select auth.uid()));

-- A member creates their own mark or note on a read they belong to. Highlights
-- and quotes are v2: the table admits them, this policy does not.
drop policy if exists read_notes_insert_own on public.read_notes;
create policy read_notes_insert_own on public.read_notes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_read_member(read_id)
    and kind in ('mark', 'note')
    and quote_exact is null
    and quote_prefix is null
    and quote_suffix is null
  );

drop policy if exists read_notes_delete_own on public.read_notes;
create policy read_notes_delete_own on public.read_notes
  for delete to authenticated
  using (user_id = (select auth.uid()));

commit;

-- ===========================================================================
-- Verify (read-only) — run after the migration; compare with the Expected line at the end.
-- ===========================================================================
-- select
--   (select count(*) from pg_tables
--      where schemaname = 'public'
--        and tablename = 'read_notes')                                         as tables_exist,
--   (select count(*) from pg_class
--      where oid = 'public.read_notes'::regclass
--        and relrowsecurity)                                                   as rls_enabled,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public'
--        and p.proname in ('visible_notes', 'remove_member_notes',
--                          'record_read_milestones'))                          as functions,
--   (select count(*) from pg_policies
--      where schemaname = 'public'
--        and tablename = 'read_notes')                                         as policies,
--   (select count(*) from pg_trigger
--      where tgname = 'group_members_remove_notes'
--        and not tgisinternal)                                                 as triggers;
-- Expected: tables_exist 1, rls_enabled 1, functions 3, policies 3, triggers 1.
