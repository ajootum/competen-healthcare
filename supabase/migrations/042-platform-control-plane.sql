-- Migration 042: Platform Control Plane (Landlord/Tenant — Phase 1, landlord plane)
-- The LCP-001 core entities. All landlord tables use a `plat_` prefix, carry NO
-- tenant-keyable ownership (they describe/govern tenants from above), and are
-- meant to be RLS-locked to platform roles in a later hardening migration once
-- the platform-role axis is populated. Apply AFTER 041. Additive + idempotent.

-- ── 1. plat_tenant_status — lifecycle reference (TEN-001 §5, LCP-001 §3) ─────
create table if not exists plat_tenant_status (
  code       text primary key,
  label      text not null,
  sort       int not null default 0,
  is_terminal boolean not null default false
);
insert into plat_tenant_status (code, label, sort, is_terminal) values
  ('prospect','Prospect',10,false),
  ('trial','Trial',20,false),
  ('active','Active',30,false),
  ('suspended','Suspended',40,false),
  ('archived','Archived',50,true),
  ('deleted','Deleted',60,true)
on conflict (code) do nothing;

-- ── 2. plat_regions — hosting regions (LCP-001 §21) ──────────────────────────
create table if not exists plat_regions (
  code            text primary key,
  name            text not null,
  hosting_provider text,
  residency_policy text,
  is_active       boolean not null default true
);
insert into plat_regions (code, name) values
  ('af','Africa'), ('eu','Europe'), ('me','Middle East'), ('as','Asia'), ('us','United States')
on conflict (code) do nothing;

-- ── 3. plat_products — platform products/modules (LCP-001 §22) ───────────────
create table if not exists plat_products (
  code       text primary key,
  name       text not null,
  description text,
  is_core    boolean not null default false,
  default_on boolean not null default true,
  sort       int not null default 0
);
insert into plat_products (code, name, is_core, default_on, sort) values
  ('competency','Competency Platform',true,true,10),
  ('mclip','MCLIP',false,true,20),
  ('lms','Learning Management',true,true,30),
  ('simulation','Simulation',false,false,40),
  ('passport','Competency Passport',true,true,50),
  ('coe','Clinical Operations Engine',false,false,60),
  ('pce','Patient Care Engine',false,false,70)
on conflict (code) do nothing;

-- ── 4. plat_plans — plan catalogue (LCP-001 §4) ─────────────────────────────
create table if not exists plat_plans (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  name          text not null,
  price_monthly numeric,
  currency      char(3) not null default 'USD',
  entitlements  jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  sort          int not null default 0
);
insert into plat_plans (code, name, price_monthly, entitlements, sort) values
  ('starter','Starter',0,       '{"max_users":25,"max_hospitals":1,"ai_credits":1000,"storage_gb":5,"api_access":false}',10),
  ('professional','Professional',0,'{"max_users":150,"max_hospitals":1,"ai_credits":10000,"storage_gb":50,"api_access":false}',20),
  ('hospital','Hospital',0,     '{"max_users":1000,"max_hospitals":3,"ai_credits":50000,"storage_gb":250,"api_access":true}',30),
  ('enterprise','Enterprise',0, '{"max_users":10000,"max_hospitals":25,"ai_credits":250000,"storage_gb":1000,"api_access":true}',40),
  ('government','Government',0,  '{"max_users":100000,"max_hospitals":500,"ai_credits":1000000,"storage_gb":5000,"api_access":true}',50),
  ('unlimited','Unlimited',0,   '{"max_users":null,"max_hospitals":null,"ai_credits":null,"storage_gb":null,"api_access":true}',60)
on conflict (code) do nothing;

-- ── 5. plat_subscriptions — a tenant's plan (LCP-001 §4) ────────────────────
create table if not exists plat_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  plan_id         uuid not null references plat_plans(id),
  status          text not null default 'active'
                    check (status in ('trialing','active','past_due','canceled')),
  started_at      timestamptz not null default now(),
  renews_at       timestamptz,
  trial_ends_at   timestamptz,
  seats_purchased int,
  overrides       jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_plat_subs_tenant on plat_subscriptions (tenant_id);

-- ── 6. Feature flags (LCP-001 §9) ────────────────────────────────────────────
create table if not exists plat_feature_flags (
  key         text primary key,
  description text,
  default_on  boolean not null default false,
  product_code text references plat_products(code),
  created_at  timestamptz not null default now()
);
create table if not exists plat_feature_flag_assignments (
  id         uuid primary key default gen_random_uuid(),
  flag_key   text not null references plat_feature_flags(key) on delete cascade,
  scope_type text not null check (scope_type in ('global','tenant','country','plan','cohort')),
  scope_ref  text,                      -- tenant_id / country code / plan code / cohort key; null for global
  enabled    boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_flag_assign_key on plat_feature_flag_assignments (flag_key);
create index if not exists idx_flag_assign_scope on plat_feature_flag_assignments (scope_type, scope_ref);

insert into plat_feature_flags (key, description, default_on, product_code) values
  ('simulation_engine','Clinical simulation engine',false,'simulation'),
  ('executive_intelligence','Executive intelligence suite',true,'competency'),
  ('ai_copilot','AI copilot across workspaces',false,'competency'),
  ('clinical_operations','Clinical Operations Engine',false,'coe'),
  ('marketplace','Content marketplace',false,null)
on conflict (key) do nothing;

-- ── 7. plat_org_templates — provisioning blueprints (LCP-001 §13) ───────────
create table if not exists plat_org_templates (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  name       text not null,
  spec       jsonb not null default '{}'::jsonb,  -- default departments, roles, frameworks, workspaces, branding
  version    int not null default 1,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
insert into plat_org_templates (code, name, spec) values
  ('hospital','Hospital',       '{"tenant_type":"hospital","default_departments":["Emergency","ICU","Medical","Surgical","Paediatrics","Maternity","Outpatient","Theatre"],"plan":"hospital"}'),
  ('clinic','Clinic',           '{"tenant_type":"clinic","default_departments":["General Practice","Outpatient","Pharmacy"],"plan":"starter"}'),
  ('medical_school','Medical School','{"tenant_type":"nursing_school","default_departments":["Clinical Skills","Simulation","Faculty","Assessment"],"plan":"professional"}'),
  ('university','University',    '{"tenant_type":"university","default_departments":["Nursing Faculty","Clinical Placement","Assessment Centre"],"plan":"professional"}'),
  ('ministry','Ministry of Health','{"tenant_type":"ministry","default_departments":["Policy","Workforce","Quality Assurance","Regional Coordination"],"plan":"government"}'),
  ('ngo','NGO',                 '{"tenant_type":"ngo","default_departments":["Programmes","Field Operations","Training"],"plan":"professional"}'),
  ('network','Health Network',  '{"tenant_type":"health_network","default_departments":["Network Office","Shared Services","Quality"],"plan":"enterprise"}')
on conflict (code) do nothing;

-- ── 8. plat_audit_events — Global Audit Centre (LCP-001 §16) ────────────────
-- The landlord-plane audit trail: actor-attributed, before/after, approval and a
-- plane discriminator. Distinct from tenant audit_log; append-only by intent.
create table if not exists plat_audit_events (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references profiles(id) on delete set null,
  actor_name   text,
  actor_plane  text not null default 'landlord' check (actor_plane in ('landlord','tenant')),
  action       text not null,
  entity_type  text,
  entity_id    uuid,
  entity_name  text,
  tenant_id    uuid references tenants(id) on delete set null,  -- null for pure landlord actions
  old_value    jsonb,
  new_value    jsonb,
  ip           text,
  user_agent   text,
  reason       text,
  approval_ref uuid,
  created_at   timestamptz not null default now()
);
create index if not exists idx_plat_audit_created on plat_audit_events (created_at desc);
create index if not exists idx_plat_audit_tenant  on plat_audit_events (tenant_id);
create index if not exists idx_plat_audit_action  on plat_audit_events (action);

-- ── 9. Link tenants.status to the reference table (soft; check already guards) ─
-- (No hard FK: tenants.status has its own CHECK and this ref table is for the UI.)
