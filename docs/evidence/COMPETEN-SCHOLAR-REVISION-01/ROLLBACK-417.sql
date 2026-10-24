-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 417 (COMPETEN-SCHOLAR-REVISION-01). Removes saved revision sets and revision sessions.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- !! Every saved revision set and every revision session is lost. Attempts (the revision history), questions,
--    cards and the review log are untouched: attempts only lose the session they named.
-- Run this BEFORE ROLLBACK-416 if both are being rolled back.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

alter table individual_scholar_attempt drop constraint if exists individual_scholar_attempt_revision_session_fk;
drop index if exists idx_individual_scholar_attempt_revision_session;
alter table individual_scholar_attempt drop column if exists revision_session_id;

drop table if exists individual_scholar_revision_session_item;
drop table if exists individual_scholar_revision_session;
drop table if exists individual_scholar_revision_set_item;
drop table if exists individual_scholar_revision_set;

notify pgrst, 'reload schema';
