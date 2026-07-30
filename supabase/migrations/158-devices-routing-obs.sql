-- 158: three small HWW gap-closers.
--   1. op_patient_devices (HWW-ICU-001 S4 Critical Devices tracker, ward-relevant too): indwelling devices
--      and lines with insertion/removal timestamps so LINE-DAYS are computable (IPC practice: long-dwelling
--      central lines and catheters get review prompts). Operational tracker only - insertion documentation
--      stays in the clinical record.
--   2. op_concern_routings (HWW-ADD-001B): the multi-hop RoutingDecision HISTORY for nurse concerns - every
--      routing decision is retained (the concern row keeps only the CURRENT destination). Same 8-value
--      destination enum as migration 152.
--   3. op_observations gains the OBS-001 post-event types (post_procedure, post_medication) via a widened
--      check constraint (drop-then-add, re-runnable; existing rows unaffected).
-- Tenancy: rows belong to the PATIENT's hospital. Plain idempotent statements only (no do-blocks).
-- RLS = authenticated read; service-role writes.

create table if not exists op_patient_devices (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid references hospitals(id) on delete cascade,
  patient_id   uuid not null references op_patients(id) on delete cascade,
  device_type  text not null check (device_type in
                 ('central_line','peripheral_iv','arterial_line','urinary_catheter','ng_tube','peg_tube',
                  'chest_drain','wound_drain','tracheostomy','ett','other')),
  site         text,
  inserted_at  timestamptz not null default now(),
  inserted_by  uuid references profiles(id) on delete set null,
  inserted_by_name text,
  removed_at   timestamptz,
  removed_by   uuid references profiles(id) on delete set null,
  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_op_devices_patient on op_patient_devices(patient_id, removed_at);
create index if not exists idx_op_devices_hosp    on op_patient_devices(hospital_id, inserted_at desc);

create table if not exists op_concern_routings (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid references hospitals(id) on delete cascade,
  concern_id     uuid not null references op_concerns(id) on delete cascade,
  routed_to      text not null check (routed_to in
                   ('doctor','medical_team','specialty','subspecialty','on_call','shift_supervisor','allied_health','quality')),
  routed_by      uuid references profiles(id) on delete set null,
  routed_by_name text,
  routed_at      timestamptz not null default now(),
  acknowledged_by uuid references profiles(id) on delete set null,
  acknowledged_at timestamptz,
  note           text
);

create index if not exists idx_op_concern_routings_c on op_concern_routings(concern_id, routed_at desc);

alter table op_observations drop constraint if exists op_observations_observation_type_check;
alter table op_observations add constraint op_observations_observation_type_check
  check (observation_type in ('vital_signs','neuro','respiratory','cardiovascular','fluid_balance','pain',
                              'sedation','pews','gcs','specialty','post_procedure','post_medication'));

alter table op_patient_devices enable row level security;
alter table op_concern_routings enable row level security;
drop policy if exists op_patient_devices_read on op_patient_devices;
create policy op_patient_devices_read on op_patient_devices for select to authenticated using (true);
drop policy if exists op_concern_routings_read on op_concern_routings;
create policy op_concern_routings_read on op_concern_routings for select to authenticated using (true);

notify pgrst, 'reload schema';
