-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 407 (COMPETEN-SCHOLAR-UPLOAD-01). Removes collections and the title CHECK.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- !! Every collection is lost. Materials are kept, simply no longer on a shelf. Renamed titles are kept.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

alter table individual_scholar_material drop constraint if exists individual_scholar_material_title_check;
alter table individual_scholar_material drop constraint if exists individual_scholar_material_collection_fk;
drop index if exists idx_individual_scholar_material_collection;
alter table individual_scholar_material drop column if exists collection_id;
drop table if exists individual_scholar_collection;

notify pgrst, 'reload schema';
