-- ═══════════════════════════════════════════════════════════════════════════
-- 057 — Generic workflow / approval engine (PCS-000 §10 / POS-001D)
-- A configurable, multi-step approval service. Workflow DEFINITIONS live in code
-- (lib/platform/approvals.ts) so types and steps never drift; this migration
-- adds the request instances and the per-step decision audit. The console
-- unifies these with the existing content change_requests into one queue.
-- RLS-locked (service-role only). Fail-soft: no tables → engine reports "not
-- ready" and existing change-request approvals still work. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists plat_approval_requests (
  id                uuid primary key default gen_random_uuid(),
  workflow_key      text not null,                 -- catalogue key, e.g. 'framework_publication'
  entity_type       text,
  entity_id         uuid,
  entity_name       text,
  payload           jsonb,
  status            text not null default 'pending'
                      check (status in ('pending','approved','rejected','cancelled')),
  current_step      int not null default 0,
  total_steps       int not null default 1,
  requested_by      uuid references profiles(id) on delete set null,
  requested_by_name text,
  created_at        timestamptz not null default now(),
  decided_at        timestamptz
);
create index if not exists idx_plat_approval_requests_status on plat_approval_requests(status, created_at desc);

-- Per-step decision audit (one row per approve/reject at a step).
create table if not exists plat_approval_decisions (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid references plat_approval_requests(id) on delete cascade,
  step        int not null,
  decision    text not null check (decision in ('approved','rejected')),
  actor_id    uuid references profiles(id) on delete set null,
  actor_name  text,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_plat_approval_decisions_request on plat_approval_decisions(request_id, created_at);

-- Lock to the service role (no policies = service-role only).
do $$
begin
  execute 'alter table public.plat_approval_requests enable row level security';
  execute 'alter table public.plat_approval_decisions enable row level security';
end $$;
