-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 414 (COMPETEN-SCHOLAR-LEARN-01, L4). Removes the learning history tables.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- !! Every learning session, step, event, source link and learning preference is lost. Study materials,
--    their sections and everything else are untouched.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

drop table if exists individual_scholar_learning_event_source;
drop table if exists individual_scholar_learning_event;
drop table if exists individual_scholar_learning_step;
drop table if exists individual_scholar_learning_session;
drop table if exists individual_scholar_learning_preference;

notify pgrst, 'reload schema';
