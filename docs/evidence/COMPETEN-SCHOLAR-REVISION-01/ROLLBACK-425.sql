-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 425 (COMPETEN-SCHOLAR-REVISION-01). Removes the held short answer column.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- !! Any short answer still held, unmarked, in an unfinished end-of-session or Mock session is lost.
--    Attempts, sessions, sets, questions, cards and the review log are untouched.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

alter table individual_scholar_revision_session_item drop constraint if exists individual_scholar_revision_session_item_held_check;
alter table individual_scholar_revision_session_item drop column if exists held_response;

notify pgrst, 'reload schema';
