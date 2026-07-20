-- Competen Landlord/Tenant Phase 2 -- RUN-ONCE (migration 043).
-- Apply AFTER 040, 041, 042. Paste into the Supabase SQL Editor and Run.
-- Additive + idempotent (safe to re-run).

-- Migration 043: Control Plane Phase 2 (commercial + governance)
-- Adds the billing, event-stream and support tables, and retires the per-facility
-- hospitals.tier tag by backfilling a real tenant subscription from it. Additive,
-- idempotent, non-breaking (hospitals.tier is left in place but deprecated).
-- Apply AFTER 042.

-- -- 1. plat_billing_accounts - a tenant's billing identity (LCP-001 5) ------
create table if not exists plat_billing_accounts (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  legal_name          text,
  tax_id              text,
  billing_email       text,
  gateway_customer_ref text,
  currency            char(3) not null default 'USD',
  balance             numeric not null default 0,
  created_at          timestamptz not null default now()
);
create index if not exists idx_plat_billing_tenant on plat_billing_accounts (tenant_id);

-- -- 2. plat_invoices - minimal invoice ledger (activates with a gateway) -----
create table if not exists plat_invoices (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  billing_account_id uuid references plat_billing_accounts(id) on delete set null,
  number             text,
  status             text not null default 'draft'
                       check (status in ('draft','open','paid','void','uncollectible')),
  amount             numeric not null default 0,
  currency           char(3) not null default 'USD',
  issued_at          timestamptz,
  due_at             timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists idx_plat_invoices_tenant on plat_invoices (tenant_id);

-- -- 3. plat_platform_events - Global Event Centre (LCP-001 15) -------------
-- System-emitted telemetry (tenant.created, tenant.suspended, subscription.changed,
-- billing.failure ). Distinct from plat_audit_events (actor-attributed actions).
create table if not exists plat_platform_events (
  id         uuid primary key default gen_random_uuid(),
  event_type text not null,
  tenant_id  uuid references tenants(id) on delete set null,
  severity   text not null default 'info' check (severity in ('info','warning','critical')),
  payload    jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_plat_events_created on plat_platform_events (created_at desc);
create index if not exists idx_plat_events_type    on plat_platform_events (event_type);
create index if not exists idx_plat_events_tenant  on plat_platform_events (tenant_id);

-- -- 4. plat_support_tickets - Support workspace (SUP-001) -------------------
create table if not exists plat_support_tickets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid references tenants(id) on delete set null,
  subject        text not null,
  body           text,
  status         text not null default 'open'
                   check (status in ('open','pending','resolved','closed')),
  priority       text not null default 'normal'
                   check (priority in ('low','normal','high','urgent')),
  requester_name text,
  assignee_id    uuid references profiles(id) on delete set null,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_plat_tickets_status on plat_support_tickets (status);
create index if not exists idx_plat_tickets_tenant on plat_support_tickets (tenant_id);

-- -- 4b. One feature-flag assignment per (flag, scope) - enables atomic upsert.
-- nulls not distinct so a single 'global' (null scope_ref) row is enforced too.
create unique index if not exists uq_flag_scope
  on plat_feature_flag_assignments (flag_key, scope_type, scope_ref) nulls not distinct;

-- -- 5. Retire hospitals.tier -> real tenant subscriptions --------------------
-- Each existing tenant that has no subscription gets one derived from the highest
-- tier among the hospitals in its organisation (tenant.id == organisation.id from
-- the 041 lift), defaulting to 'starter'. hospitals.tier stays for back-compat.
do $$
declare r record; pid uuid;
begin
  for r in
    select t.id as tenant_id,
           coalesce((
             select case
               when bool_or(h.tier = 'enterprise')    then 'enterprise'
               when bool_or(h.tier = 'professional')  then 'professional'
               else 'starter' end
             from hospitals h where h.organisation_id = t.id
           ), 'starter') as plan_code
    from tenants t
    where not exists (select 1 from plat_subscriptions s where s.tenant_id = t.id)
  loop
    select id into pid from plat_plans where code = r.plan_code;
    if pid is not null then
      insert into plat_subscriptions (tenant_id, plan_id, status) values (r.tenant_id, pid, 'active');
    end if;
  end loop;
end $$;
