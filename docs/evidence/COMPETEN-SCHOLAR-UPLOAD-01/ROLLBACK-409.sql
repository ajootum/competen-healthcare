-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 409 (COMPETEN-SCHOLAR-UPLOAD-01). Drops the per-person duplicate key.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- !! The upload route still refuses a duplicate. Only the schema guarantee goes.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

drop index if exists ux_individual_scholar_material_user_sha256;

notify pgrst, 'reload schema';
