-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 426 (COMPETEN-SCHOLAR-EVALUATION-01). Removes the evaluation record.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- !! Every evaluation record is lost. The evidence it read (attempts, reviews, case answers, learning events,
--    sessions) is untouched: it was only referenced, never copied.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

drop trigger if exists individual_scholar_evaluation_as_made on individual_scholar_evaluation;
drop table if exists individual_scholar_evaluation;
drop function if exists public.individual_scholar_evaluation_as_made();

notify pgrst, 'reload schema';
