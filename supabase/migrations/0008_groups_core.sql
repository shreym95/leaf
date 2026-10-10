-- Leaf — 0008_groups_core.sql
--
-- Reading groups, v1a core (FEATURES_PLAN §5, GROUPS_V1_BUILD §3): groups,
-- membership, invites, the membership helper functions, the size cap and the
-- owner-transfer trigger.
--
-- ADDITIVE ONLY. Creates new tables, functions, triggers, policies and indexes.
-- It does not alter or drop any existing table, policy, function or storage
-- policy. `profiles` RLS is untouched: members see each other's display names
-- only through `group_member_names()`.
--
-- OWNERSHIP IS A ROLE, NOT A COLUMN. There is no `owner_id` on `groups`. The
-- owner is the `group_members` row with role 'owner' (one per group, enforced
-- by a partial unique index). No foreign key can therefore block the owner's
-- account deletion or take the group down with it.
--
-- EVERY FOREIGN KEY TO auth.users STATES ITS `on delete` ACTION. A default
-- `no action` key would block `auth.admin.deleteUser` (account deletion).
--
-- WRITES: clients can only read their groups and members, and delete their own
-- membership (leave). Create, rename, join, invite and remove go through Route
-- Handlers with the service role. `group_invites` has no client access at all.
--
-- Run once: Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
-- Take a backup first (GROUPS_V1_BUILD L10). Down script:
-- supabase/rollback/0008_groups_core.down.sql (never run unless instructed).
--
-- Idempotency matches 0001/0005: `create table` is deliberately NOT
-- `if not exists`; re-running on a project that already has the tables fails
-- there and the transaction rolls back cleanly. Indexes, functions, triggers
-- and policies are individually re-runnable (`if not exists`,
-- `create or replace`, `drop ... if exists` then `create`).

begin;

-- ===========================================================================
-- Tables
-- ===========================================================================

create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- Exactly one owner per group.
create unique index if not exists group_members_one_owner_idx
  on public.group_members (group_id) where role = 'owner';
-- Account deletion cascades by user_id.
create index if not exists group_members_user_id_idx
  on public.group_members (user_id);

create table public.group_invites (
  -- url-safe token from >= 32 random bytes (base64url is 43 chars).
  token      text primary key check (char_length(token) >= 43),
  group_id   uuid not null references public.groups (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  max_uses   int not null check (max_uses >= 1),
  uses       int not null default 0 check (uses >= 0)
);
create index if not exists group_invites_group_id_idx
  on public.group_invites (group_id);
create index if not exists group_invites_created_by_idx
  on public.group_invites (created_by);

-- ===========================================================================
-- Functions
-- ===========================================================================
-- Every function below sets `search_path = ''` and schema-qualifies every name
-- (Supabase hardening guidance; same pattern as handle_new_user in 0001).

-- Single source of the member cap. Raising it later is a one-line migration.
create or replace function public.group_member_cap()
returns int
language sql
stable
set search_path = ''
as $$
  select 5;
$$;

-- True when the calling user (auth.uid()) belongs to group `gid`. security
-- definer so it reads group_members without going through that table's RLS,
-- which is what keeps the group_members select policy from recursing.
create or replace function public.is_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members m
    where m.group_id = gid
      and m.user_id = (select auth.uid())
  );
$$;

-- Member list with display names. Returns no rows unless the caller is a
-- member of `gid`. Reads public.profiles as definer so profiles RLS (owner-only)
-- stays untouched.
create or replace function public.group_member_names(gid uuid)
returns table (
  user_id      uuid,
  display_name text,
  role         text,
  joined_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, p.display_name, m.role, m.joined_at
  from public.group_members m
  left join public.profiles p on p.id = m.user_id
  where m.group_id = gid
    and public.is_member(gid)
  order by m.joined_at, m.user_id;
$$;

-- Before insert on group_members: reject a member beyond the cap. The group
-- row is locked first so two simultaneous joins serialise and cannot both pass
-- the count.
create or replace function public.enforce_group_member_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.groups g where g.id = new.group_id for update;

  if (
    select count(*) from public.group_members m where m.group_id = new.group_id
  ) >= public.group_member_cap() then
    raise exception 'group is full (max % members)', public.group_member_cap()
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- After delete on group_members: if the owner's row went, promote the member
-- with the earliest joined_at (tie-break user_id); if nobody is left, delete
-- the group. Fires for leaving, removal and the auth.users cascade.
--
-- When the delete is itself the cascade from `groups`, the group row is
-- already gone: the lock below finds nothing and the function returns, so
-- there is no error and no loop.
create or replace function public.transfer_group_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_owner uuid;
begin
  if old.role <> 'owner' then
    return null;
  end if;

  -- Serialises concurrent leaves; no row means the group is being deleted.
  perform 1 from public.groups g where g.id = old.group_id for update;
  if not found then
    return null;
  end if;

  select m.user_id into next_owner
  from public.group_members m
  where m.group_id = old.group_id
  order by m.joined_at, m.user_id
  limit 1;

  if next_owner is null then
    delete from public.groups g where g.id = old.group_id;
  else
    update public.group_members m
       set role = 'owner'
     where m.group_id = old.group_id
       and m.user_id = next_owner;
  end if;

  return null;
end;
$$;

-- ===========================================================================
-- Triggers
-- ===========================================================================

drop trigger if exists group_members_enforce_cap on public.group_members;
create trigger group_members_enforce_cap
  before insert on public.group_members
  for each row execute function public.enforce_group_member_cap();

drop trigger if exists group_members_transfer_ownership on public.group_members;
create trigger group_members_transfer_ownership
  after delete on public.group_members
  for each row execute function public.transfer_group_ownership();

-- ===========================================================================
-- Function privileges
-- ===========================================================================
-- Postgres grants execute to PUBLIC on new functions and Supabase adds
-- anon/authenticated through default privileges: strip both, then grant back
-- only what the client needs. service_role keeps its default grant.

revoke all on function public.group_member_cap()          from public, anon, authenticated;
revoke all on function public.enforce_group_member_cap()  from public, anon, authenticated;
revoke all on function public.transfer_group_ownership()  from public, anon, authenticated;
revoke all on function public.is_member(uuid)             from public, anon;
revoke all on function public.group_member_names(uuid)    from public, anon;

grant execute on function public.is_member(uuid)          to authenticated;
grant execute on function public.group_member_names(uuid) to authenticated;

-- ===========================================================================
-- Row-Level Security
-- ===========================================================================

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;

-- groups: members read; no client insert / update / delete (no such policies).
drop policy if exists groups_select_member on public.groups;
create policy groups_select_member on public.groups
  for select to authenticated
  using (public.is_member(id));

-- group_members: members read the roster; a user may delete only their own
-- row (leave). No client insert or update (no such policies).
drop policy if exists group_members_select_member on public.group_members;
create policy group_members_select_member on public.group_members
  for select to authenticated
  using (public.is_member(group_id));

drop policy if exists group_members_delete_own on public.group_members;
create policy group_members_delete_own on public.group_members
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- group_invites: RLS on, deliberately NO policies. Only the service role
-- (Route Handlers) can read or write invites.

commit;

-- ===========================================================================
-- Verify (read-only) — run after the migration; compare with the Expected line at the end.
-- ===========================================================================
-- select
--   (select count(*) from pg_tables
--      where schemaname = 'public'
--        and tablename in ('groups', 'group_members', 'group_invites'))      as tables_exist,
--   (select count(*) from pg_class
--      where oid in ('public.groups'::regclass, 'public.group_members'::regclass,
--                    'public.group_invites'::regclass)
--        and relrowsecurity)                                                as rls_enabled,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public'
--        and p.proname in ('is_member', 'group_member_names', 'group_member_cap',
--                          'enforce_group_member_cap', 'transfer_group_ownership')) as functions,
--   (select count(*) from pg_policies
--      where schemaname = 'public'
--        and tablename in ('groups', 'group_members', 'group_invites'))      as policies,
--   (select count(*) from pg_trigger
--      where tgrelid = 'public.group_members'::regclass
--        and tgname in ('group_members_enforce_cap',
--                       'group_members_transfer_ownership'))                as triggers;
-- Expected: tables_exist 3, rls_enabled 3, functions 5, policies 3, triggers 2.
