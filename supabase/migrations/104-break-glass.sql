-- 104-break-glass.sql
-- PW-014 P5 / §4, §15 / PW-AC-10 — governed emergency-access ("break-glass") grants. When a user must reach data
-- beyond their normal scope in an emergency, they invoke break-glass with a MANDATORY reason; the system records
-- a time-boxed, audited grant + publishes a domain event. Access-widening is consumed by scope logic checking for
-- an active grant (hasActiveBreakGlass). Accountability = reason + expiry + audit + event, never silent elevation.
-- Service-role only (RLS deny-by-default); the server manages grants via the admin client. Idempotent.

create table if not exists break_glass_grant (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid not null references profiles(id) on delete cascade,
  actor_name   text,
  tenant_id    uuid references tenants(id) on delete set null,
  hospital_id  uuid references hospitals(id) on delete set null,
  target_type  text,                                   -- 'patient' | 'hospital' | 'workspace' | null (broad)
  target_ref   text,                                   -- id/reference of the emergency target
  reason       text not null,                          -- mandatory justification (captured, audited)
  scope        text not null default 'read' check (scope in ('read','act')),
  status       text not null default 'active' check (status in ('active','expired','revoked')),
  granted_at   timestamptz not null default now(),
  expires_at   timestamptz not null,                   -- hard expiry — grants are always time-boxed
  revoked_at   timestamptz,
  revoked_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_break_glass_actor    on break_glass_grant(actor_id, status, expires_at desc);
create index if not exists idx_break_glass_hospital  on break_glass_grant(hospital_id, granted_at desc);
create index if not exists idx_break_glass_active    on break_glass_grant(status, expires_at) where status = 'active';

alter table break_glass_grant enable row level security;  -- service-role only; no client policy (deny-by-default)
