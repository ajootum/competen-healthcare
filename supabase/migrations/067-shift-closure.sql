-- 067: Shift Operations Engine — snapshots & command transfer (SSW-002 §18 / §8).
-- shift_snapshots preserves an immutable point-in-time capture of operational
-- state (activation or closure) so historical dashboards read from snapshots and
-- events rather than recalculating from live records (§18). command_transfer_records
-- captures who accepted operational command for the next shift (§8 / vision Q10).
-- Accepting a transfer updates the shift's command owner. Idempotent; RLS
-- service-role only (writes via audited APIs).

create table if not exists shift_snapshots (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references op_shifts(id) on delete cascade,
  hospital_id uuid references hospitals(id) on delete cascade,
  kind text not null default 'closure' check (kind in ('activation','closure','adhoc')),
  census int, occupied_beds int, total_beds int,
  present_staff int, rostered_staff int,
  open_alerts int, active_escalations int,
  open_tasks int, overdue_tasks int, completed_tasks int,
  high_risk_patients int,
  metrics jsonb,                                   -- full snapshot payload
  captured_by uuid references profiles(id) on delete set null,
  captured_by_name text,
  captured_at timestamptz not null default now(),
  immutable boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_shift_snapshot_shift on shift_snapshots(shift_id, captured_at desc);

create table if not exists command_transfer_records (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references op_shifts(id) on delete cascade,
  hospital_id uuid references hospitals(id) on delete cascade,
  from_user_id uuid references profiles(id) on delete set null,
  from_name text,
  to_user_id uuid references profiles(id) on delete set null,
  to_name text,
  reason text not null default 'scheduled_end'
    check (reason in ('scheduled_end','illness','emergency','reassignment','relief','escalation','other')),
  status text not null default 'initiated'
    check (status in ('initiated','accepted','rejected','cancelled')),
  outstanding_summary text,                        -- outstanding risks/tasks presented at transfer
  initiated_by uuid references profiles(id) on delete set null,
  initiated_at timestamptz not null default now(),
  accepted_at timestamptz,
  rejected_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_command_transfer_shift on command_transfer_records(shift_id, initiated_at desc);

alter table shift_snapshots enable row level security;
alter table command_transfer_records enable row level security;
-- No client policies on purpose: reads/writes go through the service-role admin
-- client behind audited, role-gated API routes.
