-- ====================================================================================================
-- VERIFY 425 (COMPETEN-SCHOLAR-REVISION-01). Read-only. Run after applying 425, on STAGING.
-- Expected: 1 column row (jsonb, nullable), 1 constraint row, RLS still on, 0 rows outside the check.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

select column_name, data_type, is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = 'individual_scholar_revision_session_item' and column_name = 'held_response';

select conname from pg_constraint
 where conrelid = 'public.individual_scholar_revision_session_item'::regclass and conname = 'individual_scholar_revision_session_item_held_check';

select relname, relrowsecurity from pg_class where relname = 'individual_scholar_revision_session_item';

select count(*) as held_outside_check from individual_scholar_revision_session_item
 where held_response is not null and (jsonb_typeof(held_response) <> 'object' or octet_length(held_response::text) > 8000);
