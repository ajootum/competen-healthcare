-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 390 (COMPETEN-SCHOLAR-01). Restores the provenance CHECK exactly as 388 wrote it.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- It only loosens a constraint, so it cannot fail on existing rows and discards nothing.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

alter table individual_scholar_competency_map drop constraint if exists individual_scholar_competency_map_provenance_check;
alter table individual_scholar_competency_map add constraint individual_scholar_competency_map_provenance_check
  check ((source = 'ai') = (model is not null and prompt_version is not null and confidence is not null)
     and (confidence is null or (confidence >= 0 and confidence <= 1))
     and (rationale is null or char_length(rationale) <= 500));

notify pgrst, 'reload schema';
