-- ====================================================================================================
-- 302  EXTERNAL PROCEDURES  (CPR-PCA-HFE-012 s13)
-- ====================================================================================================
--
-- WHAT THIS DOES
--   One new table: practice_external_procedure -- a procedure the practitioner performed OUTSIDE this
--   practice (another hospital, a mission, before joining), recorded explicitly for the longitudinal
--   portfolio. It projects into the Procedures & Clinical Activity record beside the encounter
--   procedures, wearing external provenance.
--
-- WARNING: A SIBLING TABLE, DELIBERATELY -- NOT A LOOSENED practice_procedure.
--   The alternative was making encounter_id and patient_id nullable on practice_procedure. Refused
--   three times over. Migration 197 makes both NOT NULL on purpose (a clinical procedure lives in a
--   patient's record), and every clinical read since assumes it. s13 itself orders that portfolio
--   entries must not silently alter the patient encounter record -- separation by TABLE makes that
--   impossible rather than merely intended. And the activity harness proves duplicate protection
--   STRUCTURALLY (no procedure rows exist outside practice_procedure's projection) -- this table keeps
--   that proof honest because its rows carry their own provenance instead of impersonating encounter
--   work.
--
-- WARNING: NOT A NEW KIND ON practice_clinical_activity EITHER. The spec's s9 is explicit that an
--   external procedure is Type: Procedure in the record, not an activity category -- and the activity
--   table's kind list deliberately contains no procedure entry, which is what makes the projection
--   provable as a read.
--
-- WARNING: COLUMNS THE SPEC COULD SUGGEST THAT ARE DELIBERATELY ABSENT, AND WHY.
--   complication state   this product never observed the procedure. A complication column here would
--                        let an external row render as complication-free, which is an assessment claim
--                        with nothing behind it -- s15 demands recorded-none be distinguishable from
--                        not-assessed, and the surest way is that the column does not exist. The UI
--                        says "not assessed here".
--   outcome enum         same reason. detail is free text the practitioner owns.
--   patient linkage      the patient of an external procedure is not this practice's patient. A
--                        patient_id column would invite linking another institution's care into this
--                        practice's records.
--   duration_minutes     practice_procedure carries none either. CPD is capped absolutely instead.
--
-- WARNING: s13's IDEMPOTENCY IS A FULL UNIQUE INDEX, NOT A PARTIAL ONE. source_ref (a logbook or
--   operation-note reference) is optional, so the index folds rowless refs through the row's own id
--   via coalesce -- rows without a reference never collide, rows with one are unique PER PERSON, and
--   the partial-unique upsert trap this codebase has recorded twice does not apply. Uniqueness is
--   per person, not per practice: the portfolio belongs to the person, and the same logbook entry
--   typed in two practices is still one procedure.
--
-- WARNING: performed_at IS NOT NULL. The record counts work DONE, never work intended -- the same rule
--   the projection enforces on encounter procedures by excluding SCHEDULED rows. There is no scheduled
--   external procedure.
--
-- No new capability. Recording an external procedure is gated by procedure.record, the same capability
-- that gates the page and the activity log -- the engine enforces it.
-- ====================================================================================================

create table if not exists practice_external_procedure (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  performed_by uuid not null,
  label text not null,
  source text not null,
  source_ref text,
  role text not null default 'operator',
  detail text,
  performed_at timestamptz not null,
  cpd_minutes integer,
  portfolio boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table practice_external_procedure drop constraint if exists practice_ext_proc_label_check;
alter table practice_external_procedure add constraint practice_ext_proc_label_check
  check (char_length(btrim(label)) between 3 and 200);

alter table practice_external_procedure drop constraint if exists practice_ext_proc_source_check;
alter table practice_external_procedure add constraint practice_ext_proc_source_check
  check (char_length(btrim(source)) between 3 and 200);

alter table practice_external_procedure drop constraint if exists practice_ext_proc_source_ref_check;
alter table practice_external_procedure add constraint practice_ext_proc_source_ref_check
  check (source_ref is null or char_length(btrim(source_ref)) between 1 and 120);

alter table practice_external_procedure drop constraint if exists practice_ext_proc_role_check;
alter table practice_external_procedure add constraint practice_ext_proc_role_check
  check (role in ('operator', 'assistant', 'anaesthetist', 'scrub', 'observer', 'supervisor', 'other'));

alter table practice_external_procedure drop constraint if exists practice_ext_proc_detail_check;
alter table practice_external_procedure add constraint practice_ext_proc_detail_check
  check (detail is null or char_length(detail) <= 2000);

alter table practice_external_procedure drop constraint if exists practice_ext_proc_cpd_check;
alter table practice_external_procedure add constraint practice_ext_proc_cpd_check
  check (cpd_minutes is null or (cpd_minutes >= 0 and cpd_minutes <= 1440));

create unique index if not exists ux_practice_ext_proc_source_ref
  on practice_external_procedure (performed_by,
    coalesce(nullif(lower(btrim(source_ref)), ''), id::text));

create index if not exists idx_practice_ext_proc_person
  on practice_external_procedure (workspace_id, performed_by, performed_at desc);

alter table practice_external_procedure enable row level security;

notify pgrst, 'reload schema';
