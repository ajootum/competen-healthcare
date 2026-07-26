-- Migration 112: AI Services Platform Phase 2 — Prompt / Persona / Skill / Agent / Config registries
-- (AIS-007 / AIS-004 / AIS-012 / AIS-010). The control-plane registries the copilot runtime resolves over.
-- Platform-global. Plain statements only (kept tight so ;-splitting SQL runners apply every table).

create table if not exists ais_prompt_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null, workspace text, category text, template text,
  model_hint text, version text default '1.0',
  status text not null default 'active' check (status in ('active','draft','archived')),
  usage int not null default 0, created_at timestamptz not null default now()
);

create table if not exists ais_personas (
  id uuid primary key default gen_random_uuid(),
  name text not null, description text, tone text, workspace text,
  status text not null default 'active' check (status in ('active','draft','archived')),
  created_at timestamptz not null default now()
);

create table if not exists ais_skills (
  id uuid primary key default gen_random_uuid(),
  name text not null, code text not null unique, category text not null default 'internal'
    check (category in ('internal','external','data','action','knowledge')),
  description text, scope text not null default 'read' check (scope in ('read','write')),
  requires_approval boolean not null default false,
  status text not null default 'active' check (status in ('active','beta','deprecated')),
  invocations int not null default 0, created_at timestamptz not null default now()
);

create table if not exists ais_agents (
  id uuid primary key default gen_random_uuid(),
  name text not null, description text, agent_type text, model_id text,
  skills text[] not null default '{}', autonomy text not null default 'assist'
    check (autonomy in ('assist','suggest','act')),
  workspace text, status text not null default 'active' check (status in ('active','draft','paused')),
  runs int not null default 0, created_at timestamptz not null default now()
);

create table if not exists ais_config (
  id uuid primary key default gen_random_uuid(),
  config_key text not null, name text not null, category text not null default 'copilot'
    check (category in ('copilot','model','safety','routing','feature','knowledge')),
  value text, source text not null default 'local' check (source in ('inherited','local')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

create index if not exists idx_ais_prompts_ws on ais_prompt_templates(workspace, status);
create index if not exists idx_ais_skills_cat on ais_skills(category, status);
create index if not exists idx_ais_agents_status on ais_agents(status);
create index if not exists idx_ais_config_cat on ais_config(category);

alter table ais_prompt_templates enable row level security;
alter table ais_personas         enable row level security;
alter table ais_skills           enable row level security;
alter table ais_agents           enable row level security;
alter table ais_config           enable row level security;

drop policy if exists ais_prompts_read on ais_prompt_templates;
create policy ais_prompts_read on ais_prompt_templates for select to authenticated using (true);
drop policy if exists ais_personas_read on ais_personas;
create policy ais_personas_read on ais_personas for select to authenticated using (true);
drop policy if exists ais_skills_read on ais_skills;
create policy ais_skills_read on ais_skills for select to authenticated using (true);
drop policy if exists ais_agents_read on ais_agents;
create policy ais_agents_read on ais_agents for select to authenticated using (true);
drop policy if exists ais_config_read on ais_config;
create policy ais_config_read on ais_config for select to authenticated using (true);
