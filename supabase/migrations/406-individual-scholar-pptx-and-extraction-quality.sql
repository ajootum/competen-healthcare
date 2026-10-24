-- ====================================================================================================
-- MIGRATION 406: COMPETEN SCHOLAR -- POWERPOINT MATERIALS, AND HOW COMPLETELY EACH FILE WAS READ
--
-- COMPETEN-SCHOLAR-UPLOAD-01 (owner GO 2026-10-24, Stage 2 infrastructure review and implementation), U1 and U2.
-- U1: a student may upload a PowerPoint lecture (.pptx). It is read slide by slide, with its speaker notes,
-- and each section cites its slide. 372 and 405 allow PDF, DOCX and plain text in two places -- the MIME types
-- the private bucket allows, and the MIME CHECK on each material row -- so this file adds the PowerPoint type
-- to both. A slide is the unit a PowerPoint cites, as a page is for a PDF, so the page-count rule becomes:
-- a PDF or a PowerPoint has a count (pages or slides), a Word or text file has none.
-- U2: extraction_quality records how completely the file was read -- how many pages or slides, which of them
-- held no readable text, how many characters and sections. Null means NOT MEASURED (a material uploaded
-- before this file), never "read in full".
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. LOW: two CHECKs replaced by wider ones (every row
-- valid before is valid after), one bucket setting widened, one nullable column added with its own CHECK.
-- It depends on 372 and 405. Re-running it is a no-op.
--
-- FAIL CLOSED WITHOUT IT. The application offers PowerPoint only when the Individual policy
-- scholar_upload_formats includes pptx, and that is OFF by default. Where the column is absent the upload
-- stores the row without it (quality shown as not measured). Rollback:
-- docs/evidence/COMPETEN-SCHOLAR-UPLOAD-01/ROLLBACK-406.sql.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No function. notify pgrst last.
-- ====================================================================================================

alter table individual_scholar_material drop constraint if exists individual_scholar_material_mime_check;
alter table individual_scholar_material add constraint individual_scholar_material_mime_check
  check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ));

alter table individual_scholar_material drop constraint if exists individual_scholar_material_pages_check;
alter table individual_scholar_material add constraint individual_scholar_material_pages_check
  check ((mime_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')) = (page_count is not null)
     and (page_count is null or page_count > 0));

update storage.buckets
  set allowed_mime_types = array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ]
  where id = 'individual-scholar-materials';

alter table individual_scholar_material add column if not exists extraction_quality jsonb;

alter table individual_scholar_material drop constraint if exists individual_scholar_material_quality_check;
alter table individual_scholar_material add constraint individual_scholar_material_quality_check
  check (extraction_quality is null or (
    jsonb_typeof(extraction_quality) = 'object'
    and (extraction_quality -> 'units') is not null and (extraction_quality -> 'chars') is not null
    and (extraction_quality -> 'sections') is not null
    and coalesce(jsonb_typeof(extraction_quality -> 'empty_units'), '') = 'array'
    and coalesce(extraction_quality ->> 'unit', '') in ('page', 'slide', 'section')
  ));

comment on column individual_scholar_material.extraction_quality is
  'COMPETEN-SCHOLAR-UPLOAD-01 U2. How completely the file was read: unit (page, slide or section), units, empty_units (the pages or slides that held no readable text), chars, sections. A non-empty empty_units is a PARTIAL read and is shown as one. Null: not measured (uploaded before 406).';

notify pgrst, 'reload schema';
