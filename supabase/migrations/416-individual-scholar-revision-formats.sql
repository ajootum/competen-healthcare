-- ====================================================================================================
-- MIGRATION 416: COMPETEN SCHOLAR -- REVISION QUESTION FORMATS, AND HOW AN ANSWER WAS MARKED
--
-- COMPETEN-SCHOLAR-REVISION-01 (Stage 4), R2 and R4, owner GO: development and staging authorised,
-- production activation on hold. Build record: docs/COMPETEN-SCHOLAR-REVISION-01.md.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. MEDIUM: it alters two existing tables. It adds
-- columns, drops two NOT NULLs, WIDENS one CHECK and REPLACES two others with kind-conditional ones that every
-- existing row already satisfies. It removes no column and rewrites no row. No function, no trigger.
-- It depends on 372 (individual_scholar_question, individual_scholar_attempt) and 388 (case columns). Re-running
-- it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR.
--
-- Stage 4 revises from the questions Scholar already stores (372, 388), extended rather than duplicated. Today
-- a question can only be a four-option single answer (mcq, or a case step), and an attempt can only be the
-- index chosen. Revision also needs
--   mrq        multiple response: 4 to 6 options, one or more correct (answer.correct, option indexes)
--   short      short answer: no options, the accepted answers from the notes (answer.accepted)
--   flashcard  front (stem) and back (answer.back), reviewed on the existing spaced-review card (372, 391)
--   match      3 to 6 prompts (options) and the item each matches, in the same order (answer.matches)
--   sequence   3 to 6 steps (options) and their correct order, as option indexes (answer.order)
-- mcq and case keep exactly their 372 shape: four options, correct_index, and no answer column.
--
-- Every question also records its difficulty (1 easy, 2 standard, 3 harder, null where not recorded, as on
-- every question made before this) and a review status that can ONLY be private_formative. An AI-written
-- question is never stored as clinically approved, so no screen can show it as such (Stage 4 s4 and s10).
--
-- An attempt records the answer in one of two forms, never both: chosen_index (the single-choice kinds, as
-- today) or response (the others, e.g. the indexes chosen, the order given, the text written). It records
-- HOW it was marked:
--   deterministic   against the stored key, by code
--   self_graded     the student compared their answer with the stored accepted answers and said
--   ai_evaluation   an AI judged a short answer -- then the evaluator model and prompt version are recorded
-- so AI evaluation is never shown as deterministic marking (s6). score is the share correct (0 to 1) for
-- kinds that can be partly right. correct stays the whole-answer result, as every existing reader uses it.
--
-- A SHORT ANSWER IS WHAT THE STUDENT WROTE, kept in their own private record for their revision history. It is
-- screened for patient identifiers before it is written (application), bounded here to 8000 bytes, readable
-- only by its owner, and erased with the question, the material, or the person.
--
-- Nothing here is assessment or competence. The 372 rule stands: attempts are never copied into quiz_attempts or
-- knowledge_attempts.
--
-- FAIL CLOSED WITHOUT IT. Until it is applied, the new kinds cannot be stored (the 372 CHECKs refuse them), and
-- Scholar offers only mcq and case, as today.
-- Rollback: docs/evidence/COMPETEN-SCHOLAR-REVISION-01/ROLLBACK-416.sql.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No function. notify pgrst last.
-- ====================================================================================================


-- ---- 1. individual_scholar_question: THE NEW KINDS, THEIR KEY, DIFFICULTY AND REVIEW STATUS ----------

alter table individual_scholar_question add column if not exists answer jsonb;
alter table individual_scholar_question add column if not exists difficulty smallint;
alter table individual_scholar_question add column if not exists review_status text not null default 'private_formative';
alter table individual_scholar_question alter column correct_index drop not null;

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

create index if not exists idx_individual_scholar_question_kind
  on individual_scholar_question(user_id, kind, created_at desc);

comment on column individual_scholar_question.answer is
  'COMPETEN-SCHOLAR-REVISION-01 (416). The key of a kind that is not single-choice: correct (mrq), accepted (short), back (flashcard), matches (match), order (sequence). Null for mcq and case, whose key is correct_index.';
comment on column individual_scholar_question.review_status is
  'COMPETEN-SCHOLAR-REVISION-01 (416). Always private_formative: an AI-written question is never stored as clinically approved.';


-- ---- 2. individual_scholar_attempt: THE ANSWER IN EITHER FORM, AND HOW IT WAS MARKED ----------------

alter table individual_scholar_attempt add column if not exists response jsonb;
alter table individual_scholar_attempt add column if not exists marking text not null default 'deterministic';
alter table individual_scholar_attempt add column if not exists score numeric;
alter table individual_scholar_attempt add column if not exists evaluator_model text;
alter table individual_scholar_attempt add column if not exists evaluator_prompt_version text;
alter table individual_scholar_attempt alter column chosen_index drop not null;

alter table individual_scholar_attempt drop constraint if exists individual_scholar_attempt_choice_check;
alter table individual_scholar_attempt add constraint individual_scholar_attempt_choice_check
  check ((chosen_index is null) <> (response is null)
     and (chosen_index is null or chosen_index between 0 and 3)
     and (response is null or (jsonb_typeof(response) = 'object' and octet_length(response::text) <= 8000)));

alter table individual_scholar_attempt drop constraint if exists individual_scholar_attempt_marking_check;
alter table individual_scholar_attempt add constraint individual_scholar_attempt_marking_check
  check (marking in ('deterministic', 'self_graded', 'ai_evaluation')
     and (score is null or (score >= 0 and score <= 1))
     and ((marking = 'ai_evaluation') = (evaluator_model is not null))
     and ((evaluator_model is null) = (evaluator_prompt_version is null))
     and (evaluator_model is null or char_length(evaluator_model) between 1 and 200)
     and (evaluator_prompt_version is null or char_length(evaluator_prompt_version) between 1 and 200));

comment on column individual_scholar_attempt.marking is
  'COMPETEN-SCHOLAR-REVISION-01 (416). deterministic (by code against the stored key), self_graded (the student against the stored accepted answers) or ai_evaluation (an AI judged it, with evaluator_model and evaluator_prompt_version). Shown as such.';

notify pgrst, 'reload schema';
