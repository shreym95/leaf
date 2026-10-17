-- Leaf — 0012_annotations.down.sql
--
-- NEVER RUN UNLESS INSTRUCTED. Reverses supabase/migrations/0012_annotations.sql.
-- Every row in `annotations` is permanently lost, including personal items
-- created after the release. `bookmarks` and `highlights` were never changed,
-- so the legacy data is intact (NOTES_PLAN N3). Group copies in `read_notes`
-- stay as rows; only their link to a personal item is removed.
--
-- Order: the read_notes insert policy goes back first (it refers to
-- annotation_id), then the link column, then visible_notes, then the functions
-- and the table. The insert policy and visible_notes are restored to their
-- exact 0011 and 0010 text (copied, not retyped).

begin;

-- Restore read_notes_insert_own to its 0011 definition (chapter bound kept).
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

-- Triggers on annotations go first (the table drop would also remove them).
drop trigger if exists annotations_sync_read_notes on public.annotations;
drop trigger if exists annotations_touch_updated_at on public.annotations;

-- The share link.
drop index if exists public.read_notes_annotation_read_uidx;
alter table public.read_notes drop column if exists annotation_id;

-- Restore visible_notes to its 0010 signature and body (copied from 0010).
drop function if exists public.visible_notes(uuid);
create function public.visible_notes(rid uuid)
returns table (
  id               uuid,
  read_id          uuid,
  user_id          uuid,
  chapter_index    int,
  chapter_fraction real,
  kind             text,
  note             text,
  cfi              text,
  content_sha256   text,
  created_at       timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.read_id, n.user_id, n.chapter_index, n.chapter_fraction,
         n.kind, n.note, n.cfi, n.content_sha256, n.created_at
  from public.read_notes n
  where n.read_id = rid
    and public.is_read_member(rid)
    and (
      n.user_id = (select auth.uid())
      or (
        exists (
          select 1
          from public.group_reads r
          join public.group_members m on m.group_id = r.group_id
          where r.id = rid
            and m.user_id = n.user_id
        )
        and exists (
          select 1
          from public.read_progress p
          where p.read_id = rid
            and p.user_id = (select auth.uid())
            and (
              p.finished_at is not null
              or (n.chapter_index, n.chapter_fraction)
                 <= (p.chapter_index, p.chapter_fraction)
            )
        )
      )
    )
  order by n.chapter_index, n.chapter_fraction, n.created_at;
$$;

revoke all on function public.visible_notes(uuid) from public, anon;
grant execute on function public.visible_notes(uuid) to authenticated;

drop function if exists public.sync_read_notes_from_annotation();
drop function if exists public.touch_annotation_updated_at();
drop function if exists public.copy_legacy_annotations();

drop table if exists public.annotations;

commit;
