-- ═══════════════════════════════════════════════════════════════════════════
-- 053 — Workspace Management (POP-001 §3)
-- Backs the Workspace Management module. The workspace CATALOGUE (which
-- workspaces exist, their routes and default audiences) lives in application
-- code (@/lib/roles) across three planes — portal, org-role and platform — so
-- it never drifts from the running app. This table stores only sparse
-- MANAGEMENT OVERRIDES keyed by the catalogue `key`: a row exists only for a
-- workspace an operator has customised (enabled/disabled, renamed, re-iconed,
-- themed, re-scoped). Mirrors the plat_feature_flags/assignments override model.
-- RLS-locked (service-role only) like the rest of the platform-control surface.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists plat_workspaces (
  key         text primary key,               -- catalogue key, e.g. 'portal:assessor', 'platform:POW-001'
  is_enabled  boolean not null default true,   -- false = operator has disabled this workspace
  label       text,                            -- override display name (null = code default)
  icon        text,                            -- override icon (null = code default)
  description text,                            -- override description
  accent      text,                            -- theme accent (hex), null = kind default
  audience    jsonb,                           -- override audience: string[] of role codes
  config      jsonb not null default '{}'::jsonb,  -- reserved: layout/menu/widget composition
  sort        int,                             -- override ordering within its plane
  updated_by  uuid references profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- Lock to the service role (no policies = service-role only).
do $$
begin
  execute 'alter table public.plat_workspaces enable row level security';
end $$;
