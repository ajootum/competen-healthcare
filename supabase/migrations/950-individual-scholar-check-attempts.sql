-- ====================================================================================================
-- MIGRATION 950: COMPETEN SCHOLAR -- AN UNDERSTANDING CHECK'S ANSWER IS KEPT WITH ITS JUDGEMENT
-- (LEARNING-CLOSE-2026-11, owner decision D01, workstream WS01 CYU-03)
--
-- Owner decision D01 (4 Nov 2026): save learner responses to understanding checks, typed answers included, with
-- the question and its version, the feedback, the outcome, the lesson, section, session and competency references,
-- the attempt history and the AI model and prompt that judged it. The record belongs to the learner's own Individual
-- learning record.
--
-- REUSE, NOT A NEW TABLE. A check question IS an individual_scholar_question (416 kind short, with the lesson's key
-- learning points as its key). An answer IS an individual_scholar_attempt (416 response jsonb holds the typed text and
-- the feedback, marking says how it was judged, evaluator_model and evaluator_prompt_version say by what). The lesson,
-- step and session are the clarify learning event (414), which now references the attempt it judged. Section, material
-- and competency are the question's own columns (372, 388). Deletion follows the existing cascades: the question and
-- its attempts go with the material, the event with the session, and the owner-read RLS of 372 is unchanged.
--
-- WHAT IT CHANGES.
--   1. A unique index on individual_scholar_attempt(id, user_id), the owner-scoped identity every reference in this
--      schema uses (the 372 pattern), so the event can reference an attempt of the same owner only.
--   2. individual_scholar_attempt.content_version: the 730 version of the question that was answered.
--   3. The 416 marking rule gains 'unmarked': an answer kept without a judgement (AI not available or refused, and the
--      learner did not grade it against the key points). An unmarked attempt carries no score and is never correct.
--   4. individual_scholar_learning_event.attempt_id, a foreign key to the attempt of the same owner, set null when the
--      attempt is erased (PostgreSQL 15 column-list form, so user_id is never nulled).
--
-- FORMATIVE ONLY. A check answer and its judgement are a learning record for the learner: never assessment, never
-- verified competence, never a Passport record. Nothing that makes an evaluation or a verification reads them.
--
-- FAIL CLOSED WITHOUT IT. The store writes content_version and attempt_id only where they exist: a missing column is
-- answered by storing the attempt without the version and the event without the link (what 414 and 416 already hold),
-- and the history reader answers an empty list.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Depends on 372, 414, 416, 730.
-- Re-running it is a no-op. Rollback: ROLLBACK-950.sql (refuses while any unmarked attempt or any linked event exists).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. notify pgrst last.
-- ====================================================================================================

-- ---- 1. THE ATTEMPT'S OWNER-SCOPED IDENTITY --------------------------------------------------------
create unique index if not exists ux_individual_scholar_attempt_id_user
  on individual_scholar_attempt(id, user_id);

-- ---- 2. THE QUESTION VERSION ANSWERED --------------------------------------------------------------
alter table individual_scholar_attempt add column if not exists content_version integer;

alter table individual_scholar_attempt drop constraint if exists individual_scholar_attempt_content_version_check;
alter table individual_scholar_attempt add constraint individual_scholar_attempt_content_version_check
  check (content_version is null or content_version >= 1);

comment on column individual_scholar_attempt.content_version is
  'LEARNING-CLOSE-2026-11 D01 (950). The individual_scholar_question.content_version (730) the learner answered. Null where it was not recorded.';

-- ---- 3. AN ANSWER KEPT WITHOUT A MARK --------------------------------------------------------------
alter table individual_scholar_attempt drop constraint if exists individual_scholar_attempt_marking_check;
alter table individual_scholar_attempt add constraint individual_scholar_attempt_marking_check
  check (marking in ('deterministic', 'self_graded', 'ai_evaluation', 'unmarked')
     and (score is null or (score >= 0 and score <= 1))
     and ((marking = 'ai_evaluation') = (evaluator_model is not null))
     and ((evaluator_model is null) = (evaluator_prompt_version is null))
     and (evaluator_model is null or char_length(evaluator_model) between 1 and 200)
     and (evaluator_prompt_version is null or char_length(evaluator_prompt_version) between 1 and 200)
     and (marking <> 'unmarked' or (score is null and correct = false)));

comment on column individual_scholar_attempt.marking is
  'COMPETEN-SCHOLAR-REVISION-01 (416), LEARNING-CLOSE-2026-11 (950). deterministic (by code against the stored key), self_graded (the student against the stored key points), ai_evaluation (an AI judged it, with evaluator_model and evaluator_prompt_version) or unmarked (kept without a judgement, never correct, no score). Shown as such.';

-- ---- 4. THE CLARIFY EVENT REFERENCES THE ATTEMPT IT JUDGED ------------------------------------------
alter table individual_scholar_learning_event add column if not exists attempt_id uuid;

alter table individual_scholar_learning_event drop constraint if exists individual_scholar_learning_event_attempt_fk;
alter table individual_scholar_learning_event add constraint individual_scholar_learning_event_attempt_fk
  foreign key (attempt_id, user_id) references individual_scholar_attempt(id, user_id) on delete set null (attempt_id);

create index if not exists idx_individual_scholar_learning_event_attempt
  on individual_scholar_learning_event(user_id, attempt_id);

comment on column individual_scholar_learning_event.attempt_id is
  'LEARNING-CLOSE-2026-11 D01 (950). The individual_scholar_attempt a clarify event judged: the learner''s kept answer to an understanding check. Null for every other event, and once the attempt is erased.';

notify pgrst, 'reload schema';
