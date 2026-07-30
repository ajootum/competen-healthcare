-- 154: HWW-MED-001 - Medication Coordination & Administration engine.
-- OPERATIONAL medication coordination, explicitly NOT an EMR and NOT electronic prescribing: the schedule
-- row carries only what a nurse needs operationally (drug name, dose DISPLAY string as supplied by source,
-- route, due time, high-risk / double-check / allergy flags). Administration events capture the five-rights
-- safety checks, the outcome (administered / delayed / omitted), delay minutes, an optional witness for
-- configured double-checks, and the auto-raised op_escalation when a delay breaches thresholds.
-- Status model (spec S5): scheduled -> due -> in_progress -> administered | delayed | overdue | escalated |
-- cancelled. due/overdue are DERIVED at read time from scheduled_at (no cron needed); the stored status
-- changes only on real actions. An omitted outcome closes its schedule row as cancelled (the omission event
-- itself is the durable record).
-- Tenancy: rows belong to the PATIENT's hospital (subject-scoped). Plain, idempotent statements only
-- (no do-blocks). RLS = authenticated read; service-role writes.

create table if not exists op_med_schedule (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid references hospitals(id) on delete cascade,
  department_id uuid references departments(id) on delete set null,
  unit_id       uuid references units(id) on delete set null,
  patient_id    uuid not null references op_patients(id) on delete cascade,
  drug_name     text not null,
  dose_display  text,                                       -- display only, as supplied by source
  route         text not null default 'oral'
                  check (route in ('oral','iv','im','sc','topical','inhaled','nebulised','pr','sl','ng','peg','other')),
  scheduled_at  timestamptz not null,
  high_risk     boolean not null default false,
  requires_double_check boolean not null default false,
  allergy_note  text,                                       -- operational allergy alert display
  status        text not null default 'scheduled'
                  check (status in ('scheduled','due','in_progress','administered','delayed','overdue','escalated','cancelled')),
  source        text not null default 'manual',             -- manual today; EMR feed later
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists op_med_administrations (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid references hospitals(id) on delete cascade,
  schedule_id   uuid not null references op_med_schedule(id) on delete cascade,
  patient_id    uuid not null references op_patients(id) on delete cascade,
  shift_id      uuid references op_shifts(id) on delete set null,
  outcome       text not null check (outcome in ('administered','delayed','omitted')),
  administered_by uuid references profiles(id) on delete set null,
  administered_by_name text,
  administered_at timestamptz not null default now(),
  delay_minutes int not null default 0 check (delay_minutes >= 0),
  reason        text,                                       -- required for delayed/omitted (engine-enforced)
  safety_checks jsonb not null default '{}'::jsonb,         -- five-rights checklist as captured
  witness_id    uuid references profiles(id) on delete set null,
  witness_name  text,
  escalation_id uuid references op_escalations(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_op_med_schedule_patient on op_med_schedule(patient_id, scheduled_at);
create index if not exists idx_op_med_schedule_hosp    on op_med_schedule(hospital_id, status, scheduled_at);
create index if not exists idx_op_med_admin_schedule   on op_med_administrations(schedule_id);
create index if not exists idx_op_med_admin_patient    on op_med_administrations(patient_id, administered_at desc);
create index if not exists idx_op_med_admin_actor      on op_med_administrations(administered_by, administered_at desc);

alter table op_med_schedule enable row level security;
alter table op_med_administrations enable row level security;
drop policy if exists op_med_schedule_read on op_med_schedule;
create policy op_med_schedule_read on op_med_schedule for select to authenticated using (true);
drop policy if exists op_med_administrations_read on op_med_administrations;
create policy op_med_administrations_read on op_med_administrations for select to authenticated using (true);

notify pgrst, 'reload schema';
