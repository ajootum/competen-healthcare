-- 083: Workforce Availability & Attendance stores (UMW-WFM-005). Adds the stores the module's
-- next-phase tabs need, so that attendance can move beyond current-shift state (op_shift_staff)
-- to timestamps, corrections, leave classification, declared availability, replacement workflow
-- and a stateful attendance-exception register. Maps the spec's §35 core entities onto op_
-- tables keyed to the existing op_shifts / op_shift_staff / profiles (no parallel staff model).
--
-- Key rules baked into the schema:
--   • Attendance events are an APPEND-ONLY log — no hard deletes by operational users (BR-ATT-010).
--   • A manual correction is a SEPARATE record and never overwrites the original (§12.1 / BR-ATT-003).
--   • Leave/absence carries only operational fields — no free-text medical detail (§15.4 / privacy).
--   • A replacement candidate's eligibility (competency/credential/working-hour) is enforced by the
--     API before offer (BR-ATT-005); this store records the workflow, not the clinical assessment.
--
-- Idempotent; RLS enabled, service-role only (no client policies) — reads/writes go through the
-- audited, role-gated APIs, matching migrations 080 / 082.

-- ── op_attendance_events — append-only attendance event log (§35 AttendanceEvent/CheckIn/Out) ─
-- Enables check-in/out timestamps, minutes-late detection and the longitudinal history profile.
create table if not exists op_attendance_events (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references hospitals(id) on delete cascade,
  shift_id           uuid references op_shifts(id) on delete set null,
  shift_staff_id     uuid references op_shift_staff(id) on delete set null,
  staff_id           uuid references profiles(id) on delete set null,
  staff_name         text,
  department_id      uuid references departments(id) on delete set null,
  event_type         text not null check (event_type in ('check_in','check_out','status_change','absence_reported','late_flagged','early_departure','redeployed','no_show_detected','verified','disputed')),
  event_at           timestamptz not null default now(),   -- effective attendance time
  recorded_at        timestamptz not null default now(),   -- when the record was entered
  previous_status    text,
  new_status         text,
  check_in_method    text check (check_in_method in ('biometric','badge','mobile_geofence','web','qr','supervisor','manager','import','kiosk','manual_register')),
  minutes_late       int,
  actor_id           uuid references profiles(id) on delete set null,
  actor_name         text,
  actor_role         text,
  reason             text,
  source_system      text,
  location           text,
  device_meta        text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_op_att_evt_shift on op_attendance_events(shift_id, event_at);
create index if not exists idx_op_att_evt_staff on op_attendance_events(staff_id, event_at);

-- ── op_attendance_corrections — manual correction transactions (§12.1 / BR-ATT-003) ──────────
-- A correction NEVER overwrites the original attendance record; it is a separate auditable txn.
create table if not exists op_attendance_corrections (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references hospitals(id) on delete cascade,
  shift_staff_id     uuid references op_shift_staff(id) on delete set null,
  attendance_event_id uuid references op_attendance_events(id) on delete set null,
  staff_id           uuid references profiles(id) on delete set null,
  field_corrected    text not null,        -- status / arrival_time / departure_time / method / ...
  previous_value     text,
  corrected_value    text,
  effective_time     timestamptz,
  reason             text not null,
  supporting_doc     text,
  entered_by         uuid references profiles(id) on delete set null,
  entered_by_name    text,
  approver_id        uuid references profiles(id) on delete set null,
  approved_at        timestamptz,
  status             text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at         timestamptz not null default now()
);
create index if not exists idx_op_att_corr_staff on op_attendance_corrections(shift_staff_id);

-- ── op_staff_availability — declared / inferred availability (§13-14 / §19) ───────────────────
create table if not exists op_staff_availability (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references hospitals(id) on delete cascade,
  staff_id           uuid not null references profiles(id) on delete cascade,
  staff_name         text,
  availability_type  text not null default 'normal' check (availability_type in ('normal','additional','on_call','standby','redeployment','overtime','remote','partial','temporarily_unavailable','unavailable','unknown')),
  period_start       timestamptz,
  period_end         timestamptz,
  preferred_shift    text,
  restricted_shift   text,
  reason             text,
  source             text not null default 'self_declared' check (source in ('self_declared','manager_confirmed','hr_confirmed','derived_roster','derived_leave','system_inferred','imported')),
  confidence         text not null default 'unverified' check (confidence in ('unverified','manager_confirmed','hr_confirmed','verified')),
  expires_at         timestamptz,
  updated_by         uuid references profiles(id) on delete set null,
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);
create index if not exists idx_op_staff_avail_staff on op_staff_availability(staff_id, period_start);
create index if not exists idx_op_staff_avail_hospital on op_staff_availability(hospital_id, availability_type);

-- ── op_leave_records — operational leave / absence (§15) — HR admin stays in HR ───────────────
-- Operational fields only; no free-text medical detail (§15.4). Approved leave overrides a
-- roster expectation and creates a conflict if the person remains scheduled (BR-ATT-002).
create table if not exists op_leave_records (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references hospitals(id) on delete cascade,
  staff_id           uuid not null references profiles(id) on delete cascade,
  staff_name         text,
  shift_id           uuid references op_shifts(id) on delete set null,
  absence_date       date,
  absence_type       text not null default 'unknown' check (absence_type in ('sick','annual','maternity_parental','compassionate','study','official_duty','training','emergency','unpaid','suspension','occupational_restriction','administrative','unauthorised','no_show','unknown')),
  notification_at    timestamptz,
  notified_by        text,
  notification_channel text,
  expected_return    date,
  doc_status         text,
  leave_approval_status text not null default 'pending' check (leave_approval_status in ('pending','approved','rejected','not_required')),
  replacement_required boolean not null default false,
  operational_impact text,
  hr_referral_status text,
  notes              text,
  created_by         uuid references profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists idx_op_leave_staff on op_leave_records(staff_id, absence_date);
create index if not exists idx_op_leave_hospital on op_leave_records(hospital_id, absence_type);

-- ── op_replacement_requests — replacement / redeployment workflow (§17) ───────────────────────
create table if not exists op_replacement_requests (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references hospitals(id) on delete cascade,
  shift_id           uuid references op_shifts(id) on delete set null,
  absent_staff_id    uuid references profiles(id) on delete set null,
  role               text,
  quantity           int not null default 1,
  reason             text,
  priority           text not null default 'normal' check (priority in ('critical','high','normal','low')),
  origin_department_id uuid references departments(id) on delete set null,
  destination_department_id uuid references departments(id) on delete set null,
  is_redeployment    boolean not null default false,
  status             text not null default 'identified' check (status in ('identified','candidates_generated','offered','accepted','declined','filled','redeployed','cancelled','escalated')),
  selected_staff_id  uuid references profiles(id) on delete set null,
  selected_staff_name text,
  offer_expires_at   timestamptz,
  cost_estimate      int,
  releasing_manager_approved boolean not null default false,
  receiving_manager_confirmed boolean not null default false,
  duration           text,
  return_condition   text,
  requested_by       uuid references profiles(id) on delete set null,
  requested_by_name  text,
  requested_at       timestamptz not null default now(),
  resolved_at        timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists idx_op_repl_shift on op_replacement_requests(shift_id, status);
create index if not exists idx_op_repl_hospital on op_replacement_requests(hospital_id, status);

-- ── op_attendance_exceptions — stateful attendance-exception register (§18) ───────────────────
-- Disputes remain visible until resolved and retain all evidence/decisions (BR-ATT-011).
create table if not exists op_attendance_exceptions (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references hospitals(id) on delete cascade,
  shift_id           uuid references op_shifts(id) on delete set null,
  shift_staff_id     uuid references op_shift_staff(id) on delete set null,
  staff_id           uuid references profiles(id) on delete set null,
  staff_name         text,
  department_id      uuid references departments(id) on delete set null,
  category           text not null,  -- unverified/conflicting/missed_checkin/missed_checkout/manual_correction/unauthorised_absence/no_show/late/early_departure/wrong_unit/duplicate/double_assignment/roster_leave_conflict/excess_hours/insufficient_rest/unapproved_overtime/credential_restriction/disputed/integration_failure
  severity           text not null default 'moderate' check (severity in ('critical','high','moderate','low','informational')),
  status             text not null default 'new' check (status in ('new','under_review','awaiting_staff','awaiting_supervisor','awaiting_hr','awaiting_evidence','corrected','approved_exception','rejected','escalated','closed')),
  detected_at        timestamptz not null default now(),
  source_record      text,
  operational_impact text,
  rule_breached      text,
  assigned_reviewer  uuid references profiles(id) on delete set null,
  due_at             timestamptz,
  evidence           text,
  resolution_action  text,
  resolved_by        uuid references profiles(id) on delete set null,
  resolved_at        timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists idx_op_att_exc_shift on op_attendance_exceptions(shift_id, status, severity);
create index if not exists idx_op_att_exc_hospital on op_attendance_exceptions(hospital_id, status);

-- ── RLS: enable, service-role only (no client policies), matching migrations 080 / 082 ───────
alter table op_attendance_events      enable row level security;
alter table op_attendance_corrections enable row level security;
alter table op_staff_availability     enable row level security;
alter table op_leave_records          enable row level security;
alter table op_replacement_requests   enable row level security;
alter table op_attendance_exceptions  enable row level security;
