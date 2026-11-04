-- ROLLBACK-992: remove My Search History (SCHOLAR-SEARCH-HISTORY-01): the two functions and the table.
-- APPLY THIS FILE WHOLE (it holds a DO block).
-- Refuses while any history entry exists: they are the learner own records (their searches, pins and removals), and
-- removing them is an owner decision made by hand, never here. No other table is touched: saved teaching, lessons,
-- notes, attempts and materials are exactly as before.
do $$
begin
  if to_regclass('public.individual_scholar_search_history') is not null
     and exists (select 1 from individual_scholar_search_history) then
    raise exception 'ROLLBACK-992 refused: search history entries exist';
  end if;
end $$;

drop function if exists public.individual_scholar_search_history_clear(uuid);
drop function if exists public.individual_scholar_search_history_list(uuid, text, text, uuid, text, timestamptz, timestamptz, boolean, integer, integer);
drop table if exists individual_scholar_search_history;

notify pgrst, 'reload schema';
