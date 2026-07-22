-- 063: System & Security — data protection & recovery events (SYS-001.5).
-- A documented log of DR exercises, restore requests, backup verifications,
-- privacy requests and retention reviews, with RPO/RTO targets vs actuals and
-- an outcome. This is the resilience evidence trail the spec requires ("regular
-- disaster recovery exercises with documented outcomes"); it does NOT replace
-- the managed backup runtime (Supabase). hospital_id null = platform-level.
-- Idempotent; RLS-locked to the service role (writes via audited admin APIs).

create table if not exists sys_recovery_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'dr_test'
    check (kind in ('dr_test','restore_request','backup_verification','privacy_request','retention_review')),
  title text not null,
  scope text,                                              -- service / dataset / tenant in scope
  status text not null default 'planned'
    check (status in ('planned','in_progress','completed','failed','approved','rejected')),
  outcome text not null default 'pending'
    check (outcome in ('pending','passed','partial','failed')),
  rpo_target_min int,                                      -- minutes
  rto_target_min int,
  rpo_actual_min int,
  rto_actual_min int,
  reason text,                                             -- restore/privacy justification
  outcome_note text,
  hospital_id uuid references hospitals(id) on delete cascade,  -- null = platform-level
  requested_by uuid references profiles(id) on delete set null,
  requested_by_name text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_sys_recovery_kind on sys_recovery_events(kind);
create index if not exists idx_sys_recovery_status on sys_recovery_events(status);
create index if not exists idx_sys_recovery_created on sys_recovery_events(created_at desc);

alter table sys_recovery_events enable row level security;
-- No client policies on purpose: reads/writes go through the service-role
-- admin client behind audited role-gated API routes.
