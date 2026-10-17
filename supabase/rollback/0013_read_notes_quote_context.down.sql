-- Rollback for 0013: restore read_notes_insert_own exactly as 0012 wrote it.

begin;

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
    and kind in ('mark', 'note', 'highlight')
    and (kind = 'highlight') = (quote_exact is not null)
    and (
      annotation_id is null
      or exists (
        select 1
        from public.annotations a
        where a.id = read_notes.annotation_id
          and a.user_id = (select auth.uid())
          -- The shared copy's kind follows its source: a range is shared as a
          -- highlight, a page as a mark or note. The note sync trigger relies on it.
          and (a.kind = 'range') = (read_notes.kind = 'highlight')
      )
    )
  );

commit;
