-- 156: HWW-WARD-002 / HWW-WARD-003 - Patient Responsibility & Assignment State Engine.
-- KEY PRINCIPLE: patient responsibility transfers ONLY after the receiving healthcare worker explicitly
-- accepts. Until acceptance, accountability remains with the current assigned worker (or the supervisor for
-- unassigned patients). Three additive changes:
--   1. op_patient_assignments gains the acceptance lifecycle: new assignments enter 'pending_acceptance'
--      (they do NOT appear in My Patients or count as responsibility); the nurse accepts -> 'active' or
--      declines -> 'declined' (back to the supervisor to resolve). Existing rows keep status 'active'.
--   2. op_patient_transfers: the transfer engine record - internal (unit/room/bed) and external
--      (ICU/HDU/theatre/other hospital/diagnostic) moves, with the receiving nurse's acceptance gating the
--      ownership change and full audit fields.
--   3. op_patients gains episode-closure fields (disposition / closed_at / closed_by) - closures archive,
--      never delete (operational_status 'discharged' keeps every existing census filter correct).
-- Constraint changes use drop-then-add (Postgres has no ADD CONSTRAINT IF NOT EXISTS; drop always precedes
-- so the file stays re-runnable). Plain idempotent statements only (no do-blocks). RLS = authenticated read;
-- service-role writes.

alter table op_patient_assignments add column if not exists acceptance_status text not null default 'accepted';
alter table op_patient_assignments add column if not exists accepted_at timestamptz;
alter table op_patient_assignments add column if not exists declined_reason text;
alter table op_patient_assignments add column if not exists responded_at timestamptz;

alter table op_patient_assignments drop constraint if exists op_patient_assignments_status_check;
alter table op_patient_assignments add constraint op_patient_assignments_status_check
  check (status in ('pending_acceptance','active','declined','ended'));
alter table op_patient_assignments drop constraint if exists op_patient_assignments_acceptance_check;
alter table op_patient_assignments add constraint op_patient_assignments_acceptance_check
  check (acceptance_status in ('pending','accepted','declined'));

create index if not exists idx_op_asg_pending on op_patient_assignments(staff_id, status) where status = 'pending_acceptance';

create table if not exists op_patient_transfers (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid references hospitals(id) on delete cascade,
  patient_id         uuid not null references op_patients(id) on delete cascade,
  shift_id           uuid references op_shifts(id) on delete set null,
  transfer_type      text not null default 'internal'
                       check (transfer_type in ('internal','icu','hdu','theatre','recovery','other_ward','other_hospital','diagnostic','other')),
  from_unit_id       uuid references units(id) on delete set null,
  from_bed_id        uuid references op_beds(id) on delete set null,
  from_staff_id      uuid references profiles(id) on delete set null,   -- current responsible nurse at initiation
  to_unit_id         uuid references units(id) on delete set null,      -- internal destination
  to_bed_id          uuid references op_beds(id) on delete set null,
  to_room            text,
  destination        text,                                              -- external destination description
  receiving_staff_id uuid references profiles(id) on delete set null,   -- must accept before ownership changes
  receiving_clinician text,                                             -- external receiving clinician (optional)
  transport          text,
  reason             text not null,
  effective_at       timestamptz,
  departure_at       timestamptz,
  handover_complete  boolean not null default false,
  status             text not null default 'pending'
                       check (status in ('pending','awaiting_acceptance','completed','cancelled')),
  initiated_by       uuid references profiles(id) on delete set null,
  initiated_by_name  text,
  created_at         timestamptz not null default now(),
  accepted_at        timestamptz,
  completed_at       timestamptz,
  cancelled_reason   text
);

create index if not exists idx_op_transfers_patient   on op_patient_transfers(patient_id, status);
create index if not exists idx_op_transfers_receiving on op_patient_transfers(receiving_staff_id, status);
create index if not exists idx_op_transfers_hosp      on op_patient_transfers(hospital_id, created_at desc);

alter table op_patients add column if not exists disposition text;
alter table op_patients add column if not exists closed_at timestamptz;
alter table op_patients add column if not exists closed_by uuid references profiles(id) on delete set null;
alter table op_patients drop constraint if exists op_patients_disposition_check;
alter table op_patients add constraint op_patients_disposition_check
  check (disposition is null or disposition in ('discharged','transferred','deceased','left_ama','absconded','admission_error'));

alter table op_patient_transfers enable row level security;
drop policy if exists op_patient_transfers_read on op_patient_transfers;
create policy op_patient_transfers_read on op_patient_transfers for select to authenticated using (true);

notify pgrst, 'reload schema';
