-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains a plpgsql block between dollar quotes.
-- ====================================================================================================
-- ROLLBACK 710 (staging, or production only with an owner GO). Restores the three 416 CHECKs byte for byte, and drops
-- the 710 trigger, function, index and two columns.
--
-- IT REFUSES while any row depends on the wider form, because the 416 CHECKs would reject it:
--   a structured question, an mcq or case that stores a rubric, or a library copy.
-- To roll back anyway, the owner first decides to remove them, then runs, in one transaction, before this file:
--   update individual_scholar_question set answer = null where kind in ('mcq', 'case') and answer is not null
--   delete from individual_scholar_question where kind = 'structured' or library_version_id is not null
-- The delete also removes, by cascade, their attempts, cards, set items and session items. The update loses only
-- the stored rubrics (the questions and their keys stay).
-- ====================================================================================================

do $$
declare
  n_structured int;
  n_rubric int;
  n_library int;
begin
  select count(*) into n_structured from individual_scholar_question where kind = 'structured';
  select count(*) into n_rubric from individual_scholar_question where kind in ('mcq', 'case') and answer is not null;
  select count(*) into n_library from individual_scholar_question where library_version_id is not null;
  if n_structured + n_rubric + n_library > 0 then
    raise exception 'ROLLBACK 710 refused: % structured question(s), % mcq or case rubric(s), % library copy(ies) depend on 710. See the header of this file for what to remove first.', n_structured, n_rubric, n_library;
  end if;
end;
$$;

drop trigger if exists individual_scholar_question_library_guard on individual_scholar_question;
drop function if exists public.individual_scholar_question_library_guard();

alter table individual_scholar_question drop constraint if exists individual_scholar_question_kind_check;
alter table individual_scholar_question add constraint individual_scholar_question_kind_check
  check (kind in ('mcq', 'case', 'mrq', 'short', 'flashcard', 'match', 'sequence'));

alter table individual_scholar_question drop constraint if exists individual_scholar_question_options_check;
alter table individual_scholar_question add constraint individual_scholar_question_options_check
  check (jsonb_typeof(options) = 'array' and (
       (kind in ('mcq', 'case') and jsonb_array_length(options) = 4
          and correct_index is not null and correct_index between 0 and 3 and answer is null)
    or (kind = 'mrq' and jsonb_array_length(options) between 4 and 6 and correct_index is null
          and jsonb_typeof(answer -> 'correct') = 'array'
          and jsonb_array_length(answer -> 'correct') between 1 and jsonb_array_length(options) - 1
          and (answer -> 'correct') <@ '[0, 1, 2, 3, 4, 5]'::jsonb)
    or (kind = 'short' and jsonb_array_length(options) = 0 and correct_index is null
          and jsonb_typeof(answer -> 'accepted') = 'array'
          and jsonb_array_length(answer -> 'accepted') between 1 and 8)
    or (kind = 'flashcard' and jsonb_array_length(options) = 0 and correct_index is null
          and jsonb_typeof(answer -> 'back') = 'string' and char_length(answer ->> 'back') between 1 and 2000)
    or (kind = 'match' and jsonb_array_length(options) between 3 and 6 and correct_index is null
          and jsonb_typeof(answer -> 'matches') = 'array'
          and jsonb_array_length(answer -> 'matches') = jsonb_array_length(options))
    or (kind = 'sequence' and jsonb_array_length(options) between 3 and 6 and correct_index is null
          and jsonb_typeof(answer -> 'order') = 'array'
          and jsonb_array_length(answer -> 'order') = jsonb_array_length(options)
          and (answer -> 'order') <@ '[0, 1, 2, 3, 4, 5]'::jsonb)
  ));

alter table individual_scholar_question drop constraint if exists individual_scholar_question_revision_check;
alter table individual_scholar_question add constraint individual_scholar_question_revision_check
  check ((difficulty is null or difficulty between 1 and 3)
     and review_status = 'private_formative'
     and (answer is null or octet_length(answer::text) <= 16000));

drop index if exists ux_individual_scholar_question_library;
alter table individual_scholar_question drop column if exists library_version_id;
alter table individual_scholar_question drop column if exists library_resource_id;

comment on column individual_scholar_question.answer is
  'COMPETEN-SCHOLAR-REVISION-01 (416). The key of a kind that is not single-choice: correct (mrq), accepted (short), back (flashcard), matches (match), order (sequence). Null for mcq and case, whose key is correct_index.';
comment on column individual_scholar_question.review_status is
  'COMPETEN-SCHOLAR-REVISION-01 (416). Always private_formative: an AI-written question is never stored as clinically approved.';

notify pgrst, 'reload schema';
