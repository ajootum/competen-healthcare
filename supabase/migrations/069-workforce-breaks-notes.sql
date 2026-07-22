-- 069: Workforce Operations redesign (SSW-WFO-001) — break management & supervisor
-- notes stores. The spec makes both a build priority: "replace the static break
-- placeholder with a fully operational Break Management workspace" and "persist
-- Supervisor Notes as structured shift records". op_staff_breaks is the live break
-- board (scheduled → on-break → completed, with overdue/missed and relief cover);
-- op_supervisor_notes is the structured shift journal (decisions, events, coaching,
-- risks, action items) that feeds handover & analytics. Idempotent; RLS
-- service-role only (writes via audited APIs).

create table if not exists op_staff_breaks (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
  shift_id uuid references op_shifts(id) on delete set null,
  staff_id uuid references profiles(id) on delete set null,
  staff_name text,
  role text,
  break_type text not null default 'rest' check (break_type in ('rest','meal','comfort')),
  status text not null default 'scheduled'
    check (status in ('scheduled','on_break','completed','overdue','missed','cancelled')),
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  duration_min int not null default 30,
  relief_staff_id uuid references profiles(id) on delete set null,
  relief_name text,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_op_staff_breaks_shift on op_staff_breaks(shift_id, scheduled_at);
create index if not exists idx_op_staff_breaks_status on op_staff_breaks(hospital_id, status);

create table if not exists op_supervisor_notes (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
  shift_id uuid references op_shifts(id) on delete set null,
  note_type text not null default 'general'
    check (note_type in ('staffing_decision','operational_event','coaching','risk','handover','action_item','general')),
  title text,
  body text not null,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  status text not null default 'open' check (status in ('open','closed')),
  author_id uuid references profiles(id) on delete set null,
  author_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_op_supervisor_notes_shift on op_supervisor_notes(shift_id, created_at desc);
create index if not exists idx_op_supervisor_notes_type on op_supervisor_notes(hospital_id, note_type);

alter table op_staff_breaks enable row level security;
alter table op_supervisor_notes enable row level security;
-- No client policies on purpose: reads/writes go through the service-role admin
-- client behind audited, role-gated API routes.
