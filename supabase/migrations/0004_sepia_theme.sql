-- Leaf — 0004_sepia_theme.sql
--
-- Adds 'sepia' as a third reading theme. Two inline CHECK constraints from 0001
-- reject it today: profiles.default_theme (the account default) and
-- reader_settings.theme (the live per-user setting). Both were created inline in
-- 0001, so Postgres auto-named them by its convention <table>_<column>_check:
-- profiles_default_theme_check and reader_settings_theme_check.
--
-- This only WIDENS the allowed set from {day, night} to {day, sepia, night}.
-- Every existing row already holds 'day' or 'night', so no row can violate the
-- new constraint and no data migration is needed.
--
-- Run once: Supabase Dashboard -> SQL Editor -> paste -> Run. Safe to re-run
-- (drop-if-exists then re-add is how a CHECK is made idempotent — Postgres has
-- no `add constraint if not exists`).

alter table public.profiles
  drop constraint if exists profiles_default_theme_check;
alter table public.profiles
  add constraint profiles_default_theme_check
  check (default_theme in ('day', 'sepia', 'night'));

alter table public.reader_settings
  drop constraint if exists reader_settings_theme_check;
alter table public.reader_settings
  add constraint reader_settings_theme_check
  check (theme in ('day', 'sepia', 'night'));
