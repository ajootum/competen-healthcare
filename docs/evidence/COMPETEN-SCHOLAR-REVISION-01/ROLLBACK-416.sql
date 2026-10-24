-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 416 (COMPETEN-SCHOLAR-REVISION-01). Restores the 372 shape of questions and attempts.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- !! Run ROLLBACK-417 first if 417 is applied.
-- !! DESTRUCTIVE FOR STAGE 4 DATA. Every question of a kind 372 does not know (mrq, short, flashcard, match,
--    sequence) is deleted, with its cards, review log and attempts (by cascade), and every attempt recorded as a
--    response is deleted. mcq and case questions and their single-choice attempts are untouched.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

delete from individual_scholar_attempt where response is not null;
delete from individual_scholar_question where kind not in ('mcq', 'case');

alter table individual_scholar_attempt drop constraint if exists individual_scholar_attempt_marking_check;
alter table individual_scholar_attempt drop constraint if exists individual_scholar_attempt_choice_check;
alter table individual_scholar_attempt drop column if exists evaluator_prompt_version;
alter table individual_scholar_attempt drop column if exists evaluator_model;
alter table individual_scholar_attempt drop column if exists score;
alter table individual_scholar_attempt drop column if exists marking;
alter table individual_scholar_attempt drop column if exists response;
alter table individual_scholar_attempt alter column chosen_index set not null;
alter table individual_scholar_attempt add constraint individual_scholar_attempt_choice_check
  check (chosen_index between 0 and 3);

alter table individual_scholar_question drop constraint if exists individual_scholar_question_revision_check;
alter table individual_scholar_question drop constraint if exists individual_scholar_question_options_check;
alter table individual_scholar_question drop constraint if exists individual_scholar_question_kind_check;
drop index if exists idx_individual_scholar_question_kind;
alter table individual_scholar_question drop column if exists review_status;
alter table individual_scholar_question drop column if exists difficulty;
alter table individual_scholar_question drop column if exists answer;
alter table individual_scholar_question alter column correct_index set not null;
alter table individual_scholar_question add constraint individual_scholar_question_kind_check
  check (kind in ('mcq', 'case'));
alter table individual_scholar_question add constraint individual_scholar_question_options_check
  check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4 and correct_index between 0 and 3);

notify pgrst, 'reload schema';
