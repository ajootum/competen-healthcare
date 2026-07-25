-- 095: Template, Package & Marketplace Manager (NCP-011) — the capstone of the no-code platform. A configuration
-- PACKAGE bundles reusable configuration assets (objects authored by the other NCP builders — dashboards, forms,
-- workflows, rules, reports, metrics, navigation, permissions, …) into a versioned, installable unit. Unlike the
-- other builders a package is NOT one of the registry object types (it is a collection of them), so it gets its
-- own table. The manifest is COMPUTED from the WCE-002 dependency graph: a package is "dependency-complete" only
-- when every object its members transitively depend on is either in the package or already installed. Idempotent;
-- RLS service-role only (writes via the admin client behind super-admin-gated APIs), mirroring 092/093/094.

create table if not exists configuration_packages (
  id uuid primary key default gen_random_uuid(),
  package_key text not null unique,                    -- permanent machine key, e.g. bundle.ward_quality_pack
  package_name text not null,
  description text,
  publisher text,
  category text not null default 'general'
    check (category in ('clinical','operational','analytics','governance','workforce','learning','general')),
  version text not null default '1.0.0',               -- semantic version
  license text not null default 'proprietary'
    check (license in ('proprietary','open','subscription','enterprise')),
  pricing_model text not null default 'included'
    check (pricing_model in ('included','subscription','one_time','usage_based')),
  visibility text not null default 'private'
    check (visibility in ('private','enterprise','public')),
  members jsonb not null default '[]',                 -- array of registry object_keys bundled in the package
  manifest jsonb not null default '{}',                -- computed: {members, requires[], missing[], complete}
  status text not null default 'draft'
    check (status in ('draft','validated','published','deprecated','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  updated_by uuid references profiles(id) on delete set null
);
create index if not exists idx_packages_status on configuration_packages(status);
create index if not exists idx_packages_category on configuration_packages(category);

create table if not exists configuration_package_audit (
  id uuid primary key default gen_random_uuid(),
  package_key text,
  action text not null,                                -- created / saved / validated / published / deprecated
  new_value jsonb,
  actor_id uuid references profiles(id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_package_audit_pkg on configuration_package_audit(package_key, created_at desc);

alter table configuration_packages enable row level security;
alter table configuration_package_audit enable row level security;
-- No client policies on purpose: reads/writes go through the service-role admin client behind super-admin-gated APIs.
