-- ====================================================================================================
-- VERIFY 426 (COMPETEN-SCHOLAR-EVALUATION-01). Read-only. Run after applying 426, on STAGING.
-- Expected: 17 columns, the check and the two foreign keys, RLS on with one own-row read policy, the trigger
-- before update only, and 0 rows (a new table).
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

select count(*) as columns from information_schema.columns
 where table_schema = 'public' and table_name = 'individual_scholar_evaluation';

select conname, contype from pg_constraint
 where conrelid = 'public.individual_scholar_evaluation'::regclass order by conname;

select relname, relrowsecurity from pg_class where relname = 'individual_scholar_evaluation';

select policyname, cmd from pg_policies where tablename = 'individual_scholar_evaluation';

select tgname, pg_get_triggerdef(oid) as def from pg_trigger
 where tgrelid = 'public.individual_scholar_evaluation'::regclass and not tgisinternal;

select count(*) as rows from individual_scholar_evaluation;
