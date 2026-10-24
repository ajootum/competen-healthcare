-- ====================================================================================================
-- VERIFY 416 AND 417 (COMPETEN-SCHOLAR-REVISION-01), read-only. Run after each application.
-- Expected results are on each line. ASCII only. No semicolons inside comments.
-- ====================================================================================================

-- 1. the columns exist (expect 5 rows for question, 6 for attempt)
select table_name, column_name, is_nullable from information_schema.columns
 where table_name = 'individual_scholar_question' and column_name in ('answer', 'difficulty', 'review_status', 'correct_index', 'kind')
 order by column_name;
select table_name, column_name, is_nullable from information_schema.columns
 where table_name = 'individual_scholar_attempt' and column_name in ('response', 'marking', 'score', 'evaluator_model', 'evaluator_prompt_version', 'revision_session_id')
 order by column_name;

-- 2. the constraints exist (expect 7 rows)
select conrelid::regclass as tbl, conname from pg_constraint
 where conname in ('individual_scholar_question_kind_check', 'individual_scholar_question_options_check', 'individual_scholar_question_revision_check',
   'individual_scholar_attempt_choice_check', 'individual_scholar_attempt_marking_check', 'individual_scholar_attempt_revision_session_fk',
   'individual_scholar_revision_session_check')
 order by conname;

-- 3. the four new tables exist with RLS on (expect 4 rows, all true)
select relname, relrowsecurity from pg_class
 where relname in ('individual_scholar_revision_set', 'individual_scholar_revision_set_item', 'individual_scholar_revision_session', 'individual_scholar_revision_session_item')
 order by relname;

-- 4. every existing row is untouched and valid (expect 0 and 0, and review_status all private_formative)
select count(*) as questions_not_372_shape from individual_scholar_question where kind not in ('mcq', 'case') or answer is not null or correct_index is null;
select count(*) as attempts_not_372_shape from individual_scholar_attempt where response is not null or chosen_index is null or marking <> 'deterministic';
select review_status, count(*) from individual_scholar_question group by review_status;
