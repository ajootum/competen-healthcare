-- 080: AI Scheduling Engine roster store (WSE-001B). Persists generated draft rosters
-- and their per-slot assignments so the AI Workforce Scheduling Engine can generate,
-- review, version and publish a real weekly roster (replacing the honest next-phase
-- preview). op_rosters is the week envelope (status draft|published|archived + safety/
-- fairness/cost scores + generation & publication audit); op_roster_assignments is one
-- row per unit × day × shift × role post (the actual staff assignment, or an uncovered
-- gap). Solver-generated from real establishment demand + available staff + competency
-- status; no staff-in-cells are fabricated — an unfilled post is stored as 'uncovered'.
-- Idempotent; RLS service-role only (writes via the audited, role-gated rosters API).

create table if not exists op_rosters (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null references hospitals(id) on delete cascade,
  week_start       date not null,
  status           text not null default 'draft' check (status in ('draft','published','archived')),
  coverage_score   int,
  competency_score int,
  fairness_score   int,
  est_cost         int,
  slots_total      int not null default 0,
  slots_filled     int not null default 0,
  generated_by     uuid references profiles(id) on delete set null,
  generated_by_name text,
  generated_at     timestamptz not null default now(),
  published_by     uuid references profiles(id) on delete set null,
  published_by_name text,
  published_at     timestamptz,
  version          int not null default 1,
  notes            text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_op_rosters_hospital on op_rosters(hospital_id, week_start, status);

create table if not exists op_roster_assignments (
  id                   uuid primary key default gen_random_uuid(),
  roster_id            uuid not null references op_rosters(id) on delete cascade,
  hospital_id          uuid references hospitals(id) on delete cascade,
  department_id        uuid references departments(id) on delete set null,
  unit_name            text,
  shift_date           date not null,
  shift_type           text not null check (shift_type in ('day','night')),
  role                 text not null,
  is_supervisor        boolean not null default false,
  staff_id             uuid references profiles(id) on delete set null,
  staff_name           text,
  competency_validated boolean not null default false,
  override_reason      text,
  status               text not null default 'assigned' check (status in ('assigned','uncovered')),
  created_at           timestamptz not null default now()
);
create index if not exists idx_op_roster_assign_roster on op_roster_assignments(roster_id, shift_date, shift_type);
create index if not exists idx_op_roster_assign_staff on op_roster_assignments(staff_id);

alter table op_rosters enable row level security;
alter table op_roster_assignments enable row level security;
-- No client policies: reads/writes go through the service-role admin client behind the
-- audited, role-gated /api/operations/rosters route.
