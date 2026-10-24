-- ====================================================================================================
-- MIGRATION 413: COMPETEN SCHOLAR -- ONE STUDY FILE MAY BE UP TO 25 MB
--
-- Owner GO 2026-10-24 (COMPETEN-SCHOLAR-UPLOAD-01 Stage 2 acceptance, Upload limits): raise the configurable
-- per-file upload limit from 10 MB to an initial target of 25 MB. 372 caps a study file at 10 MB in two places
-- -- the CHECK on each material row and the private bucket file_size_limit -- and the Individual policy
-- scholar_upload_max_mb can only tighten them. This file raises both caps to 25 MB (26214400 bytes). It does NOT
-- change what a student may upload today: the policy keeps its value (10 MB) until HQ raises it on the
-- Individual policy page, which it can only do up to these caps.
--
-- CONSTRAINTS CHECKED BEFORE RAISING (build record docs/COMPETEN-SCHOLAR-UPLOAD-limits.md). The file goes from
-- the browser straight to storage on a signed URL, never through a function body (the 4.5 MB request limit does
-- not apply). The Supabase project global upload limit must be at least 25 MB (it is 50 MB at most on Free, up to
-- 500 GB on Pro) -- a bucket limit above the global one is not honoured. Processing a 25 MB file, measured at the
-- page and slide caps, takes about two seconds and about 215 MB above baseline, inside the 60 s the route allows.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. LOW: one CHECK replaced by a wider one (every row valid
-- before is valid after) and one bucket setting widened. The Professional evidence bucket (373) is not touched.
-- It depends on 372. Re-running it is a no-op. Rollback: docs/evidence/COMPETEN-SCHOLAR-UPLOAD-01/ROLLBACK-413.sql.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No function. notify pgrst last.
-- ====================================================================================================

alter table individual_scholar_material drop constraint if exists individual_scholar_material_size_check;
alter table individual_scholar_material add constraint individual_scholar_material_size_check
  check (byte_size > 0 and byte_size <= 26214400);

update storage.buckets
  set file_size_limit = 26214400
  where id = 'individual-scholar-materials';

notify pgrst, 'reload schema';
