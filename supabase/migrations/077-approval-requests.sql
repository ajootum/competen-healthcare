-- 077: Approvals Workspace (UMW-EA-001) — the Unit Manager's decision-governance
-- store. One row per approval request requiring delegated managerial authority
-- (overtime, leave, roster, staffing, equipment/procurement, policy, competency,
-- finance, …). Every decision is recorded here + in audit_log. The store starts
-- empty — the workspace shows honest empty states until requests are submitted;
-- no requests are fabricated. Idempotent; RLS service-role only (writes via the
-- audited, role-gated /api/operations/approvals route).

create table if not exists approval_requests (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid not null references hospitals(id) on delete cascade,
  department_id  uuid references departments(id) on delete set null,
  category       text not null default 'operations'
                   check (category in ('personnel','staffing','clinical','competency','education','equipment','policy','finance','operations','it','governance')),
  title          text not null,
  details        text,
  reason         text,
  requester_id   uuid references profiles(id) on delete set null,
  requester_name text,
  requester_role text,
  priority       text not null default 'medium' check (priority in ('critical','high','medium','low')),
  impact         text not null default 'medium' check (impact in ('high','medium','low')),
  status         text not null default 'waiting'
                   check (status in ('waiting','pending_info','approved','rejected','returned','delegated','escalated')),
  ai_recommendation text check (ai_recommendation in ('approve','review','reject','escalate','request_info')),
  ai_confidence  int,
  ai_reasoning   text,
  sla_hours      int not null default 24,
  submitted_at   timestamptz not null default now(),
  due_at         timestamptz,
  decided_by     uuid references profiles(id) on delete set null,
  decided_by_name text,
  decided_at     timestamptz,
  decision_note  text,
  delegated_to   uuid references profiles(id) on delete set null,
  delegated_to_name text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_approvals_hospital on approval_requests(hospital_id, status, priority);
create index if not exists idx_approvals_category on approval_requests(hospital_id, category);
create index if not exists idx_approvals_due on approval_requests(due_at);

alter table approval_requests enable row level security;
-- No client policies on purpose: all reads/writes go through the service-role
-- admin client behind the audited, role-gated approvals API.
