-- Migration 108: UMW Performance Analytics (UMW-PA-001..009)
-- The Unit Manager's executive performance layer — a metadata-driven KPI + balanced-scorecard + benchmark + trend
-- model spanning clinical, operational, workforce, financial and learning domains. KPIs whose `snapshot_field` maps
-- to an op_ops_snapshots column resolve their current value LIVE from real operational data at load time; the rest
-- carry seeded demo values. Read model here; no-code KPI/scorecard authoring is the next build phase. Writes go
-- through the service-role API layer; RLS is defence-in-depth (authenticated read; service role writes).
-- All statements are plain (no PL/pgSQL do-block) so ;-splitting SQL runners apply them cleanly.

-- ── Balanced scorecard perspectives (Clinical Quality / Patient Experience / Operations / Workforce / Financial / …)
create table if not exists pa_perspectives (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  name        text not null,
  color       text not null default '#0ea5e9',
  icon        text,
  weight      numeric not null default 1,
  target_pct  numeric,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- ── KPI catalogue (the heart — metadata-driven definitions with targets, RAG thresholds and an optional live source)
create table if not exists pa_kpis (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid references hospitals(id) on delete cascade,
  perspective_id  uuid references pa_perspectives(id) on delete set null,
  code            text,
  name            text not null,
  category        text,
  unit            text,
  direction       text not null default 'higher_better' check (direction in ('higher_better','lower_better')),
  target          numeric,
  threshold_amber numeric,
  threshold_red   numeric,
  current_value   numeric,
  previous_value  numeric,
  data_source     text,
  snapshot_field  text,
  owner_id        uuid references profiles(id) on delete set null,
  status          text not null default 'active' check (status in ('active','draft','archived')),
  version         int not null default 1,
  created_at      timestamptz not null default now()
);

-- ── KPI trend values (immutable historical snapshots for trend/SPC analytics)
create table if not exists pa_kpi_values (
  id      uuid primary key default gen_random_uuid(),
  kpi_id  uuid not null references pa_kpis(id) on delete cascade,
  period  date not null,
  value   numeric not null,
  unique (kpi_id, period)
);

-- ── Benchmarks per KPI (target / hospital average / peer / specialty / enterprise / best-performing)
create table if not exists pa_benchmarks (
  id         uuid primary key default gen_random_uuid(),
  kpi_id     uuid not null references pa_kpis(id) on delete cascade,
  comparator text not null check (comparator in ('target','hospital_avg','peer','specialty','enterprise','best')),
  value      numeric not null
);

-- ── Improvement projects (the improvement centre + executive actions)
create table if not exists pa_improvement_projects (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid references hospitals(id) on delete cascade,
  name           text not null,
  perspective_id uuid references pa_perspectives(id) on delete set null,
  status         text not null default 'on_track' check (status in ('on_track','at_risk','overdue','on_hold','completed')),
  progress_pct   numeric not null default 0,
  benefit        numeric,
  owner_id       uuid references profiles(id) on delete set null,
  due_date       date,
  created_at     timestamptz not null default now()
);

-- ── Financial cost centres (budget vs actual by centre — the financial analytics base)
create table if not exists pa_cost_centres (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  name        text not null,
  actual      numeric not null default 0,
  budget      numeric not null default 0,
  category    text,
  created_at  timestamptz not null default now()
);

-- ── Executive reports (reporting & governance centre)
create table if not exists pa_reports (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  name        text not null,
  frequency   text,
  status      text not null default 'draft' check (status in ('draft','in_progress','pending','completed','published','not_started')),
  due_date    date,
  format      text,
  owner_id    uuid references profiles(id) on delete set null,
  recipients  int not null default 0,
  distributed boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ── AI predictions / recommendations / risks (predictive & AI intelligence centre)
create table if not exists pa_predictions (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid references hospitals(id) on delete cascade,
  kpi_id          uuid references pa_kpis(id) on delete set null,
  kind            text not null default 'prediction' check (kind in ('prediction','recommendation','risk','alert')),
  title           text not null,
  detail          text,
  predicted_value numeric,
  confidence      numeric,
  risk            text,
  impact          text,
  horizon         text,
  benefit         numeric,
  created_at      timestamptz not null default now()
);

-- ── Indexes
create index if not exists idx_pa_persp_hosp on pa_perspectives(hospital_id, sort_order);
create index if not exists idx_pa_kpis_hosp on pa_kpis(hospital_id, status);
create index if not exists idx_pa_kpis_persp on pa_kpis(perspective_id);
create index if not exists idx_pa_kpi_values_kpi on pa_kpi_values(kpi_id, period);
create index if not exists idx_pa_bench_kpi on pa_benchmarks(kpi_id);
create index if not exists idx_pa_improve_hosp on pa_improvement_projects(hospital_id, status);
create index if not exists idx_pa_cost_hosp on pa_cost_centres(hospital_id);
create index if not exists idx_pa_reports_hosp on pa_reports(hospital_id, status);
create index if not exists idx_pa_pred_hosp on pa_predictions(hospital_id, kind);

-- ── RLS (defence-in-depth; authenticated read, service-role write). Plain per-table statements.
alter table pa_perspectives         enable row level security;
alter table pa_kpis                 enable row level security;
alter table pa_kpi_values           enable row level security;
alter table pa_benchmarks           enable row level security;
alter table pa_improvement_projects enable row level security;
alter table pa_cost_centres         enable row level security;
alter table pa_reports              enable row level security;
alter table pa_predictions          enable row level security;

drop policy if exists pa_perspectives_read on pa_perspectives;
create policy pa_perspectives_read on pa_perspectives for select to authenticated using (true);
drop policy if exists pa_kpis_read on pa_kpis;
create policy pa_kpis_read on pa_kpis for select to authenticated using (true);
drop policy if exists pa_kpi_values_read on pa_kpi_values;
create policy pa_kpi_values_read on pa_kpi_values for select to authenticated using (true);
drop policy if exists pa_benchmarks_read on pa_benchmarks;
create policy pa_benchmarks_read on pa_benchmarks for select to authenticated using (true);
drop policy if exists pa_improve_read on pa_improvement_projects;
create policy pa_improve_read on pa_improvement_projects for select to authenticated using (true);
drop policy if exists pa_cost_read on pa_cost_centres;
create policy pa_cost_read on pa_cost_centres for select to authenticated using (true);
drop policy if exists pa_reports_read on pa_reports;
create policy pa_reports_read on pa_reports for select to authenticated using (true);
drop policy if exists pa_pred_read on pa_predictions;
create policy pa_pred_read on pa_predictions for select to authenticated using (true);
