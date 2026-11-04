-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It is one block between dollar quotes.
-- ====================================================================================================
-- VERIFY-986-prod -- PRODUCTION-SAFE verification of migrations 985 and 986 (consented, floored learning-effectiveness
-- analytics: ckri_scholar_effectiveness_stats, with transfer read from the R2 transfer checks of 970 when present).
-- SALE-2026-11 R5, SALE-15. Run after 986. It supersedes VERIFY-985-prod, which expects the 985 cell states only.
-- STRUCTURE ONLY. It writes nothing: no insert, update or delete, no ALTER, no DISABLE TRIGGER, no planted rows, no consent
-- touched. It reads the catalog and calls the read-only aggregate function, which returns only suppressed or floored cells.
-- Run it in the SQL editor after 986 is applied. It ALWAYS ends by raising, so even by accident nothing could be kept:
--   "VERIFY-986-prod PASS pass=N ..."  every check held
--   "VERIFY-986-prod FAIL ..."         the first check that did not hold
do $verify$
declare
  n int := 0;
  total int;
  shown int;
  d text;
begin
  if not coalesce((exists (select 1 from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = to_regprocedure('public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)') and l.lanname = 'plpgsql' and p.provolatile = 's' and p.prosecdef and 'search_path=public, pg_catalog' = any(p.proconfig))), false) then raise exception 'VERIFY-986-prod FAIL ckri_scholar_effectiveness_stats missing, not the 986 plpgsql version, not stable security definer, or search_path not pinned'; end if; n := n + 1;
  if not coalesce((has_function_privilege('service_role', 'public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)', 'execute')), false) then raise exception 'VERIFY-986-prod FAIL service_role cannot execute ckri_scholar_effectiveness_stats'; end if; n := n + 1;
  if not coalesce((not has_function_privilege('anon', 'public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)', 'execute') and not has_function_privilege('authenticated', 'public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)', 'execute')), false) then raise exception 'VERIFY-986-prod FAIL anon or authenticated can execute ckri_scholar_effectiveness_stats'; end if; n := n + 1;
  if not coalesce((not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)'::regprocedure and a.grantee = 0)), false) then raise exception 'VERIFY-986-prod FAIL PUBLIC can execute ckri_scholar_effectiveness_stats'; end if; n := n + 1;
  if not coalesce((pg_get_function_result('public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)'::regprocedure) = 'TABLE(measure text, arm text, cell_state text, learners integer, denominator integer, numerator integer, rate integer, value numeric)'), false) then raise exception 'VERIFY-986-prod FAIL result columns differ from 985'; end if; n := n + 1;
  d := pg_get_functiondef('public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)'::regprocedure);
  if not coalesce((position('greatest(5, coalesce(p_min, 10))' in d) > 0), false) then raise exception 'VERIFY-986-prod FAIL no cohort floor of at least 5'; end if; n := n + 1;
  if not coalesce((position('p.permission = ''collective_analytics'' and p.scope_key = ''all'' and p.status = ''granted''' in d) > 0), false) then raise exception 'VERIFY-986-prod FAIL no collective_analytics consent filter'; end if; n := n + 1;
  if not coalesce((position('a.user_id in (select user_id from pop)' in d) > 0 and position('r.user_id in (select user_id from pop)' in d) > 0 and position('e.user_id in (select user_id from pop)' in d) > 0 and position('s.user_id in (select user_id from pop)' in d) > 0), false) then raise exception 'VERIFY-986-prod FAIL a source is not limited to the consenting population'; end if; n := n + 1;
  if not coalesce((position('join individual_scholar_transfer_check t' in d) > 0 and position('coalesce(a.score >= 0.75, a.correct)' in d) > 0 and position('to_regclass(''public.individual_scholar_transfer_check'') is not null' in d) > 0), false) then raise exception 'VERIFY-986-prod FAIL transfer is not read from the 970 join with the 0.75 rule and a presence check'; end if; n := n + 1;
  if not coalesce((position('a.user_id in (select p.user_id from ckri_participation p' in d) > 0), false) then raise exception 'VERIFY-986-prod FAIL the transfer read is not limited to the consenting population'; end if; n := n + 1;
  if not coalesce((position('''not_measured''' in d) > 0), false) then raise exception 'VERIFY-986-prod FAIL no not_measured state for transfer'; end if; n := n + 1;
  if not coalesce((position('<> ''unmarked''' in d) > 0), false) then raise exception 'VERIFY-986-prod FAIL unmarked attempts are not separated'; end if; n := n + 1;
  if not coalesce((position('j.n_people < pr.floor_n' in d) > 0), false) then raise exception 'VERIFY-986-prod FAIL cells under the floor are not suppressed'; end if; n := n + 1;
  -- read-only calls: always the full catalogue, a floor asked below 5 is still 5, and nothing under it is shown
  select count(*) into total from ckri_scholar_effectiveness_stats(null, 10, 5);
  if total <> 15 then raise exception 'VERIFY-986-prod FAIL catalogue has % rows, want 15', total; end if; n := n + 1;
  if not coalesce((not exists (select 1 from ckri_scholar_effectiveness_stats(null, 1, 1) where (cell_state = 'reported' and learners < 5) or (cell_state <> 'reported' and (learners is not null or denominator is not null or numerator is not null or rate is not null or value is not null)))), true) then raise exception 'VERIFY-986-prod FAIL a cell under 5 learners is shown'; end if; n := n + 1;
  if exists (select 1 from ckri_scholar_effectiveness_stats(null, 10, 5) where measure = 'transfer' and ((to_regclass('public.individual_scholar_transfer_check') is null) <> (cell_state = 'not_measured'))) then raise exception 'VERIFY-986-prod FAIL transfer state does not follow the presence of 970'; end if; n := n + 1;
  if exists (select 1 from ckri_scholar_effectiveness_stats(null, 10, 5) where cell_state not in ('reported', 'below_floor', 'none', 'not_measured') or (cell_state = 'not_measured' and measure <> 'transfer')) then raise exception 'VERIFY-986-prod FAIL unknown cell state'; end if; n := n + 1;
  select count(*) into shown from ckri_scholar_effectiveness_stats(null, 10, 5) where cell_state = 'reported';
  raise exception 'VERIFY-986-prod PASS pass=% (cells reported over the floor now: % of %)', n, shown, total;
end
$verify$;
