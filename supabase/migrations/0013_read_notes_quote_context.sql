-- 0013: restore the 0010 rule that only a highlight may carry quote context.
--
-- 0012 replaced read_notes_insert_own and kept the quote_exact rule, but dropped the
-- policy check on quote_prefix / quote_suffix. A mark or note carrying a prefix or
-- suffix was still refused, by the read_notes table check (23514), not the policy
-- (42501). This puts the refusal back in the policy, where 0010 had it.
-- Everything else in the policy is the 0012 text, unchanged.
--
-- Rollback: supabase/rollback/0013_read_notes_quote_context.down.sql (restores 0012's policy).

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
    and (kind = 'highlight' or (quote_prefix is null and quote_suffix is null))
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
