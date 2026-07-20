-- Migration 038: Clinical Operations Engine (COE-001, Phase 1 — Core Structures)
-- The operational domain model: shifts, staff-on-shift, beds/capacity, operational
-- patients, competency-validated patient assignments, escalations, safety alerts,
-- handovers and clinical tasks. Operational only — this is NOT an EMR; patients
-- are stored as operational objects (location/acuity/status), never clinical
-- documentation. Everything is tenant-scoped (hospital_id) and wired to the
-- existing profiles/hospitals/departments/units. Writes go through the
-- service-role API layer (in-code role + tenant enforcement); RLS is defence-in-depth.

-- ── Beds (Capacity domain) — a physical bed in a unit
create table if not exists op_beds (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references hospitals(id) on delete cascade,
  unit_id       uuid references units(id) on delete set null,
  department_id uuid references departments(id) on delete set null,
  label         text not null,                       -- e.g. "Bay A-3"
  bed_type      text not null default 'standard'
                  check (bed_type in ('standard','critical_care','isolation','paediatric','theatre','recovery','overflow')),
  status        text not null default 'available'
                  check (status in ('available','occupied','reserved','out_of_service','cleaning')),
  created_at    timestamptz not null default now(),
  unique (hospital_id, label)
);

-- ── Clinical Shift (Shift domain)
create table if not exists op_shifts (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references hospitals(id) on delete cascade,
  department_id uuid references departments(id) on delete set null,
  unit_id       uuid references units(id) on delete set null,
  shift_type    text not null default 'day' check (shift_type in ('day','evening','night','long_day','on_call')),
  shift_date    date not null default current_date,
  starts_at     timestamptz,
  ends_at       timestamptz,
  supervisor_id uuid references profiles(id) on delete set null,
  status        text not null default 'planned' check (status in ('planned','active','completed','cancelled')),
  notes         text,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);

-- ── Shift Staff (Workforce deployed onto a shift)
create table if not exists op_shift_staff (
  id         uuid primary key default gen_random_uuid(),
  shift_id   uuid not null references op_shifts(id) on delete cascade,
  staff_id   uuid not null references profiles(id) on delete cascade,
  role       text not null default 'nurse' check (role in ('charge','nurse','support','float','educator','assessor','doctor','therapist')),
  status     text not null default 'assigned' check (status in ('assigned','confirmed','on_duty','off_duty','absent')),
  created_at timestamptz not null default now(),
  unique (shift_id, staff_id)
);

-- ── Operational Patient (Patient Operations domain — operational object, NOT EMR)
create table if not exists op_patients (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references hospitals(id) on delete cascade,
  department_id      uuid references departments(id) on delete set null,
  unit_id            uuid references units(id) on delete set null,
  bed_id             uuid references op_beds(id) on delete set null,
  label              text not null,                 -- operational identifier (e.g. initials / bed alias), never full PHI
  patient_ref        text,                          -- optional EMR reference
  acuity_level       text not null default 'stable' check (acuity_level in ('stable','moderate','high','critical')),
  dependency_level   text not null default 'level_1' check (dependency_level in ('level_0','level_1','level_2','level_3')),
  isolation_status   text not null default 'none' check (isolation_status in ('none','contact','droplet','airborne','protective')),
  risk_level         text not null default 'low' check (risk_level in ('low','medium','high')),
  operational_status text not null default 'admitted' check (operational_status in ('expected','admitted','transfer_pending','discharge_pending','discharged')),
  created_by         uuid references profiles(id),
  created_at         timestamptz not null default now()
);

-- ── Patient Assignment (Assignment domain — competency-validated staff↔patient)
create table if not exists op_patient_assignments (
  id                   uuid primary key default gen_random_uuid(),
  hospital_id          uuid not null references hospitals(id) on delete cascade,
  patient_id           uuid not null references op_patients(id) on delete cascade,
  staff_id             uuid not null references profiles(id) on delete cascade,
  shift_id             uuid references op_shifts(id) on delete set null,
  assignment_type      text not null default 'primary' check (assignment_type in ('primary','supporting')),
  competency_validated boolean not null default false,
  override_reason      text,
  status               text not null default 'active' check (status in ('active','ended')),
  started_at           timestamptz not null default now(),
  ended_at             timestamptz,
  created_by           uuid references profiles(id)
);

-- ── Operational Escalation (Escalation domain — 5 levels)
create table if not exists op_escalations (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid not null references hospitals(id) on delete cascade,
  unit_id           uuid references units(id) on delete set null,
  patient_id        uuid references op_patients(id) on delete set null,
  shift_id          uuid references op_shifts(id) on delete set null,
  escalation_type   text not null default 'clinical',
  level             int not null default 1 check (level between 1 and 5),
  severity          text not null default 'routine' check (severity in ('routine','urgent','high','emergency','critical')),
  summary           text not null,
  raised_by         uuid references profiles(id),
  assigned_responder uuid references profiles(id) on delete set null,
  response_deadline timestamptz,
  status            text not null default 'open' check (status in ('open','acknowledged','resolved','cancelled')),
  resolution        text,
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz
);

-- ── Safety Alert (Patient Safety domain)
create table if not exists op_safety_alerts (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
  unit_id     uuid references units(id) on delete set null,
  patient_id  uuid references op_patients(id) on delete set null,
  category    text not null default 'deterioration'
                check (category in ('fall_risk','medication','pressure_injury','infection','patient_id','deterioration','device','environmental')),
  severity    text not null default 'medium' check (severity in ('low','medium','high')),
  note        text,
  active      boolean not null default true,
  owner_id    uuid references profiles(id) on delete set null,
  resolution  text,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- ── Clinical Handover (Handover domain) + items
create table if not exists op_handovers (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references hospitals(id) on delete cascade,
  unit_id       uuid references units(id) on delete set null,
  from_shift_id uuid references op_shifts(id) on delete set null,
  to_shift_id   uuid references op_shifts(id) on delete set null,
  from_clinician uuid references profiles(id) on delete set null,
  to_clinician  uuid references profiles(id) on delete set null,
  status        text not null default 'draft' check (status in ('draft','pending','accepted')),
  summary       text,
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz
);
create table if not exists op_handover_items (
  id                uuid primary key default gen_random_uuid(),
  handover_id       uuid not null references op_handovers(id) on delete cascade,
  patient_id        uuid references op_patients(id) on delete set null,
  note              text not null,
  outstanding_action text,
  priority          text not null default 'normal' check (priority in ('low','normal','high')),
  created_at        timestamptz not null default now()
);

-- ── Clinical Task (Task domain)
create table if not exists op_tasks (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references hospitals(id) on delete cascade,
  unit_id      uuid references units(id) on delete set null,
  patient_id   uuid references op_patients(id) on delete set null,
  shift_id     uuid references op_shifts(id) on delete set null,
  task_type    text not null default 'general',
  description  text not null,
  assigned_to  uuid references profiles(id) on delete set null,
  assigned_by  uuid references profiles(id) on delete set null,
  priority     text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  due_at       timestamptz,
  status       text not null default 'created' check (status in ('created','assigned','accepted','in_progress','completed','verified','cancelled')),
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- ── Indexes
create index if not exists idx_op_beds_hosp on op_beds(hospital_id);
create index if not exists idx_op_beds_unit on op_beds(unit_id);
create index if not exists idx_op_shifts_hosp on op_shifts(hospital_id, shift_date);
create index if not exists idx_op_shifts_unit on op_shifts(unit_id);
create index if not exists idx_op_shift_staff_shift on op_shift_staff(shift_id);
create index if not exists idx_op_shift_staff_staff on op_shift_staff(staff_id);
create index if not exists idx_op_patients_hosp on op_patients(hospital_id);
create index if not exists idx_op_patients_unit on op_patients(unit_id);
create index if not exists idx_op_pa_patient on op_patient_assignments(patient_id);
create index if not exists idx_op_pa_staff on op_patient_assignments(staff_id);
create index if not exists idx_op_esc_hosp on op_escalations(hospital_id, status);
create index if not exists idx_op_safety_hosp on op_safety_alerts(hospital_id, active);
create index if not exists idx_op_handovers_hosp on op_handovers(hospital_id);
create index if not exists idx_op_tasks_hosp on op_tasks(hospital_id, status);

-- ── RLS (defence-in-depth; API enforces role + tenant via the service role)
do $$
declare t text;
begin
  foreach t in array array['op_beds','op_shifts','op_shift_staff','op_patients','op_patient_assignments','op_escalations','op_safety_alerts','op_handovers','op_handover_items','op_tasks']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select to authenticated using (true)', t, t);
  end loop;
end $$;
