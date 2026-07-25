-- 101: Operational Performance & Capacity Management (UMW-OPC-000) — the manager-lens stores the strategic
-- Operations & Capacity dashboard needs beyond the live SSW stores (op_beds / op_flow_blockers already exist).
-- op_ops_snapshots holds daily + monthly operational aggregates (occupancy / LOS / admissions / discharges /
-- escalation / capacity score / discharge delay + the workforce establishment FTEs + the top operational metrics)
-- so KPIs, month-over-month deltas and the trend charts are real. op_equipment + op_resources back the equipment-
-- readiness and resource-availability panels. Idempotent; RLS service-role only (reads via the admin client behind
-- the hospital_admin/super_admin-gated UMW surface), mirroring the config stores.

create table if not exists op_ops_snapshots (
  id                         uuid primary key default gen_random_uuid(),
  hospital_id                uuid references hospitals(id) on delete cascade,
  period                     date not null,
  period_type                text not null default 'day' check (period_type in ('day','month')),
  occupancy_pct              numeric,
  avg_los                    numeric,
  admissions                 int default 0,
  discharges                 int default 0,
  escalation_rate            numeric,
  capacity_score             int,
  avg_discharge_delay_hours  numeric,
  bed_turnover               numeric,
  discharge_before_noon_pct  int,
  ed_boarding_hours          numeric,
  readmission_rate           numeric,
  theatre_utilisation        int,
  required_fte               numeric,
  available_fte              numeric,
  vacant_fte                 numeric,
  agency_fte                 numeric,
  safe_staffing_score        int,
  created_at                 timestamptz not null default now(),
  unique (hospital_id, period, period_type)
);
create index if not exists idx_ops_snap on op_ops_snapshots(hospital_id, period_type, period);

create table if not exists op_equipment (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  name        text not null,
  category    text,
  status      text not null default 'operational'
                check (status in ('operational','under_maintenance','out_of_service','calibration_due')),
  created_at  timestamptz not null default now()
);
create index if not exists idx_op_equipment_hosp on op_equipment(hospital_id, status);

create table if not exists op_resources (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  name        text not null,
  category    text not null check (category in ('theatre','procedure_room','treatment_room','transport','wheelchair','other')),
  total       int not null default 1,
  available   int not null default 0,
  demand      text not null default 'available' check (demand in ('available','busy','high','low')),
  created_at  timestamptz not null default now()
);
create index if not exists idx_op_resources_hosp on op_resources(hospital_id);

alter table op_ops_snapshots enable row level security;
alter table op_equipment enable row level security;
alter table op_resources enable row level security;
-- No client policies on purpose: reads go through the service-role admin client behind the gated UMW surface.
