-- 081: Workforce Planning Studio config store (WPS-001). The single source of truth for
-- the tenant's workforce-planning parameters that the Establishment engine (UMW-WFM-000A)
-- and the AI Scheduling Engines (WSE-001A..J) consume — contracted hours, leave/relief
-- assumptions, staffing ratios by demand model, shift pattern, pay rates and premium
-- multipliers, AI/optimisation weights. One published config document per tenant
-- (settings jsonb), versioned and audit-logged. Engines read the published config and
-- fall back to platform defaults where a key is unset, so nothing is fabricated — the
-- numbers a manager sees are exactly what drives the engines. Idempotent; RLS service-role
-- only (writes via the audited, role-gated /api/config/planning route).

create table if not exists wps_config (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null unique references hospitals(id) on delete cascade,
  settings        jsonb not null default '{}',
  version         int not null default 1,
  status          text not null default 'published' check (status in ('draft','published')),
  updated_by      uuid references profiles(id) on delete set null,
  updated_by_name text,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index if not exists idx_wps_config_hospital on wps_config(hospital_id);

alter table wps_config enable row level security;
-- No client policies: reads/writes go through the service-role admin client behind the
-- audited, role-gated /api/config/planning route.
