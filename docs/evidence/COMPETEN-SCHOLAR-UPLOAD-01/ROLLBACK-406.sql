-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 406 (COMPETEN-SCHOLAR-UPLOAD-01). Restores the 405 MIME and page CHECKs and bucket
-- list, and drops extraction_quality.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- !! IT FAILS, AND CHANGES NOTHING AFTER THAT POINT, IF A POWERPOINT MATERIAL EXISTS. Count first: the rows
--    of individual_scholar_material whose mime_type is the presentationml type. Those must be deleted by
--    their owner first (the material delete removes the object too). Turn the pptx format off first.
-- !! Dropping extraction_quality loses every quality record. Materials are kept, shown as not measured.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

alter table individual_scholar_material drop constraint if exists individual_scholar_material_mime_check;
alter table individual_scholar_material add constraint individual_scholar_material_mime_check
  check (mime_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'));

alter table individual_scholar_material drop constraint if exists individual_scholar_material_pages_check;
alter table individual_scholar_material add constraint individual_scholar_material_pages_check
  check ((mime_type = 'application/pdf') = (page_count is not null) and (page_count is null or page_count > 0));

update storage.buckets
  set allowed_mime_types = array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
  where id = 'individual-scholar-materials';

alter table individual_scholar_material drop constraint if exists individual_scholar_material_quality_check;
alter table individual_scholar_material drop column if exists extraction_quality;

notify pgrst, 'reload schema';
