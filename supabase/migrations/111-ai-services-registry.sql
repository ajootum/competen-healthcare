-- Migration 111: AI Services Platform Phase 1 — AI Model & Provider Registry (AIS-009).
-- The control-plane registry that the AI Runtime Gateway (src/lib/ai/gateway.ts) routes over. Model pricing mirrors
-- the gateway's real list pricing; live configured-status comes from aiStatus() (env detection) and usage/cost from
-- the existing plat_ai_requests telemetry (migration 055). Platform-global (no hospital scope). Plain statements only.

create table if not exists ais_providers (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  status     text not null default 'active' check (status in ('active','inactive','degraded')),
  priority   int not null default 1,
  base_url   text,
  notes      text,
  created_at timestamptz not null default now()
);

create table if not exists ais_models (
  id             uuid primary key default gen_random_uuid(),
  provider_code  text not null,
  model_id       text not null,
  display_name   text not null,
  tier           text not null default 'reasoning' check (tier in ('cheap','reasoning','heavy')),
  input_price    numeric,
  output_price   numeric,
  context_window int,
  max_output     int,
  capabilities   text[] not null default '{}',
  status         text not null default 'active' check (status in ('active','preview','deprecated','retired')),
  is_default     boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (provider_code, model_id)
);

create index if not exists idx_ais_models_provider on ais_models(provider_code, status);

alter table ais_providers enable row level security;
alter table ais_models    enable row level security;

drop policy if exists ais_providers_read on ais_providers;
create policy ais_providers_read on ais_providers for select to authenticated using (true);
drop policy if exists ais_models_read on ais_models;
create policy ais_models_read on ais_models for select to authenticated using (true);
