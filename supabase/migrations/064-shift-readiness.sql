-- 064: Shift Operations Engine — pre-shift readiness records (SSW-002 §6.4).
-- The formal pre-shift safety/operational preparedness checklist for a shift
-- instance. This is what turns the activation gate from inferred preconditions
-- into an explicit, auditable sign-off: SSW-002 §10.1 blocks activation while
-- mandatory readiness items are incomplete. One row per (shift, item_code);
-- the item catalogue lives in code (lib/operations/readiness.ts) so it can
-- evolve without a migration. Idempotent; RLS-locked to the service role
-- (writes go through the audited /api/operations/readiness route).

create table if not exists shift_readiness_records (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references op_shifts(id) on delete cascade,
  hospital_id uuid references hospitals(id) on delete cascade,
  item_code text not null,                       -- validated against the code catalogue
  status text not null default 'pending'
    check (status in ('pending','complete','exception','not_applicable')),
  responsible_user_id uuid references profiles(id) on delete set null,
  responsible_name text,
  completed_at timestamptz,
  exception_reason text,                          -- required when status = 'exception'
  escalation_required boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shift_id, item_code)
);

create index if not exists idx_shift_readiness_shift on shift_readiness_records(shift_id);
create index if not exists idx_shift_readiness_status on shift_readiness_records(status);

alter table shift_readiness_records enable row level security;
-- No client policies on purpose: reads/writes go through the service-role
-- admin client behind the audited, role-gated readiness API route.
