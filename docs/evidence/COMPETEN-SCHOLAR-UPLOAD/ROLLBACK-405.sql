-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 405 (COMPETEN-SCHOLAR-UPLOAD). Restores the 372 MIME CHECK and bucket list.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- !! IT FAILS, AND CHANGES NOTHING, IF A TEXT MATERIAL EXISTS. Count first: the rows of
--    individual_scholar_material whose mime_type is text/plain. Those must be deleted by their owner first
--    (the material delete removes the object too). Turn the text format off in the Individual policy first.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

alter table individual_scholar_material drop constraint if exists individual_scholar_material_mime_check;
alter table individual_scholar_material add constraint individual_scholar_material_mime_check
  check (mime_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));

update storage.buckets
  set allowed_mime_types = array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
  where id = 'individual-scholar-materials';

notify pgrst, 'reload schema';
