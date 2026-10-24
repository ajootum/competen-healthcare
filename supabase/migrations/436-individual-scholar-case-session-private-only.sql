-- ====================================================================================================
-- MIGRATION 436: COMPETEN SCHOLAR -- A SCHOLAR CASE SESSION PLAYS A PRIVATE CASE ONLY
--
-- COMPETEN-SCHOLAR-CLINICAL-REASONING-01 (Stage 5A), fix-forward of 435 (committed and frozen, never edited).
-- Coordinator decision 2026-10-25: a playing by a student of a LIBRARY case is stored once, by the shared case
-- delivery (case_library_session, migration 423, IND-007) with its own delivery guard. 435 could also hold one
-- (private case XOR library version), which would be a second store for the same thing. This removes that.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. LOW: on individual_scholar_case_session (435) it drops the
-- column library_version_id with its foreign key and index, makes private_case_id NOT NULL, and replaces the CHECK
-- without the either-or. The table is empty on staging, and 435 is not on production. No function, no trigger.
-- It depends on 435. Re-running it is a no-op.
--
-- PRE-CHECK: no session names a library version (expect 0). If any does, STOP: it is a library play stored in the
-- wrong place and must be looked at before anything is dropped.
--   select count(*) from individual_scholar_case_session where library_version_id is not null
-- (Run that before applying. It errors harmlessly once the column is gone.)
--
-- AFTER IT: a Scholar case session can only ever be a playing of a private case of that same student. Library cases are
-- played through src/lib/cases/library.ts on case_library_session. Both run on the same pure engine (blueprint.ts and
-- library.ts applyAnswer), so progression, reveals and safety events behave the same.
--
-- Rollback: docs/evidence/COMPETEN-SCHOLAR-CLINICAL-REASONING-01/ROLLBACK-436.sql.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No function. notify pgrst last.
-- ====================================================================================================

drop index if exists idx_individual_scholar_case_session_library;

alter table individual_scholar_case_session drop constraint if exists individual_scholar_case_session_check;

alter table individual_scholar_case_session drop column if exists library_version_id;

alter table individual_scholar_case_session alter column private_case_id set not null;

alter table individual_scholar_case_session add constraint individual_scholar_case_session_check
  check (mode in ('guided', 'independent')
     and status in ('active', 'completed')
     and ((status = 'completed') = (completed_at is not null))
     and view_salt ~ '^[A-Za-z0-9_-]{22,64}$'
     and (current_stage_id is null or current_stage_id ~ '^[a-z][a-z0-9_-]{0,30}$')
     and jsonb_typeof(reached_stage_ids) = 'array' and jsonb_array_length(reached_stage_ids) <= 50
     and jsonb_typeof(revealed_fact_ids) = 'array' and jsonb_array_length(revealed_fact_ids) <= 200
     and jsonb_typeof(variation) = 'object' and octet_length(variation::text) <= 4000
     and (debrief is null or (jsonb_typeof(debrief) = 'object' and octet_length(debrief::text) <= 20000)));

comment on table individual_scholar_case_session is
  'COMPETEN-SCHOLAR-CLINICAL-REASONING-01 (435, 436). One playing of a student''s own private case: ids of what was reached and revealed, never copies of governed facts. view_salt is server-only. Library cases are played on case_library_session (423).';

notify pgrst, 'reload schema';
