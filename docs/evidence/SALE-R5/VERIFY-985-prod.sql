-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It is one block between dollar quotes.
-- ====================================================================================================
-- VERIFY-985-prod -- PRODUCTION-SAFE verification of migration 985 (consented, floored learning-effectiveness analytics:
-- ckri_scholar_effectiveness_stats). SALE-2026-11 R5, SALE-15.
-- STRUCTURE ONLY. It writes nothing: no insert, update or delete, no ALTER, no DISABLE TRIGGER, no planted rows, no consent
-- touched. It reads the catalog and calls the read-only aggregate function, which returns only suppressed or floored cells.
-- Run it in the SQL editor after 985 is applied. It ALWAYS ends by raising, so even by accident nothing could be kept:
--   "VERIFY-985-prod PASS pass=N ..."  every check held
--   "VERIFY-985-prod FAIL ..."         the first check that did not hold
do $verify$
declare
  n int := 0;
  total int;
  shown int;
  d text;
begin
  if not coalesce((exists (select 1 from pg_proc where oid = to_regprocedure('public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)') and provolatile = 's' and prosecdef and 'search_path=public, pg_catalog' = any(proconfig))), false) then raise exception 'VERIFY-985-prod FAIL ckri_scholar_effectiveness_stats missing, not stable security definer, or search_path not pinned'; end if; n := n + 1;
  if not coalesce((has_function_privilege('service_role', 'public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)', 'execute')), false) then raise exception 'VERIFY-985-prod FAIL service_role cannot execute ckri_scholar_effectiveness_stats'; end if; n := n + 1;
  if not coalesce((not has_function_privilege('anon', 'public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)', 'execute') and not has_function_privilege('authenticated', 'public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)', 'execute')), false) then raise exception 'VERIFY-985-prod FAIL anon or authenticated can execute ckri_scholar_effectiveness_stats'; end if; n := n + 1;
  if not coalesce((not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)'::regprocedure and a.grantee = 0)), false) then raise exception 'VERIFY-985-prod FAIL PUBLIC can execute ckri_scholar_effectiveness_stats'; end if; n := n + 1;
  if not coalesce((pg_get_function_result('public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)'::regprocedure) = 'TABLE(measure text, arm text, cell_state text, learners integer, denominator integer, numerator integer, rate integer, value numeric)'), false) then raise exception 'VERIFY-985-prod FAIL result columns differ from 985'; end if; n := n + 1;
  d := pg_get_functiondef('public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)'::regprocedure);
  if not coalesce((position('greatest(5, coalesce(p_min, 10))' in d) > 0), false) then raise exception 'VERIFY-985-prod FAIL no cohort floor of at least 5'; end if; n := n + 1;
  if not coalesce((position('p.permission = ''collective_analytics'' and p.scope_key = ''all'' and p.status = ''granted''' in d) > 0), false) then raise exception 'VERIFY-985-prod FAIL no collective_analytics consent filter'; end if; n := n + 1;
  if not coalesce((position('a.user_id in (select user_id from pop)' in d) > 0 and position('r.user_id in (select user_id from pop)' in d) > 0 and position('e.user_id in (select user_id from pop)' in d) > 0 and position('s.user_id in (select user_id from pop)' in d) > 0), false) then raise exception 'VERIFY-985-prod FAIL a source is not limited to the consenting population'; end if; n := n + 1;
  if not coalesce((position('<> ''unmarked''' in d) > 0), false) then raise exception 'VERIFY-985-prod FAIL unmarked attempts are not separated'; end if; n := n + 1;
  if not coalesce((position('j.n_people < pr.floor_n' in d) > 0), false) then raise exception 'VERIFY-985-prod FAIL cells under the floor are not suppressed'; end if; n := n + 1;
  -- read-only calls: always the full catalogue, a floor asked below 5 is still 5, and nothing under it is shown
  select count(*) into total from ckri_scholar_effectiveness_stats(null, 10, 5);
  if total <> 15 then raise exception 'VERIFY-985-prod FAIL catalogue has % rows, want 15', total; end if; n := n + 1;
  if not coalesce((not exists (select 1 from ckri_scholar_effectiveness_stats(null, 1, 1) where (cell_state = 'reported' and learners < 5) or (cell_state <> 'reported' and (learners is not null or denominator is not null or numerator is not null or rate is not null or value is not null)))), true) then raise exception 'VERIFY-985-prod FAIL a cell under 5 learners is shown'; end if; n := n + 1;
  if exists (select 1 from ckri_scholar_effectiveness_stats(null, 10, 5) where cell_state not in ('reported', 'below_floor', 'none')) then raise exception 'VERIFY-985-prod FAIL unknown cell state'; end if; n := n + 1;
  select count(*) into shown from ckri_scholar_effectiveness_stats(null, 10, 5) where cell_state = 'reported';
  raise exception 'VERIFY-985-prod PASS pass=% (cells reported over the floor now: % of %)', n, shown, total;
end
$verify$;
