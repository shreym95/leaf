-- Leaf — 0010_read_notes.down.sql
--
-- NEVER RUN UNLESS INSTRUCTED. Reverses supabase/migrations/0010_read_notes.sql.
-- Every row in read_notes is permanently lost: every page mark and note in
-- every reading group. Checkpoint rows already written to read_milestones
-- ('checkpoint:<n>') are left in place; 0009 has no rule for them.
-- Roll this back before 0009. Any later migration that references read_notes
-- must be rolled back first.
--
-- The trigger on group_members goes first (it belongs to an 0008 table), then
-- the table (its policies and indexes go with it), then the functions. The
-- record_read_milestones() body is restored to its exact 0009 text.

begin;

drop trigger if exists group_members_remove_notes on public.group_members;

drop table if exists public.read_notes;

drop function if exists public.remove_member_notes();
drop function if exists public.visible_notes(uuid);

-- Restore record_read_milestones() to its 0009 body (copied from 0009, not retyped).
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

    -- Same rule as milestonePoints() in src/lib/groups/outline.ts:
    -- floor(len / 2), and no half for a one-chapter book.
    select 'half'
    where v_len >= 2 and new.chapter_index >= v_len / 2

    union all

    select 'end'
    where (new.chapter_index = v_len - 1 and new.chapter_fraction >= 0.98)
       or new.finished_at is not null
  ) pts
  on conflict do nothing;

  return null;
end;
$$;

commit;
