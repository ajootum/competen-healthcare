-- ====================================================================================================
-- MIGRATION 425: COMPETEN SCHOLAR -- A SHORT ANSWER HELD, UNMARKED, UNTIL THE END OF ITS SESSION
--
-- COMPETEN-SCHOLAR-REVISION-01 (Stage 4) R4, owner decision 2026-10-25 "STAGE 4 REVISION DECISION: hold
-- self-grading until the end". Build record: docs/COMPETEN-SCHOLAR-REVISION-01.md.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. LOW: one nullable column and its check on
-- individual_scholar_revision_session_item (417). No existing row is changed. No function, no trigger.
-- It depends on 417. Re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR.
--
-- In a session whose feedback comes at the end (end-of-session feedback, and Mock Practice), a short answer
-- that code cannot mark and no authorised AI evaluation has judged waits for the student to judge it. The
-- owner policy: preserve the response, reveal neither the accepted answer, the explanation nor the
-- self-grading prompt until the session ends, and lose nothing if the student leaves and comes back.
--
-- An attempt (372) cannot hold it: an attempt is a MARKED answer (correct is not null, its marking is one of
-- deterministic, self_graded, ai_evaluation), and it is never rewritten. So the response waits on the
-- item of that question in the session, in held_response, until the student grades it at the end. Grading it
-- writes the attempt (marking self_graded, the response stored as typed) and clears held_response. A held
-- answer is never counted as right, wrong or marked, and is never an attempt until the student marks it.
--
-- PRIVACY. held_response is what the student wrote, in their own private, erasable record, as a 416 attempt
-- response is: screened for patient identifiers before it is written, bounded to 8000 bytes. It goes with its
-- session (erase-all, removing the session) and with its question (deleting the material), by the 417 cascades.
-- RLS is unchanged: the item is own-row read, and only the service role writes.
-- ====================================================================================================

alter table individual_scholar_revision_session_item add column if not exists held_response jsonb;

alter table individual_scholar_revision_session_item drop constraint if exists individual_scholar_revision_session_item_held_check;
alter table individual_scholar_revision_session_item add constraint individual_scholar_revision_session_item_held_check
  check (held_response is null or (jsonb_typeof(held_response) = 'object' and octet_length(held_response::text) <= 8000));

comment on column individual_scholar_revision_session_item.held_response is
  'COMPETEN-SCHOLAR-REVISION-01 (425). A short answer the student wrote in an end-of-session or Mock session that code could not mark and no AI evaluation judged, held unmarked until they grade it at the end. Cleared when graded (the attempt then holds it). Private, erasable, never an attempt.';

notify pgrst, 'reload schema';
