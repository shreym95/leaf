-- Leaf — 0011_schedule_backfill.down.sql
--
-- NEVER RUN UNLESS INSTRUCTED. Reverses supabase/migrations/0011_schedule_backfill.sql.
-- Checkpoint rows already backfilled into read_milestones ('checkpoint:<n>') are
-- left in place, as 0010's down script leaves them. Nothing is deleted from
-- read_notes or read_progress.
--
-- The trigger goes first (it belongs to a 0009 table), then the function. The
-- read_notes_insert_own policy is restored to its exact 0010 text (copied from
-- 0010, not retyped), without the chapter bound.

begin;

drop trigger if exists group_reads_backfill_checkpoints on public.group_reads;

drop function if exists public.backfill_checkpoint_milestones();

-- Restore read_notes_insert_own to its 0010 definition.
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

commit;
