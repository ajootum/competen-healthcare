-- ═══════════════════════════════════════════════════════════════════════
-- Competen Landlord/Tenant Phase 0-1 — RUN-ONCE bundle (migrations 040+041+042)
-- Paste this whole file into the Supabase SQL Editor and click Run.
-- Order-safe (040 → 041 → 042) and idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════

-- ┌───────────────────────────────────────────────────────────────────────
-- │ PART 1 of 3 — 040-platform-drift-fix.sql
-- └───────────────────────────────────────────────────────────────────────
-- Migration 040: Platform Drift Fix (Landlord/Tenant — Phase 0)
-- Legitimises schema that application code already assumes but which no migration
-- ever created, so writes stop failing silently in try/catch:
--   • audit_log — written by ~40 code sites (src/lib/workforce/engine.ts, the
--     api/** routes) and read by the platform/org-admin loaders, but never in a
--     migration. Created here with its actually-used columns PLUS tenant_id.
--   • profiles.roles / org_role / org_roles / platform_role — read across the
--     workspaces and written by api/super-admin/users, again with no migration.
-- Additive and idempotent. Nothing else in the landlord/tenant work is safe on a
-- drifted schema, so this lands first.

-- ── 1. audit_log — the platform audit trail (AuditEvent) ─────────────────────
create table if not exists audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references profiles(id) on delete set null,
  actor_name   text,
  action       text,
  entity_type  text,
  entity_id    uuid,
  entity_name  text,
  hospital_id  uuid references hospitals(id) on delete set null,
  old_value    jsonb,
  new_value    jsonb,
  created_at   timestamptz not null default now()
);
-- Backfill any column a pre-existing partial table is missing.
alter table audit_log add column if not exists actor_id    uuid;
alter table audit_log add column if not exists actor_name  text;
alter table audit_log add column if not exists action      text;
alter table audit_log add column if not exists entity_type text;
alter table audit_log add column if not exists entity_id   uuid;
alter table audit_log add column if not exists entity_name text;
alter table audit_log add column if not exists hospital_id uuid;
alter table audit_log add column if not exists old_value   jsonb;
alter table audit_log add column if not exists new_value   jsonb;
alter table audit_log add column if not exists created_at  timestamptz not null default now();
-- tenant_id: the missing scoping key. Today org-admin filters audit in-JS by
-- actor_id because there is no tenant column; this gives it one (backfilled in 041).
alter table audit_log add column if not exists tenant_id uuid;

create index if not exists idx_audit_log_created  on audit_log (created_at desc);
create index if not exists idx_audit_log_actor    on audit_log (actor_id);
create index if not exists idx_audit_log_action   on audit_log (action);
create index if not exists idx_audit_log_tenant   on audit_log (tenant_id);

-- ── 2. profiles role columns (formalise the drifted axes) ────────────────────
-- roles[]/org_role/org_roles are the tenant-plane axes; platform_role(s) is the
-- landlord axis (made enforceable in Phase 1). Added without hard CHECKs so any
-- values already written by the app are not rejected — the app layer validates,
-- and a VALIDATED constraint can follow once values are known-clean.
alter table profiles add column if not exists roles          text[];
alter table profiles add column if not exists org_role       text;
alter table profiles add column if not exists org_roles      text[];
alter table profiles add column if not exists platform_role  text;
alter table profiles add column if not exists platform_roles text[];

create index if not exists idx_profiles_platform_role on profiles (platform_role) where platform_role is not null;

comment on column profiles.platform_role is 'Landlord axis (PlatformRole): platform_owner | platform_operations | customer_success | support | product_manager | engineer | ai_operator | finance | content_manager | quality_officer | security_operator. NULL = tenant-plane user.';


-- ┌───────────────────────────────────────────────────────────────────────
-- │ PART 2 of 3 — 041-tenant-model.sql
-- └───────────────────────────────────────────────────────────────────────
-- Migration 041: Tenant Model (Landlord/Tenant — Phase 1, tenant plane)
-- Introduces the TEN-001 levels missing today: a real `tenants` root above
-- organisations, and `enterprises` replacing the free-text organisations.group_name.
-- Denormalises tenant_id onto hospitals/profiles/position_library so tenant scope
-- keys on ONE column. Lossless lift: one tenant per existing organisation (reusing
-- the org's uuid), enterprises created from distinct group_name values.
-- Additive + idempotent + backfilling. Apply AFTER 040.

-- ── 1. tenants — the tenant-plane root (what a customer IS) ──────────────────
create table if not exists tenants (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slug             text unique,
  tenant_type      text not null default 'hospital'
                     check (tenant_type in ('hospital','university','nursing_school','ministry',
                            'ngo','health_network','multinational_group','clinic','individual')),
  status           text not null default 'active'
                     check (status in ('prospect','trial','active','suspended','archived','deleted')),
  -- text (not char(2)): existing organisations.hq_country holds full country
  -- names ('Kenya'), which would overflow a char(2) on backfill and abort.
  primary_country  text,
  region_code      text,
  default_language text not null default 'en',
  timezone         text not null default 'UTC',
  currency         char(3) not null default 'USD',
  branding         jsonb,
  custom_domain    text,
  created_at       timestamptz not null default now(),
  archived_at      timestamptz
);
create index if not exists idx_tenants_status on tenants (status);

-- ── 2. enterprises — health-system grouping (replaces group_name free text) ──
create table if not exists enterprises (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  name               text not null,
  health_system_type text,
  hq_country         text,   -- full country names from organisations.hq_country
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);
create index if not exists idx_enterprises_tenant on enterprises (tenant_id);

-- ── 3. Hang the hierarchy off the new roots (nullable FKs; backfilled below) ─
alter table organisations   add column if not exists tenant_id     uuid references tenants(id);
alter table organisations   add column if not exists enterprise_id uuid references enterprises(id);
alter table hospitals       add column if not exists tenant_id     uuid references tenants(id);
alter table profiles        add column if not exists tenant_id     uuid references tenants(id);
alter table position_library add column if not exists tenant_id    uuid references tenants(id);

-- ── 4. Backfill — lossless one-tenant-per-organisation lift ──────────────────
-- 4a. One tenant per organisation, REUSING the org's uuid as the tenant id
--     (deterministic + idempotent). Slug = kebab(name)-<id8>, guaranteed unique.
insert into tenants (id, name, slug, tenant_type, primary_country)
select o.id,
       coalesce(o.name, 'Tenant'),
       lower(regexp_replace(coalesce(o.name, 'tenant'), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || left(o.id::text, 8),
       case
         when o.type = 'academic' then 'university'
         when o.type = 'ngo'      then 'ngo'
         when o.type = 'government' then 'ministry'
         else 'hospital'
       end,
       o.hq_country
from organisations o
where not exists (select 1 from tenants t where t.id = o.id);

update organisations set tenant_id = id where tenant_id is null;

-- 4b. Enterprises from distinct non-empty group_name (per org; consolidation of
--     multi-org groups into shared tenants is a later, deliberate step).
do $$
declare r record; eid uuid;
begin
  for r in
    select id, group_name, hq_country
    from organisations
    where group_name is not null and trim(group_name) <> '' and enterprise_id is null
  loop
    insert into enterprises (tenant_id, name, hq_country)
    values (r.id, trim(r.group_name), r.hq_country)
    returning id into eid;
    update organisations set enterprise_id = eid where id = r.id;
  end loop;
end $$;

-- 4c. Denormalise tenant_id downward — the isolation key the code keys on.
update hospitals h set tenant_id = o.tenant_id
  from organisations o where h.organisation_id = o.id and h.tenant_id is null;

update profiles p set tenant_id = h.tenant_id
  from hospitals h where p.hospital_id = h.id and p.tenant_id is null;
update profiles p set tenant_id = o.tenant_id
  from organisations o where p.tenant_id is null and p.organisation_id = o.id;

update position_library pl set tenant_id = o.tenant_id
  from organisations o where pl.organisation_id = o.id and pl.tenant_id is null;
-- position_library rows with null organisation_id are platform-global (tenant_id
-- stays null), matching LCP-001 §12 Global Standards Library semantics.

-- 4d. Give audit_log rows a tenant via the actor's profile (best-effort).
update audit_log a set tenant_id = p.tenant_id
  from profiles p where a.actor_id = p.id and a.tenant_id is null;

-- ── 5. Indexes on the new scoping columns ────────────────────────────────────
create index if not exists idx_orgs_tenant        on organisations (tenant_id);
create index if not exists idx_orgs_enterprise    on organisations (enterprise_id);
create index if not exists idx_hospitals_tenant   on hospitals (tenant_id);
create index if not exists idx_profiles_tenant    on profiles (tenant_id);
create index if not exists idx_poslib_tenant      on position_library (tenant_id);


-- ┌───────────────────────────────────────────────────────────────────────
-- │ PART 3 of 3 — 042-platform-control-plane.sql
-- └───────────────────────────────────────────────────────────────────────
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
