-- 068: Shift Operations Engine — persisted shift metrics (SSW-002 §19). The engine
-- already derives shift KPIs live; this table persists them per shift (one row,
-- upserted) so historical dashboards can trend performance ACROSS shifts rather
-- than recalculating (§18 principle). Metrics with no reliable backing yet
-- (activation timeliness, alert-ack / escalation-response durations) are omitted
-- rather than stored as fabricated values. Idempotent; RLS service-role only.

create table if not exists shift_metrics (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references op_shifts(id) on delete cascade,
  hospital_id uuid references hospitals(id) on delete cascade,
  bed_occupancy_pct int,
  staffing_present int,
  staffing_rostered int,
  skill_mix_compliance_pct int,
  observation_compliance_pct int,
  task_completion_pct int,
  high_acuity_count int,
  incident_count int,
  open_escalations int,
  admissions int,
  transfers int,
  discharges int,
  overall_score int,
  metrics jsonb,                                   -- full KPI payload
  computed_by uuid references profiles(id) on delete set null,
  computed_by_name text,
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shift_id)
);
create index if not exists idx_shift_metrics_hospital on shift_metrics(hospital_id, computed_at desc);

alter table shift_metrics enable row level security;
-- No client policies on purpose: reads/writes go through the service-role admin
-- client behind the audited, role-gated shift-metrics API route.
