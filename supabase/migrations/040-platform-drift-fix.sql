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
