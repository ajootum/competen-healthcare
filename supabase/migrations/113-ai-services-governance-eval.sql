-- Migration 113: AI Services Platform Phase 3 — Context / Knowledge / Action / Governance / Eval registries
-- (AIS-002 / AIS-003 / AIS-005 / AIS-008 / AIS-011). The control-plane governance & evaluation layer.
-- Platform-global. Plain statements only (kept tight so ;-splitting SQL runners apply every table).

create table if not exists ais_context_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null, domain text not null default 'workspace'
    check (domain in ('user','workspace','tenant','security','knowledge','workflow','memory','business')),
  source_system text, refresh text, status text not null default 'active'
    check (status in ('active','inactive')), created_at timestamptz not null default now()
);

create table if not exists ais_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null, domain text not null default 'unstructured'
    check (domain in ('structured','unstructured','configuration')),
  source_type text, doc_count int not null default 0, indexed boolean not null default false,
  status text not null default 'active' check (status in ('active','indexing','inactive')),
  last_indexed timestamptz, created_at timestamptz not null default now()
);

create table if not exists ais_actions (
  id uuid primary key default gen_random_uuid(),
  name text not null, action_type text, trigger text not null default 'recommendation'
    check (trigger in ('recommendation','manual','scheduled','event')),
  requires_approval boolean not null default true, status text not null default 'active'
    check (status in ('active','draft','paused')),
  executions int not null default 0, success_rate numeric, created_at timestamptz not null default now()
);

create table if not exists ais_policies (
  id uuid primary key default gen_random_uuid(),
  name text not null, category text not null default 'safety'
    check (category in ('safety','privacy','access','content','model','audit')),
  scope text, enforcement text not null default 'enforce'
    check (enforcement in ('enforce','monitor','advise')),
  status text not null default 'active' check (status in ('active','draft','retired')),
  created_at timestamptz not null default now()
);

create table if not exists ais_evals (
  id uuid primary key default gen_random_uuid(),
  name text not null, eval_type text not null default 'quality'
    check (eval_type in ('quality','safety','accuracy','regression','benchmark')),
  target text, score numeric, passed boolean, runs int not null default 0,
  last_run timestamptz, created_at timestamptz not null default now()
);

create index if not exists idx_ais_ctx_domain on ais_context_sources(domain);
create index if not exists idx_ais_know_domain on ais_knowledge_sources(domain, status);
create index if not exists idx_ais_actions_status on ais_actions(status);
create index if not exists idx_ais_policies_cat on ais_policies(category, status);
create index if not exists idx_ais_evals_type on ais_evals(eval_type);

alter table ais_context_sources   enable row level security;
alter table ais_knowledge_sources enable row level security;
alter table ais_actions           enable row level security;
alter table ais_policies          enable row level security;
alter table ais_evals             enable row level security;

drop policy if exists ais_ctx_read on ais_context_sources;
create policy ais_ctx_read on ais_context_sources for select to authenticated using (true);
drop policy if exists ais_know_read on ais_knowledge_sources;
create policy ais_know_read on ais_knowledge_sources for select to authenticated using (true);
drop policy if exists ais_actions_read on ais_actions;
create policy ais_actions_read on ais_actions for select to authenticated using (true);
drop policy if exists ais_policies_read on ais_policies;
create policy ais_policies_read on ais_policies for select to authenticated using (true);
drop policy if exists ais_evals_read on ais_evals;
create policy ais_evals_read on ais_evals for select to authenticated using (true);
