-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 413 (COMPETEN-SCHOLAR-UPLOAD-01 upload limits). Restores the 10 MB cap of 372 on the
-- material CHECK and the private bucket.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- !! IT FAILS, AND CHANGES NOTHING AFTER THAT POINT, IF A MATERIAL OVER 10 MB EXISTS. Count first: the rows of
--    individual_scholar_material whose byte_size is over 10485760. Those must be deleted by their owner first.
--    Lower scholar_upload_max_mb to 10 or less in the Individual policy first.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

alter table individual_scholar_material drop constraint if exists individual_scholar_material_size_check;
alter table individual_scholar_material add constraint individual_scholar_material_size_check
  check (byte_size > 0 and byte_size <= 10485760);

update storage.buckets
  set file_size_limit = 10485760
  where id = 'individual-scholar-materials';

notify pgrst, 'reload schema';
