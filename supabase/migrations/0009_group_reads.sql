-- Leaf — 0009_group_reads.sql
--
-- Reading groups, v1a reads (FEATURES_PLAN §5.3–5.8, GROUPS_V1_BUILD §3): group
-- reads, each member's private copy link, shared reading progress, and
-- milestones written by a trigger.
--
-- Requires 0008_groups_core.sql (groups, group_members).
--
-- ADDITIVE ONLY. Creates new tables, functions, triggers, policies and indexes.
-- It does not alter or drop any existing table, policy, function or storage
-- policy. The only object it attaches to an existing table is one new trigger
-- on `group_members` (independent of 0008's owner-transfer trigger).
--
-- EVERY FOREIGN KEY TO auth.users STATES ITS `on delete` ACTION. A default
-- `no action` key would block `auth.admin.deleteUser` (account deletion).
-- `group_reads.created_by` is `on delete set null` so a read outlives its
-- creator's account.
--
-- OUTLINE. `group_reads.outline` is a non-empty JSON array of labels only, in
-- reading order:
--   { "index": int, "label": text, "depth": int, "partIndex": int|null, "href": text }
-- It is written by the app; the milestone trigger reads `index` and
-- `partIndex` from it.
--
-- MILESTONE POINTS, computed by the trigger for the new progress position:
--   part:<n>  for each distinct non-null partIndex n; reached when
--             chapter_index >= the first `index` carrying that partIndex
--   half      reached when chapter_index >= floor((outline length - 1) / 2)
--   end       reached when chapter_index = outline length - 1 and
--             chapter_fraction >= 0.98, or when finished_at is not null
-- `read_milestones` is append-only: rows are inserted `on conflict do nothing`
-- and never updated or deleted by the trigger, so arrival order (reached_at) is
-- fixed even if a member later moves backwards. The only deletion is the
-- leave/removal cleanup below.
--
-- LEAVING. FEATURES_PLAN §5.6: progress is deleted on leave. An
-- `after delete on group_members` trigger removes the departing user's
-- progress, milestones and copy links for that group's reads. It does nothing
-- when the group itself is being deleted (the cascade removes everything).
--
-- WRITES: clients can read what their groups share and write only their own
-- progress and copy links. `group_reads` is created and deleted through Route
-- Handlers (service role). `read_milestones` has no client write policy at all.
--
-- Run once: Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
-- Take a backup first (GROUPS_V1_BUILD L10). Down script:
-- supabase/rollback/0009_group_reads.down.sql (never run unless instructed).
--
-- Idempotency matches 0001/0005/0008: `create table` is deliberately NOT
-- `if not exists`; re-running on a project that already has the tables fails
-- there and the transaction rolls back cleanly. Indexes, functions, triggers
-- and policies are individually re-runnable (`if not exists`,
-- `create or replace`, `drop ... if exists` then `create`).

begin;

-- ===========================================================================
-- Tables
-- ===========================================================================

create table public.group_reads (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 300),
  author     text not null default '',
  source     text not null check (source in ('standardebooks', 'gutenberg', 'upload')),
  source_ref text,
  -- Non-empty JSON array; entry shape documented in the header.
  outline    jsonb not null check (
    case
      when jsonb_typeof(outline) = 'array' then jsonb_array_length(outline) > 0
      else false
    end
  ),
  -- Reserved for v1b (checkpoints); v1a writes null.
  schedule   jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists group_reads_group_id_idx
  on public.group_reads (group_id);
create index if not exists group_reads_created_by_idx
  on public.group_reads (created_by);

-- A member's private link from their own book to the read. Owner-only.
create table public.read_copies (
  read_id        uuid not null references public.group_reads (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  book_id        uuid not null references public.books (id) on delete cascade,
  content_sha256 text,
  alignment      jsonb,
  primary key (read_id, user_id)
);
create index if not exists read_copies_user_id_idx
  on public.read_copies (user_id);
create index if not exists read_copies_book_id_idx
  on public.read_copies (book_id);

-- One position per (read, member), in outline coordinates.
create table public.read_progress (
  read_id          uuid not null references public.group_reads (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  chapter_index    int  not null default 0 check (chapter_index >= 0),
  chapter_fraction real not null default 0 check (chapter_fraction between 0 and 1),
  percent          real not null default 0 check (percent between 0 and 1),
  finished_at      timestamptz,
  manual           boolean not null default false,
  updated_at       timestamptz not null default now(),
  primary key (read_id, user_id)
);
create index if not exists read_progress_user_id_idx
  on public.read_progress (user_id);

-- Append-only record of who reached which point, and when. Trigger-written.
create table public.read_milestones (
  read_id    uuid not null references public.group_reads (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  point      text not null,
  reached_at timestamptz not null default now(),
  primary key (read_id, user_id, point)
);
create index if not exists read_milestones_user_id_idx
  on public.read_milestones (user_id);

-- ===========================================================================
-- Functions
-- ===========================================================================
-- Every function below sets `search_path = ''` and schema-qualifies every name
-- (same pattern as 0008).

-- True when the calling user (auth.uid()) belongs to the group that owns read
-- `rid`. security definer so it reads group_reads and group_members without
-- going through their RLS; that keeps the policies below free of recursion.
create or replace function public.is_read_member(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_reads r
    join public.group_members m on m.group_id = r.group_id
    where r.id = rid
      and m.user_id = (select auth.uid())
  );
$$;

-- After insert or update on read_progress: record every milestone point the
-- new position has reached. Writes only for NEW.user_id (membership was
-- checked by the read_progress insert policy). Append-only: existing
-- milestones are never touched, so going backwards removes nothing.
create or replace function public.record_read_milestones()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outline jsonb;
  v_len     int;
begin
  select r.outline into v_outline
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

    select 'half'
    where new.chapter_index >= (v_len - 1) / 2

    union all

    select 'end'
    where (new.chapter_index = v_len - 1 and new.chapter_fraction >= 0.98)
       or new.finished_at is not null
  ) pts
  on conflict do nothing;

  return null;
end;
$$;

-- After delete on group_members: remove the departing user's progress,
-- milestones and copy links for the reads of that group. Fires for leaving,
-- removal and the auth.users cascade. When the delete is itself the cascade
-- from `groups`, the group row is already gone and the function returns
-- (the cascade through group_reads removes the rows).
create or replace function public.remove_member_read_data()
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

  delete from public.read_milestones x
   where x.user_id = old.user_id
     and x.read_id in (select r.id from public.group_reads r where r.group_id = old.group_id);

  delete from public.read_progress x
   where x.user_id = old.user_id
     and x.read_id in (select r.id from public.group_reads r where r.group_id = old.group_id);

  delete from public.read_copies x
   where x.user_id = old.user_id
     and x.read_id in (select r.id from public.group_reads r where r.group_id = old.group_id);

  return null;
end;
$$;

-- ===========================================================================
-- Triggers
-- ===========================================================================

drop trigger if exists read_progress_record_milestones on public.read_progress;
create trigger read_progress_record_milestones
  after insert or update on public.read_progress
  for each row execute function public.record_read_milestones();

-- Independent of 0008's group_members_transfer_ownership: neither reads what
-- the other writes, so firing order does not matter.
drop trigger if exists group_members_remove_read_data on public.group_members;
create trigger group_members_remove_read_data
  after delete on public.group_members
  for each row execute function public.remove_member_read_data();

-- ===========================================================================
-- Function privileges
-- ===========================================================================
-- Same pattern as 0008: strip PUBLIC and the Supabase default grants, then
-- grant back only what the client needs. service_role keeps its default grant.

revoke all on function public.record_read_milestones() from public, anon, authenticated;
revoke all on function public.remove_member_read_data() from public, anon, authenticated;
revoke all on function public.is_read_member(uuid)      from public, anon;

grant execute on function public.is_read_member(uuid) to authenticated;

-- ===========================================================================
-- Row-Level Security
-- ===========================================================================

alter table public.group_reads     enable row level security;
alter table public.read_copies     enable row level security;
alter table public.read_progress   enable row level security;
alter table public.read_milestones enable row level security;

-- group_reads: members read; no client insert / update / delete (no such
-- policies). Create and delete go through Route Handlers.
drop policy if exists group_reads_select_member on public.group_reads;
create policy group_reads_select_member on public.group_reads
  for select to authenticated
  using (public.is_read_member(id));

-- read_copies: owner-only. Insert and update additionally require membership
-- of the read's group and a book the caller owns.
drop policy if exists read_copies_select_own on public.read_copies;
create policy read_copies_select_own on public.read_copies
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists read_copies_insert_own on public.read_copies;
create policy read_copies_insert_own on public.read_copies
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_read_member(read_id)
    and exists (
      select 1 from public.books b
      where b.id = book_id
        and b.user_id = (select auth.uid())
    )
  );

drop policy if exists read_copies_update_own on public.read_copies;
create policy read_copies_update_own on public.read_copies
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.is_read_member(read_id)
    and exists (
      select 1 from public.books b
      where b.id = book_id
        and b.user_id = (select auth.uid())
    )
  );

drop policy if exists read_copies_delete_own on public.read_copies;
create policy read_copies_delete_own on public.read_copies
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- read_progress: members read everyone's; a member writes only their own row.
-- No delete policy: rows go through cascades and the leave trigger.
drop policy if exists read_progress_select_member on public.read_progress;
create policy read_progress_select_member on public.read_progress
  for select to authenticated
  using (public.is_read_member(read_id));

drop policy if exists read_progress_insert_own on public.read_progress;
create policy read_progress_insert_own on public.read_progress
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_read_member(read_id)
  );

drop policy if exists read_progress_update_own on public.read_progress;
create policy read_progress_update_own on public.read_progress
  for update to authenticated
  using (user_id = (select auth.uid()) and public.is_read_member(read_id))
  with check (user_id = (select auth.uid()) and public.is_read_member(read_id));

-- read_milestones: members read; RLS on, deliberately NO write policies. Only
-- the trigger (security definer) and the service role can write.
drop policy if exists read_milestones_select_member on public.read_milestones;
create policy read_milestones_select_member on public.read_milestones
  for select to authenticated
  using (public.is_read_member(read_id));

commit;

-- ===========================================================================
-- Verify (read-only) — run after the migration; compare with the Expected line at the end.
-- ===========================================================================
-- select
--   (select count(*) from pg_tables
--      where schemaname = 'public'
--        and tablename in ('group_reads', 'read_copies', 'read_progress',
--                          'read_milestones'))                                 as tables_exist,
--   (select count(*) from pg_class
--      where oid in ('public.group_reads'::regclass, 'public.read_copies'::regclass,
--                    'public.read_progress'::regclass, 'public.read_milestones'::regclass)
--        and relrowsecurity)                                                   as rls_enabled,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public'
--        and p.proname in ('is_read_member', 'record_read_milestones',
--                          'remove_member_read_data'))                         as functions,
--   (select count(*) from pg_policies
--      where schemaname = 'public'
--        and tablename in ('group_reads', 'read_copies', 'read_progress',
--                          'read_milestones'))                                 as policies,
--   (select count(*) from pg_trigger
--      where tgname in ('read_progress_record_milestones',
--                       'group_members_remove_read_data')
--        and not tgisinternal)                                                 as triggers;
-- Expected: tables_exist 4, rls_enabled 4, functions 3, policies 9, triggers 2.
