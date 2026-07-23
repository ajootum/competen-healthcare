-- 076: Workspace Configuration Engine (WCE-001) — no-code, hierarchical config of
-- workspaces down to section/module grain, with draft/published separation,
-- versioning, publish/rollback and a change audit. Complements the existing
-- workspace-level management (plat_workspaces / POP-001) by going one level
-- deeper (sections & modules) and adding the Platform→Tenant→Hospital→Unit→Role
-- →User inheritance + version lifecycle. The configurable-object CATALOGUE lives
-- in code (src/lib/config/workspace-catalog.ts); these tables carry only the
-- sparse OVERRIDES to it — so runtime rendering never depends on the DB being
-- fully populated. Feature-flag (module enable/disable) is just an override whose
-- settings carry {"enabled": false}. Idempotent; RLS service-role only.

-- ── Override store (draft + published per scope+path) ────────────────────────
-- One row per (scope, config_path). `draft` = the working edit; `published` =
-- what the runtime reads (null → runtime falls back to the code catalogue
-- default). Publishing copies draft→published and snapshots a version.
create table if not exists workspace_config_overrides (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid references hospitals(id) on delete cascade,   -- null = platform scope
  scope_type    text not null default 'hospital'
                  check (scope_type in ('platform','tenant','hospital','unit','role','user')),
  scope_ref     text,                                              -- null=platform; else hospital/unit id, role name, or user id
  config_path   text not null,                                     -- e.g. 'supervisor.patient-operations' or '...sbar-builder'
  draft         jsonb not null default '{}'::jsonb,                -- {enabled?:bool, label?:text, order?:int}
  published     jsonb,                                             -- last published settings (null = never published)
  updated_by    uuid references profiles(id) on delete set null,
  updated_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (scope_type, scope_ref, config_path)
);
create index if not exists idx_wce_overrides_scope on workspace_config_overrides(scope_type, scope_ref);
create index if not exists idx_wce_overrides_hospital on workspace_config_overrides(hospital_id);

-- ── Version snapshots (publish / rollback lifecycle) ─────────────────────────
create table if not exists workspace_config_versions (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid references hospitals(id) on delete cascade,
  scope_type    text not null,
  scope_ref     text,
  label         text,
  note          text,
  snapshot      jsonb not null default '[]'::jsonb,                -- [{config_path, settings}] published at this version
  status        text not null default 'published' check (status in ('published','rolled_back')),
  published_by  uuid references profiles(id) on delete set null,
  published_by_name text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_wce_versions_scope on workspace_config_versions(scope_type, scope_ref, created_at desc);

-- ── Change audit (who set/reset/published/rolled back what) ───────────────────
create table if not exists workspace_config_audit (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid references hospitals(id) on delete cascade,
  actor_id      uuid references profiles(id) on delete set null,
  actor_name    text,
  action        text not null check (action in ('set','reset','publish','rollback')),
  scope_type    text,
  scope_ref     text,
  config_path   text,
  old_value     jsonb,
  new_value     jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_wce_audit_created on workspace_config_audit(created_at desc);

alter table workspace_config_overrides enable row level security;
alter table workspace_config_versions  enable row level security;
alter table workspace_config_audit      enable row level security;
-- No client policies on purpose: all reads/writes go through the service-role
-- admin client behind the super-admin-gated /api/platform/workspace-config route.
