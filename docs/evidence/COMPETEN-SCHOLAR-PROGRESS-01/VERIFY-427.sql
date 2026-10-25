-- ====================================================================================================
-- VERIFY 427 (COMPETEN-SCHOLAR-PROGRESS-01). Read-only. Run after applying 427, on STAGING.
-- Expected: 5 columns, the check, the evaluation foreign key, the user foreign key and the primary key, the unique
-- index, RLS on with one own-row read policy, no trigger, and 0 rows (a new table).
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

select count(*) as columns from information_schema.columns
 where table_schema = 'public' and table_name = 'individual_scholar_passport_evaluation';

select conname, contype from pg_constraint
 where conrelid = 'public.individual_scholar_passport_evaluation'::regclass order by conname;

select indexname from pg_indexes where tablename = 'individual_scholar_passport_evaluation' order by indexname;

select relname, relrowsecurity from pg_class where relname = 'individual_scholar_passport_evaluation';

select policyname, cmd from pg_policies where tablename = 'individual_scholar_passport_evaluation';

select count(*) as triggers from pg_trigger
 where tgrelid = 'public.individual_scholar_passport_evaluation'::regclass and not tgisinternal;

select count(*) as rows from individual_scholar_passport_evaluation;
