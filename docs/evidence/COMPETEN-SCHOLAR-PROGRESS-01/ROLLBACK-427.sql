-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 427 (COMPETEN-SCHOLAR-PROGRESS-01). Removes the Passport evaluation choices.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- !! Every choice to show an evaluation in the Passport is lost. The evaluations themselves (426) are untouched.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

drop table if exists individual_scholar_passport_evaluation;

notify pgrst, 'reload schema';
