-- 073: Quality, Safety & Escalation Centre (SSW-QSE-001) — incident register &
-- quality-improvement (CAPA) stores. op_incidents is the incident/near-miss
-- register with an investigation lifecycle; op_quality_actions covers CAPA, audit
-- actions, PDSA cycles, improvement projects, RCA and policy review. Observation
-- compliance, escalations, safety alerts and patient risk reuse the existing
-- op_observations / op_escalations / op_safety_alerts / op_patients tables.
-- Idempotent; RLS service-role only (writes via audited APIs).

create table if not exists op_incidents (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
  shift_id uuid references op_shifts(id) on delete set null,
  incident_type text not null default 'other'
    check (incident_type in ('medication','falls','equipment','pressure_injury','infection','behaviour','documentation','sentinel','other')),
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  near_miss boolean not null default false,
  patient_id uuid references op_patients(id) on delete set null,
  description text not null,
  status text not null default 'reported'
    check (status in ('reported','investigating','awaiting_action','closed')),
  corrective_action text,
  reported_by uuid references profiles(id) on delete set null,
  reported_by_name text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_op_incidents_hospital on op_incidents(hospital_id, status, created_at desc);

create table if not exists op_quality_actions (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
  shift_id uuid references op_shifts(id) on delete set null,
  action_type text not null default 'capa'
    check (action_type in ('capa','audit_action','pdsa','improvement_project','rca','policy_review')),
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  status text not null default 'open' check (status in ('open','in_progress','overdue','completed')),
  owner_id uuid references profiles(id) on delete set null,
  owner_name text,
  due_at timestamptz,
  completed_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_op_quality_actions_hospital on op_quality_actions(hospital_id, action_type, status);

alter table op_incidents enable row level security;
alter table op_quality_actions enable row level security;
-- No client policies on purpose: reads/writes go through the service-role admin
-- client behind audited, role-gated API routes.
