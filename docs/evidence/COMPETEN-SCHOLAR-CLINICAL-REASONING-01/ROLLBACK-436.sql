-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 436 (COMPETEN-SCHOLAR-CLINICAL-REASONING-01). Restores the 435 shape of
-- individual_scholar_case_session: a private case XOR a library version.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- !! No data is lost: every session is a private one, and the restored column starts empty.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

alter table individual_scholar_case_session drop constraint if exists individual_scholar_case_session_check;
alter table individual_scholar_case_session add column if not exists library_version_id uuid references case_library_version(id) on delete restrict;
alter table individual_scholar_case_session alter column private_case_id drop not null;
alter table individual_scholar_case_session add constraint individual_scholar_case_session_check
  check (((private_case_id is null) <> (library_version_id is null))
     and mode in ('guided', 'independent')
     and status in ('active', 'completed')
     and ((status = 'completed') = (completed_at is not null))
     and view_salt ~ '^[A-Za-z0-9_-]{22,64}$'
     and (current_stage_id is null or current_stage_id ~ '^[a-z][a-z0-9_-]{0,30}$')
     and jsonb_typeof(reached_stage_ids) = 'array' and jsonb_array_length(reached_stage_ids) <= 50
     and jsonb_typeof(revealed_fact_ids) = 'array' and jsonb_array_length(revealed_fact_ids) <= 200
     and jsonb_typeof(variation) = 'object' and octet_length(variation::text) <= 4000
     and (debrief is null or (jsonb_typeof(debrief) = 'object' and octet_length(debrief::text) <= 20000)));
create index if not exists idx_individual_scholar_case_session_library
  on individual_scholar_case_session(library_version_id);

notify pgrst, 'reload schema';
