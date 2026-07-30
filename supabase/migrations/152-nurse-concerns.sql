-- 152: HWW-ADD-001 / HWW-ADD-001B — Nurse Concerns + ward-round coordination.
-- The structured bedside-concern record the Healthcare Worker Workspace raises and the Shift Supervisor
-- Workspace queues: category + priority + description against an operational patient, flagged for ward-round
-- discussion and/or supervisor review, carried forward across shifts until resolved. op_concern_actions holds
-- the structured Ward Round Actions that concern review produces (agreed decisions assigned back to the
-- bedside, optionally spawned as real op_tasks).
--
-- CCE routing (ADD-001B): routed_to captures the single active routing destination on the concern itself —
-- the honest minimal Clinical Coordination & Routing Engine while Doctor/Specialty/Allied workspaces do not
-- exist yet to route INTO. A full multi-hop RoutingDecision log stays future work; the enum matches the
-- ADD-001B destination table so nothing needs redesign.
--
-- Concerns are OPERATIONAL records, not medical notes (governance rule): diagnoses, prescriptions and
-- physician documentation remain in the EMR. Tenancy: rows belong to the PATIENT's hospital (subject-scoped,
-- per the tenant-scoping rule) — never the caller's.
-- Plain, idempotent statements only (no do-blocks). RLS = authenticated read; service-role writes.

create table if not exists op_concerns (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid references hospitals(id) on delete cascade,
  department_id uuid references departments(id) on delete set null,
  unit_id       uuid references units(id) on delete set null,
  patient_id    uuid not null references op_patients(id) on delete cascade,
  shift_id      uuid references op_shifts(id) on delete set null,       -- shift when raised
  category      text not null check (category in
                  ('clinical_deterioration','pain','wound','medication','nutrition','family',
                   'equipment','discharge','doctor_review','allied_health','infection_prevention','other')),
  priority      text not null default 'routine'
                  check (priority in ('routine','today','urgent','immediate')),
  description   text not null,                                          -- brief operational summary
  raised_by     uuid references profiles(id) on delete set null,
  raised_by_name text,
  raised_at     timestamptz not null default now(),
  ward_round    boolean not null default false,                         -- discuss during doctor's round
  ss_review     boolean not null default false,                         -- supervisor attention requested
  status        text not null default 'open'
                  check (status in ('open','in_progress','resolved','carried_forward')),
  resolution_notes text,
  resolved_by   uuid references profiles(id) on delete set null,
  resolved_at   timestamptz,
  carried_from_shift_id uuid references op_shifts(id) on delete set null, -- set when carried across handover
  routed_to     text check (routed_to in
                  ('doctor','medical_team','specialty','subspecialty','on_call','shift_supervisor','allied_health','quality')),
  routed_by     uuid references profiles(id) on delete set null,
  routed_at     timestamptz,
  acknowledged_by uuid references profiles(id) on delete set null,      -- routing acknowledgement (ADD-001B)
  acknowledged_at timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists op_concern_actions (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid references hospitals(id) on delete cascade,
  concern_id   uuid not null references op_concerns(id) on delete cascade,
  action       text not null,                                           -- the agreed ward-round decision
  owner_id     uuid references profiles(id) on delete set null,         -- assigned back to the bedside
  owner_name   text,
  due_at       timestamptz,
  status       text not null default 'open'
                 check (status in ('open','in_progress','completed','cancelled')),
  task_id      uuid references op_tasks(id) on delete set null,         -- when spawned as a real op_task
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_op_concerns_patient  on op_concerns(patient_id, status);
create index if not exists idx_op_concerns_hosp     on op_concerns(hospital_id, status, priority);
create index if not exists idx_op_concerns_shift    on op_concerns(shift_id);
create index if not exists idx_op_concerns_raised   on op_concerns(raised_by, raised_at desc);
create index if not exists idx_op_concern_actions_c on op_concern_actions(concern_id, status);
create index if not exists idx_op_concern_actions_o on op_concern_actions(owner_id, status);

alter table op_concerns enable row level security;
alter table op_concern_actions enable row level security;
drop policy if exists op_concerns_read on op_concerns;
create policy op_concerns_read on op_concerns for select to authenticated using (true);
drop policy if exists op_concern_actions_read on op_concern_actions;
create policy op_concern_actions_read on op_concern_actions for select to authenticated using (true);

notify pgrst, 'reload schema';
