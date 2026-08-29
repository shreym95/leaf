-- Leaf — 0001_init.sql — canonical schema (SPEC §5, RLS per §3.3).
--
-- RUN ONCE against a fresh Supabase project:
--   Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
-- See supabase/README.md.
--
-- Idempotency: the DDL below is wrapped in a single transaction and is
-- primarily intended to run once. Re-runnable parts use `create or replace`,
-- `drop ... if exists`, `create index if not exists`, and `on conflict do
-- nothing`. `create table` is deliberately NOT `if not exists` (it cannot carry
-- the constraints); re-running on a populated project will fail the table
-- creation and roll back — that is intentional.

begin;

-- ===========================================================================
-- Tables
-- ===========================================================================

-- profiles ------------------------------------------------------------------
-- One row per auth user. Keyed by the auth uid (no separate id column).
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  default_theme text not null default 'night' check (default_theme in ('day', 'night')),
  created_at    timestamptz not null default now()
);

-- books --------------------------------------------------------------------
create table public.books (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null,
  author       text not null default '',
  -- SPEC §5 / §6: only these three origins ever exist. Tightened to NOT NULL
  -- (see NOTE 1) — every insert path (import + upload) sets it.
  source       text not null check (source in ('standardebooks', 'gutenberg', 'upload')),
  source_ref   text,
  storage_path text,
  cover_url    text,
  status       text not null default 'reading' check (status in ('reading', 'finished')),
  added_at     timestamptz not null default now()
);
create index if not exists books_user_id_idx on public.books (user_id);

-- reading_state ----------------------------------------------------------
-- One position per (book, user). epub.js CFI + 0..1 progress.
create table public.reading_state (
  book_id    uuid not null references public.books (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  cfi        text,
  percent    real not null default 0,
  updated_at timestamptz not null default now(),
  primary key (book_id, user_id)
);

-- highlights ------------------------------------------------------------
create table public.highlights (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references public.books (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  cfi_range  text not null,
  text       text not null,
  color      text not null default 'copper',
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists highlights_book_id_idx on public.highlights (book_id);

-- reader_settings ------------------------------------------------------
-- One row per user. All columns tightened to NOT NULL (see NOTE 2): every
-- column has a default and the signup trigger seeds the row, so a NULL is
-- always a bug. Matches the hand-written ReaderSettings type.
create table public.reader_settings (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  font_family  text not null default 'serif'  check (font_family in ('serif', 'sans', 'legible')),
  font_size    real not null default 1.06,
  line_spacing real not null default 1.62,
  margins      text not null default 'normal' check (margins in ('narrow', 'normal', 'wide')),
  theme        text not null default 'night'  check (theme in ('day', 'night'))
);

-- ===========================================================================
-- Row-Level Security — owner-only on all five tables (SPEC §3.3 / §5)
-- ===========================================================================

alter table public.profiles        enable row level security;
alter table public.books           enable row level security;
alter table public.reading_state   enable row level security;
alter table public.highlights      enable row level security;
alter table public.reader_settings enable row level security;

-- profiles: separate select / insert / update (no delete — cascades from
-- auth.users). Match on the primary key, which IS the auth uid.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- books / reading_state / highlights / reader_settings: full owner access.
drop policy if exists books_owner_all on public.books;
create policy books_owner_all on public.books
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists reading_state_owner_all on public.reading_state;
create policy reading_state_owner_all on public.reading_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists highlights_owner_all on public.highlights;
create policy highlights_owner_all on public.highlights
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists reader_settings_owner_all on public.reader_settings;
create policy reader_settings_owner_all on public.reader_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ===========================================================================
-- Signup trigger — seed profiles + reader_settings on new auth user
-- ===========================================================================
-- security definer + empty search_path (Supabase hardening guidance): every
-- object reference below is fully schema-qualified.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    )
  )
  on conflict (id) do nothing;

  insert into public.reader_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================================================
-- Storage — private per-user bucket for uploaded / cached EPUBs
-- ===========================================================================
-- Object key convention: "<auth-uid>/<filename>.epub" — the first path segment
-- is the owner. RLS is already enabled on storage.objects by Supabase.

insert into storage.buckets (id, name, public)
values ('epubs', 'epubs', false)
on conflict (id) do nothing;

drop policy if exists epubs_select_own on storage.objects;
create policy epubs_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'epubs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists epubs_insert_own on storage.objects;
create policy epubs_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'epubs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists epubs_delete_own on storage.objects;
create policy epubs_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'epubs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;

-- ===========================================================================
-- NOTES — schema decisions changed from the build-brief DDL
-- ===========================================================================
-- NOTE 1  books.source: brief had it nullable. Made NOT NULL. Both write paths
--         (server import, user upload) always know the origin, and the
--         hand-written Book type already models it as non-null. No default is
--         given so a wrong call fails loudly rather than silently picking one.
-- NOTE 2  reader_settings.*: brief left every column nullable (default only).
--         Made all NOT NULL. Each has a default and the signup trigger seeds
--         the row, so NULL would only ever be a bug; this also matches the
--         ReaderSettings type, which has no nullable fields.
-- NOTE 3  books.status: made NOT NULL (default 'reading'). Same reasoning —
--         always present, defaulted, non-null in the type.
-- Everything else follows the brief exactly (column names unchanged).
