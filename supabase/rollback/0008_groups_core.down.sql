-- Leaf — 0008_groups_core.down.sql
--
-- NEVER RUN UNLESS INSTRUCTED. Reverses supabase/migrations/0008_groups_core.sql.
-- Every row in groups, group_members and group_invites is permanently lost.
-- Any later migration that references these tables (0009 and up) must be rolled
-- back first.
--
-- Tables are dropped first (their policies, triggers and indexes go with them),
-- then the functions the policies and triggers depended on.

begin;

drop table if exists public.group_invites;
drop table if exists public.group_members;
drop table if exists public.groups;

drop function if exists public.group_member_names(uuid);
drop function if exists public.is_member(uuid);
drop function if exists public.transfer_group_ownership();
drop function if exists public.enforce_group_member_cap();
drop function if exists public.group_member_cap();

commit;
