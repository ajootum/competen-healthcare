-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 408 (COMPETEN-SCHOLAR-UPLOAD-01). Removes the catalogue version and outcome from
-- mappings, and the topic corrections table.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- !! Every recorded catalogue version and outcome is lost, and every student topic correction.
--    The mappings themselves are kept.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

drop table if exists individual_scholar_topic_correction;
alter table individual_scholar_competency_map drop constraint if exists individual_scholar_competency_map_outcome_check;
alter table individual_scholar_competency_map drop constraint if exists individual_scholar_competency_map_version_check;
alter table individual_scholar_competency_map drop column if exists outcome;
alter table individual_scholar_competency_map drop column if exists catalogue_version;

notify pgrst, 'reload schema';
