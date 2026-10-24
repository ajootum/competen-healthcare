-- ====================================================================================================
-- VERIFY 436 (COMPETEN-SCHOLAR-CLINICAL-REASONING-01), read-only. Run after each application.
-- Expected results are on each line. ASCII only. No semicolons inside comments.
-- ====================================================================================================

-- 1. the library column is gone (expect 0 rows)
select column_name from information_schema.columns
 where table_name = 'individual_scholar_case_session' and column_name = 'library_version_id';

-- 2. private_case_id is required (expect one row, is_nullable NO)
select column_name, is_nullable from information_schema.columns
 where table_name = 'individual_scholar_case_session' and column_name = 'private_case_id';

-- 3. no foreign key from it to the library, and the CHECK is in place (expect 0, then 1)
select count(*) as library_fks from pg_constraint
 where conrelid = 'individual_scholar_case_session'::regclass and confrelid = 'case_library_version'::regclass;
select count(*) as checks from pg_constraint where conname = 'individual_scholar_case_session_check';
