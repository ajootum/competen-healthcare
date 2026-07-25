-- 105-product-portfolio.sql
-- PCS-PORT-001 (foundation) — the commercial packaging + licensing hierarchy: Portfolio → Suite → Product →
-- (existing) Workspace. Metadata, not code, so suites/products/licensing change without deploys. This migration
-- creates the model + the tenant-licensing store + the product→workspace mapping. It supplies the "license/feature
-- filter" layer PW-014 §11.14 resolveExperience already reserves; the runtime filter (src/lib/orchestration/
-- licensing.ts) plugs into resolveEntitlements. Admin UIs (Portfolio Manager / Suite Designer / Licensing Matrix)
-- are a follow-up. NON-BREAKING by design: a workspace is licence-gated ONLY when mapped to a product — unmapped
-- workspaces stay freely available (acceptance: "existing workspace architecture remains unchanged"). Idempotent.

create table if not exists product_portfolios (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  status      text not null default 'active' check (status in ('active','archived')),
  created_at  timestamptz not null default now()
);

create table if not exists product_suites (
  id              uuid primary key default gen_random_uuid(),
  portfolio_id    uuid references product_portfolios(id) on delete cascade,
  name            text not null,
  code            text,
  icon            text,
  color           text,
  sort_order      integer not null default 0,
  parent_suite_id uuid references product_suites(id) on delete set null,   -- suites can nest
  visibility      text not null default 'internal' check (visibility in ('public','internal','hidden')),
  status          text not null default 'active' check (status in ('active','archived')),
  created_at      timestamptz not null default now()
);

create table if not exists products (
  id           uuid primary key default gen_random_uuid(),
  suite_id     uuid references product_suites(id) on delete set null,
  name         text not null,
  code         text unique,
  version      text default '1.0',
  license_type text not null default 'licensed' check (license_type in ('included','licensed','trial','addon')),
  status       text not null default 'active' check (status in ('active','deprecated','archived')),
  created_at   timestamptz not null default now()
);

-- Product → Workspace mapping (workspace_key = the Workspace Registry key: 'personal' | 'portal:<role>' |
-- 'workspace:<slug>'). A workspace with NO row here is not licence-gated (freely available).
create table if not exists product_workspaces (
  product_id    uuid not null references products(id) on delete cascade,
  workspace_key text not null,
  primary key (product_id, workspace_key)
);

-- Which products a tenant has licensed. Absence = not licensed (only matters for mapped workspaces).
create table if not exists tenant_product_licenses (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  status     text not null default 'active' check (status in ('active','suspended','expired')),
  valid_from date,
  valid_to   date,
  created_at timestamptz not null default now(),
  unique (tenant_id, product_id)
);

create index if not exists idx_product_suites_portfolio on product_suites(portfolio_id, sort_order);
create index if not exists idx_products_suite           on products(suite_id, status);
create index if not exists idx_product_workspaces_key    on product_workspaces(workspace_key);
create index if not exists idx_tenant_licenses_tenant    on tenant_product_licenses(tenant_id, status);

-- Service-role only (RLS deny-by-default). Config is managed server-side via the admin client; the runtime
-- license filter reads via the service-role client, same pattern as the rest of the config layer.
alter table product_portfolios       enable row level security;
alter table product_suites           enable row level security;
alter table products                 enable row level security;
alter table product_workspaces       enable row level security;
alter table tenant_product_licenses  enable row level security;
