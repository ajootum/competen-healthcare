-- 066: Shift Operations Engine — safety huddles & shift decisions (SSW-002
-- §6.7 / §6.8). The pre-shift safety huddle (a structured team briefing) and the
-- material-operational-decision log (§5.4: accountable users must record
-- decisions). Both are per-shift operational records that feed the timeline and
-- audit trail. Completing a huddle satisfies the safety_huddle_prepared readiness
-- item. Idempotent; RLS-locked to the service role (writes via audited APIs).

-- One pre-shift safety huddle per shift (upserted as it is recorded/completed).
create table if not exists safety_huddles (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references op_shifts(id) on delete cascade,
  hospital_id uuid references hospitals(id) on delete cascade,
  facilitator_user_id uuid references profiles(id) on delete set null,
  facilitator_name text,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  attendance_count int not null default 0,
  patient_safety_concerns text,
  staffing_concerns text,
  operational_risks text,
  high_risk_patients text,
  equipment_issues text,
  infection_prevention_concerns text,
  planned_actions text,
  acknowledged_by_team boolean not null default false,
  completion_status text not null default 'scheduled'
    check (completion_status in ('scheduled','in_progress','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shift_id)
);
create index if not exists idx_safety_huddle_shift on safety_huddles(shift_id);

-- Material operational decisions (redeploy, surge, escalate, transfer, …).
create table if not exists shift_decisions (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references op_shifts(id) on delete cascade,
  hospital_id uuid references hospitals(id) on delete cascade,
  decision_type text not null default 'other'
    check (decision_type in ('redeploy_staff','delay_break','open_surge_capacity','escalate_patient',
      'transfer_patient','reallocate_beds','additional_observations','activate_emergency_staffing','other')),
  decision_summary text not null,
  decision_reason text,
  alternatives_considered text,
  decision_maker_user_id uuid references profiles(id) on delete set null,
  decision_maker_name text,
  authorised_by_name text,
  decided_at timestamptz not null default now(),
  affected_entities text,
  expected_outcome text,
  review_at timestamptz,
  review_outcome text,
  status text not null default 'active'
    check (status in ('active','under_review','closed','reversed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_shift_decision_shift on shift_decisions(shift_id, decided_at desc);

alter table safety_huddles enable row level security;
alter table shift_decisions enable row level security;
-- No client policies on purpose: reads/writes go through the service-role admin
-- client behind audited, role-gated API routes.
