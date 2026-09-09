-- Leaf — 0006_two_themes.sql
--
-- Narrows the reading themes from {day, sepia, night} back to {day, night}.
-- 0004 widened the same two CHECK constraints to add sepia; this reverses it.
--
-- NARROWING is not symmetric with widening: rows can already hold 'sepia', and
-- a CHECK is validated against existing rows when it is added. So the data has
-- to move FIRST, then the constraint tightens. Doing it the other way round
-- fails with "check constraint is violated by some row" and leaves the schema
-- untouched.
--
-- 'sepia' folds to 'day', not 'night'. Sepia was a warm LIGHT paper
-- (--leaf-page #ede2cb) sitting a shade off day's #f1ebdc; sending a reader who
-- chose it to a near-black page would be a far larger change than the one they
-- are actually losing.
--
-- Run once: Supabase Dashboard -> SQL Editor -> paste -> Run. Safe to re-run.

-- 1. Move the data while the wider constraint still permits both values.
update public.profiles
  set default_theme = 'day'
  where default_theme = 'sepia';

update public.reader_settings
  set theme = 'day'
  where theme = 'sepia';

-- 2. Tighten. Drop-if-exists then re-add is how a CHECK is made idempotent —
--    Postgres has no `add constraint if not exists`.
alter table public.profiles
  drop constraint if exists profiles_default_theme_check;
alter table public.profiles
  add constraint profiles_default_theme_check
  check (default_theme in ('day', 'night'));

alter table public.reader_settings
  drop constraint if exists reader_settings_theme_check;
alter table public.reader_settings
  add constraint reader_settings_theme_check
  check (theme in ('day', 'night'));
