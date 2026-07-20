-- Migration 039: Clinical Operations Engine — Observation domain (COE §5.9)
-- Scheduled/recorded patient observations (vitals, PEWS, GCS, ...). A recorded
-- observation whose EWS score or concern flag breaches threshold auto-creates an
-- op_escalation. Operational only — findings are an operational snapshot, not the
-- EMR record. Tenant-scoped; the op_tasks table (Task domain) already exists from 038.

create table if not exists op_observations (
  id                   uuid primary key default gen_random_uuid(),
  hospital_id          uuid not null references hospitals(id) on delete cascade,
  patient_id           uuid not null references op_patients(id) on delete cascade,
  department_id        uuid references departments(id) on delete set null,
  shift_id             uuid references op_shifts(id) on delete set null,
  observation_type     text not null default 'vital_signs'
                         check (observation_type in ('vital_signs','neuro','respiratory','cardiovascular','fluid_balance','pain','sedation','pews','gcs','specialty')),
  status               text not null default 'due' check (status in ('due','recorded','overdue','missed')),
  scheduled_for        timestamptz,
  due_at               timestamptz,
  recorded_at          timestamptz,
  observer_id          uuid references profiles(id) on delete set null,
  findings             jsonb not null default '{}'::jsonb,   -- free operational snapshot (e.g. {"rr":22,"spo2":94})
  ews_score            int,                                   -- early-warning score (0–20)
  concern              boolean not null default false,        -- clinician "cause for concern" flag
  escalation_triggered boolean not null default false,
  escalation_id        uuid references op_escalations(id) on delete set null,
  validation_status    text not null default 'pending' check (validation_status in ('pending','validated')),
  created_by           uuid references profiles(id),
  created_at           timestamptz not null default now()
);

-- Track who completed a task, so a coordinator cannot verify a task they performed
-- themselves (separation of duties). op_tasks is from migration 038.
alter table op_tasks add column if not exists completed_by uuid references profiles(id) on delete set null;

create index if not exists idx_op_obs_patient on op_observations(patient_id);
create index if not exists idx_op_obs_hosp on op_observations(hospital_id, status);
create index if not exists idx_op_obs_due on op_observations(due_at);

alter table op_observations enable row level security;
drop policy if exists op_observations_read on op_observations;
create policy op_observations_read on op_observations for select to authenticated using (true);
