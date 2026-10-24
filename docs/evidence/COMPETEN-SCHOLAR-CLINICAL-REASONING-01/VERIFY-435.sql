-- ====================================================================================================
-- VERIFY 435 (COMPETEN-SCHOLAR-CLINICAL-REASONING-01), read-only. Run after each application.
-- Expected results are on each line. ASCII only. No semicolons inside comments.
-- ====================================================================================================

-- 1. the five tables exist with RLS on (expect 5 rows, all true)
select relname, relrowsecurity from pg_class
 where relname in ('individual_scholar_case', 'individual_scholar_case_source', 'individual_scholar_case_competency',
   'individual_scholar_case_session', 'individual_scholar_case_answer')
 order by relname;

-- 2. the constraints and the append-only trigger exist (expect 3 constraint rows, then 1 trigger row)
select conname from pg_constraint
 where conname in ('individual_scholar_case_check', 'individual_scholar_case_session_check', 'individual_scholar_case_answer_check')
 order by conname;
select tgname from pg_trigger where tgname = 'individual_scholar_case_answer_append_only';

-- 3. the generated hash column and the library foreign key (expect 1 row each)
select column_name, is_generated from information_schema.columns
 where table_name = 'individual_scholar_case' and column_name = 'blueprint_hash';
select conname, confdeltype from pg_constraint
 where conrelid = 'individual_scholar_case_session'::regclass and confrelid = 'case_library_version'::regclass;

-- 4. nothing yet (expect 0, 0)
select count(*) as cases from individual_scholar_case;
select count(*) as sessions from individual_scholar_case_session;
