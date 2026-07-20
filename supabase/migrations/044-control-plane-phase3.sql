-- Migration 044: Control Plane Phase 3 (identity + release log)
-- Adds per-tenant identity/federation config and a platform release log. The
-- genuinely infra-bound Phase 3 items (multi-region hosting, resource metering,
-- DR failover, per-tenant code deployments, an external API gateway) are NOT
-- modelled here — they require leaving the managed-cloud abstraction and would be
-- fabricated data otherwise. Additive + idempotent. Apply AFTER 043.

-- ── 1. plat_idp_configs — Identity & Federation per tenant (LCP-001 §19) ─────
-- Stores each tenant's SSO/SAML/OIDC configuration and MFA/SCIM policy. Storing
-- the config is real; ENFORCING it requires wiring the auth provider (a later
-- integration), so a config here is "configured", not "live".
create table if not exists plat_idp_configs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  protocol      text not null default 'saml' check (protocol in ('saml','oidc','oauth')),
  provider      text,                       -- azure_ad | google | okta | custom
  metadata      jsonb,                      -- entity id, ACS url, issuer, client id, etc.
  mfa_required  boolean not null default false,
  scim_enabled  boolean not null default false,
  is_active     boolean not null default false,   -- config saved but enforcement pending
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists uq_idp_tenant on plat_idp_configs (tenant_id);

-- ── 2. plat_deployments — platform release log (LCP-001 §7) ──────────────────
-- A changelog of platform releases. NOTE: in the current single-deployment model
-- every tenant runs the CURRENT release; per-tenant code versioning would need a
-- multi-deployment architecture. Per-tenant capability differences are delivered
-- through feature flags (plat_feature_flag_assignments), not code versions — so no
-- per-tenant version matrix is fabricated here.
create table if not exists plat_deployments (
  id          uuid primary key default gen_random_uuid(),
  version     text not null,
  channel     text not null default 'stable' check (channel in ('stable','staged','canary')),
  status      text not null default 'released' check (status in ('planned','releasing','released','rolled_back')),
  notes       text,
  released_at timestamptz,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_plat_deployments_created on plat_deployments (created_at desc);
