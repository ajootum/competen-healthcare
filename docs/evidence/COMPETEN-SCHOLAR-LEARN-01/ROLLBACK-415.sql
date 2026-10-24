-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 415 (COMPETEN-SCHOLAR-LEARN-01 / AI-FAIR-USE-01 s8). Removes the learning artefact
-- library.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- !! Every saved explanation and summary is lost. Materials, sections, questions, cards and learning history
--    are untouched.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

drop table if exists individual_scholar_artefact_source;
drop table if exists individual_scholar_artefact;

notify pgrst, 'reload schema';
