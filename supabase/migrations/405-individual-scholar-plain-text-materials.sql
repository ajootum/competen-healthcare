-- ====================================================================================================
-- MIGRATION 405: COMPETEN SCHOLAR -- PLAIN TEXT STUDY MATERIAL (A .TXT FILE, OR TEXT PASTED INTO THE PAGE)
--
-- COMPETEN-SCHOLAR-UPLOAD, Stage 2 (owner GO 2026-10-24, "Proceed to Stage 2 -- Upload"). A student may add
-- notes as plain text: a .txt file, or text pasted into the upload page, which is kept as a .txt original
-- exactly as a file would be (source preservation). 372 allows PDF and DOCX only, in two places -- the MIME
-- types the private bucket allows, and the MIME CHECK on each material row -- so this file adds text/plain to
-- both. Nothing else changes: the 10 MB cap, the page-count rule (a text material has no pages, like DOCX),
-- the owner folder rule, RLS and every policy are as 372 left them.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. LOW: one CHECK replaced by a wider one (every row
-- valid before is valid after) and one bucket setting widened. It depends on 372. Re-running it is a no-op.
--
-- FAIL CLOSED WITHOUT IT. The application offers plain text only when the Individual policy
-- scholar_upload_formats includes text, and that policy is OFF by default. Turn it on only where this file
-- is applied. Rollback: docs/evidence/COMPETEN-SCHOLAR-UPLOAD/ROLLBACK-405.sql.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No function. notify pgrst last.
-- ====================================================================================================

alter table individual_scholar_material drop constraint if exists individual_scholar_material_mime_check;
alter table individual_scholar_material add constraint individual_scholar_material_mime_check
  check (mime_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'));

update storage.buckets
  set allowed_mime_types = array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
  where id = 'individual-scholar-materials';

notify pgrst, 'reload schema';
