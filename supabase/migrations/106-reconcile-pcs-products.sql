-- 106-reconcile-pcs-products.sql
-- Reconcile the PCS packaging model onto the canonical POP-001 product catalogue, eliminating the duplicate
-- `products` table introduced in 105. `plat_products` (keyed by `code`, migration 042) is now the SINGLE product
-- catalogue; PCS adds only the packaging + gating DIMENSIONS around it: portfolios/suites (organization),
-- product_workspaces (which workspaces a product unlocks) and tenant_product_licenses (who's licensed). Safe:
-- all 105 tables are empty, so there is no data to migrate. Idempotent.

-- 1. Organize billing products into PCS suites (additive nullable column on the canonical catalogue).
alter table plat_products add column if not exists suite_id uuid references product_suites(id) on delete set null;
create index if not exists idx_plat_products_suite on plat_products(suite_id);

-- 2. Re-key the mapping + licensing tables to plat_products.code (they are empty → drop + recreate).
drop table if exists product_workspaces;
drop table if exists tenant_product_licenses;

create table if not exists product_workspaces (
  product_code  text not null references plat_products(code) on delete cascade,
  workspace_key text not null,                              -- Workspace Registry key: 'portal:*' | 'workspace:*'
  primary key (product_code, workspace_key)
);
create table if not exists tenant_product_licenses (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  product_code text not null references plat_products(code) on delete cascade,
  status       text not null default 'active' check (status in ('active','suspended','expired')),
  valid_from   date,
  valid_to     date,
  created_at   timestamptz not null default now(),
  unique (tenant_id, product_code)
);
create index if not exists idx_product_workspaces_key on product_workspaces(workspace_key);
create index if not exists idx_tenant_licenses_tenant on tenant_product_licenses(tenant_id, status);
alter table product_workspaces      enable row level security;   -- service-role only
alter table tenant_product_licenses enable row level security;   -- service-role only

-- 3. Drop the redundant PCS products catalogue (superseded by plat_products + suite_id).
drop table if exists products;
