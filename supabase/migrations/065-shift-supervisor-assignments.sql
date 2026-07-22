-- 065: Shift Operations Engine — supervisor assignments & confirmation (SSW-002
-- §6.3 / §8 / §9.2). Records who is assigned to command a shift and whether they
-- have confirmed. This is the command-ownership backbone: §8 requires exactly one
-- accountable command owner per active shift, and §9.5 establishes that owner on
-- activation. Confirming a PRIMARY assignment sets the shift's command owner
-- (op_shifts.supervisor_id) and satisfies the supervisor_confirmed readiness item.
-- Replacement preserves history via active_status (soft-deactivate, §9.2).
-- Idempotent; RLS-locked to the service role (writes via the audited API).

create table if not exists shift_supervisor_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references op_shifts(id) on delete cascade,
  hospital_id uuid references hospitals(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,   -- the assigned supervisor
  assignment_type text not null default 'primary'
    check (assignment_type in ('primary','deputy','acting','outgoing','incoming','escalation')),
  assignment_source text not null default 'manual'
    check (assignment_source in ('roster','manual','emergency','shift_swap','transfer','recommendation')),
  assigned_by uuid references profiles(id) on delete set null,
  assigned_by_name text,
  assigned_at timestamptz not null default now(),
  confirmation_status text not null default 'pending'
    check (confirmation_status in ('pending','confirmed','declined')),
  confirmed_at timestamptz,
  declined_reason text,
  replacement_of uuid references shift_supervisor_assignments(id) on delete set null,
  active_status boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shift_sup_shift on shift_supervisor_assignments(shift_id);
create index if not exists idx_shift_sup_user on shift_supervisor_assignments(user_id);
-- One accountable command owner per shift (SSW-002 §8 / §17.2): at most one
-- ACTIVE primary assignment per shift. Replacements deactivate the prior primary.
create unique index if not exists ux_shift_primary_supervisor
  on shift_supervisor_assignments(shift_id) where assignment_type = 'primary' and active_status;

alter table shift_supervisor_assignments enable row level security;
-- No client policies on purpose: reads/writes go through the service-role admin
-- client behind the audited, role-gated supervisor-assignment API route.
