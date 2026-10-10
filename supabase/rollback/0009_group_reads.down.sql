-- Leaf — 0009_group_reads.down.sql
--
-- NEVER RUN UNLESS INSTRUCTED. Reverses supabase/migrations/0009_group_reads.sql.
-- Every row in group_reads, read_copies, read_progress and read_milestones is
-- permanently lost. Any later migration that references these tables (0010 and
-- up) must be rolled back first. Roll this back before 0008.
--
-- The trigger on group_members goes first (it belongs to an 0008 table), then
-- the tables (their policies, triggers and indexes go with them), then the
-- functions the policies and triggers depended on.

begin;

drop trigger if exists group_members_remove_read_data on public.group_members;

drop table if exists public.read_milestones;
drop table if exists public.read_progress;
drop table if exists public.read_copies;
drop table if exists public.group_reads;

drop function if exists public.remove_member_read_data();
drop function if exists public.record_read_milestones();
drop function if exists public.is_read_member(uuid);

commit;
