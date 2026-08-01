-- ============================================================
-- MIGRATION 184: CLINICAL PROCEDURES (HWW-UI-005 s1)
--
-- The Procedures module was a greyed-out sidebar row with `soon: true` and no href. HWW-UI-005 s1 says to
-- remove the disabled state and always show it as active. Making the row clickable without a store behind
-- it would just move the dead end one click further in, so this is the store.
--
-- Measured first: no procedures table existed anywhere in 183 migrations. This is genuinely new, not a
-- rename of something already there.
--
-- WHY THE SAFETY COLUMNS ARE NOT OPTIONAL EXTRAS. site, laterality and consent_obtained are here because
-- wrong-site and non-consented procedures are exactly what a procedure record exists to prevent; a table
-- that captured only "what" and "when" would be an activity log wearing a clinical record's name. They are
-- NULLABLE because most procedures have no laterality and forcing 'not applicable' into every row teaches
-- people to click past the field that matters on the day it does.
--
-- status covers the whole arc including `abandoned` -- a procedure started and stopped is a clinical event
-- with a reason, and collapsing it into "not completed" loses the reason.
--
-- RLS: enabled with NO client policies -- the service-role-only pattern from migration 074. Readers go
-- through the API, which enforces role and tenant scope in code.
--
-- Plain statements, idempotent, no do-blocks, ASCII only.
-- ============================================================

create table if not exists op_procedures (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid not null references hospitals(id) on delete cascade,
  patient_id        uuid references op_patients(id) on delete cascade,
  shift_id          uuid references op_shifts(id) on delete set null,
  department_id     uuid references departments(id) on delete set null,
  procedure_code    text,
  procedure_name    text not null,
  category          text not null default 'clinical' check (category in ('clinical', 'non_clinical')),
  status            text not null default 'due'
                      check (status in ('planned', 'due', 'in_progress', 'completed', 'abandoned')),
  scheduled_for     timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  performed_by      uuid references profiles(id) on delete set null,
  performed_by_name text,
  assisted_by       uuid references profiles(id) on delete set null,
  site              text,
  laterality        text check (laterality is null or laterality in ('left', 'right', 'bilateral', 'not_applicable')),
  consent_obtained  boolean,
  outcome           text,
  complications     text,
  notes             text,
  created_by        uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_op_procedures_patient  on op_procedures(patient_id, scheduled_for desc);
create index if not exists idx_op_procedures_shift    on op_procedures(shift_id, status);
create index if not exists idx_op_procedures_hospital on op_procedures(hospital_id, status, scheduled_for desc);
create index if not exists idx_op_procedures_performer on op_procedures(performed_by, completed_at desc);

alter table op_procedures enable row level security;

notify pgrst, 'reload schema';
