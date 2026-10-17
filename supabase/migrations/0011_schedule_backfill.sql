-- Leaf — 0011_schedule_backfill.sql
--
-- Reading groups, v1b QA fixes (FEATURES_PLAN §5.5, §5.8, GROUPS_V1_BUILD §3):
--   1. Setting or editing a schedule records checkpoint milestones at once for
--      members already past a checkpoint, instead of on their next progress write.
--   2. A note's chapter_index must lie inside the read's outline.
--
-- Requires 0008_groups_core.sql, 0009_group_reads.sql (group_reads, read_progress,
-- read_milestones) and 0010_read_notes.sql (read_notes, read_notes_insert_own).
--
-- ADDITIVE, with one replacement. Creates one function and one trigger on
-- `group_reads`. It replaces one policy, `read_notes_insert_own` (drop, then
-- create under the same name), and changes nothing else: every condition of that
-- policy other than the chapter bound is identical to 0010. No existing table,
-- function, trigger or grant is altered.
--
-- BACKFILL RULE. For each `read_progress` row of the changed read, the trigger
-- records 'checkpoint:<ci>' for every checkpoint the member has reached. The
-- condition is the one 0010 applies on a progress write, copied exactly:
--   p.chapter_index > ci
--   OR (p.chapter_index = ci AND p.chapter_fraction >= 0.98)
--   OR p.finished_at IS NOT NULL
-- A null or non-array schedule records nothing. An entry whose chapter_index is
-- not a JSON number is skipped. Rows are inserted `on conflict do nothing`.
--
-- APPEND-ONLY. The trigger never deletes or updates a milestone. Clearing a
-- schedule, or removing one checkpoint from it, leaves the rows already written.
--
-- reached_at = p.updated_at (the member's progress row). It is not now(), because
-- a backfill is not the moment the member got there. The best known time of
-- arrival is when their recorded position was set, so backfilled members keep
-- their arrival order. This is a deliberate choice.
--
-- TRIGGER WHEN CLAUSE. Fires only on `update of schedule` with
-- `new.schedule is distinct from old.schedule`, so a no-op save does no work.
--
-- Run once: Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
-- Take a backup first (GROUPS_V1_BUILD L10). Down script:
-- supabase/rollback/0011_schedule_backfill.down.sql (never run unless instructed).
--
-- Idempotency: the function, trigger and policy are individually re-runnable
-- (`create or replace`, `drop ... if exists` then `create`).

begin;

-- ===========================================================================
-- Functions
-- ===========================================================================
-- Sets `search_path = ''` and schema-qualifies every name (same pattern as 0008-0010).

-- After update of schedule on group_reads: record each checkpoint that every
-- existing member of this read has already reached. Same rule as
-- record_read_milestones() in 0010 (the schedule branch), applied to the rows
-- that already exist instead of to one new progress write.
create or replace function public.backfill_checkpoint_milestones()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Null, object or scalar schedule: nothing to record.
  if jsonb_typeof(new.schedule) is distinct from 'array' then
    return null;
  end if;

  insert into public.read_milestones (read_id, user_id, point, reached_at)
  select p.read_id, p.user_id, 'checkpoint:' || c.checkpoint_index, p.updated_at
  from public.read_progress p
  cross join lateral (
    select (e.value ->> 'chapter_index')::numeric::int as checkpoint_index
    from jsonb_array_elements(new.schedule) e
    where jsonb_typeof(e.value -> 'chapter_index') = 'number'
  ) c
  where p.read_id = new.id
    and (
      p.chapter_index > c.checkpoint_index
      or (p.chapter_index = c.checkpoint_index and p.chapter_fraction >= 0.98)
      or p.finished_at is not null
    )
  on conflict do nothing;

  return null;
end;
$$;

-- ===========================================================================
-- Triggers
-- ===========================================================================

drop trigger if exists group_reads_backfill_checkpoints on public.group_reads;
create trigger group_reads_backfill_checkpoints
  after update of schedule on public.group_reads
  for each row
  when (new.schedule is distinct from old.schedule)
  execute function public.backfill_checkpoint_milestones();

-- ===========================================================================
-- Function privileges
-- ===========================================================================
-- Same pattern as 0009/0010: a trigger function is never called by a client.

revoke all on function public.backfill_checkpoint_milestones() from public, anon, authenticated;

-- ===========================================================================
-- Row-Level Security: note chapter bound
-- ===========================================================================
-- Replaces 0010's read_notes_insert_own. The only addition is the chapter bound.
-- `read_id` in the subquery resolves to read_notes.read_id (group_reads has no
-- column of that name). A read that does not exist yields NULL and the check fails.

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
    and kind in ('mark', 'note')
    and quote_exact is null
    and quote_prefix is null
    and quote_suffix is null
  );

commit;

-- ===========================================================================
-- Verify (read-only) — run after the migration; compare with the Expected line at the end.
-- ===========================================================================
-- select
--   (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public'
--        and p.proname = 'backfill_checkpoint_milestones')                    as functions,
--   (select count(*) from pg_trigger
--      where tgname = 'group_reads_backfill_checkpoints'
--        and not tgisinternal)                                                 as triggers,
--   (select count(*) from pg_policies
--      where schemaname = 'public'
--        and tablename = 'read_notes'
--        and policyname = 'read_notes_insert_own')                             as insert_policies;
-- Expected: functions 1, triggers 1, insert_policies 1.
