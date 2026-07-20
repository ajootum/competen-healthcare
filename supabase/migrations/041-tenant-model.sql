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
