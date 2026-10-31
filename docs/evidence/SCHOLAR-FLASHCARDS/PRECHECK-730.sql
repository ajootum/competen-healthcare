-- PRECHECK 730 (read only). Reports by raising, so the runner rolls back and nothing changes.
-- Run before and after applying 730. SCHOLAR-FLASHCARDS-01.
do $$
declare
  r text;
begin
  select concat_ws(' | ',
    'question_table=' || (to_regclass('public.individual_scholar_question') is not null),
    'card_table=' || (to_regclass('public.individual_scholar_card') is not null),
    'review_table_391=' || (to_regclass('public.individual_scholar_review') is not null),
    'col_answer_416=' || exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_question' and column_name = 'answer'),
    'col_library_version_710=' || exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_question' and column_name = 'library_version_id'),
    'col_content_version_730=' || exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_question' and column_name = 'content_version'),
    'check_learner_card_730=' || exists(select 1 from pg_constraint where conname = 'individual_scholar_question_learner_card_check'),
    'deck_table_730=' || (to_regclass('public.individual_scholar_flashcard_deck') is not null),
    'deck_card_table_730=' || (to_regclass('public.individual_scholar_flashcard_deck_card') is not null),
    'mark_table_730=' || (to_regclass('public.individual_scholar_flashcard_mark') is not null),
    'question_columns=' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_question'),
    'questions=' || (select count(*) from individual_scholar_question),
    'flashcards=' || (select count(*) from individual_scholar_question where kind = 'flashcard'),
    'model_learner_rows=' || (select count(*) from individual_scholar_question where model = 'learner' or provider = 'learner')
  ) into r;
  raise exception 'PRECHECK 730: %', r;
end;
$$;
