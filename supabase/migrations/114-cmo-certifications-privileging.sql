-- Migration 114: Competency Office expansion part 1 — Certifications, Privileging, Assignments, Forecasts, Plans
-- (CMO-011 / CMO-012 / CMO-010 / CMO-019 / CMO-009). Reuses existing competency_* stores for gaps/review/readiness.
-- Plain statements only (kept tight so ;-splitting SQL runners apply every table). RLS = authenticated read.

create table if not exists cmo_certifications (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  staff_id uuid references profiles(id) on delete cascade,
  cert_type text not null default 'certification' check (cert_type in ('license','registration','certification','mandatory')),
  name text not null, issuer text, cert_number text, issued_date date, expiry_date date,
  status text not null default 'active' check (status in ('active','expiring','expired','pending','suspended')),
  verified boolean not null default false, created_at timestamptz not null default now()
);

create table if not exists cmo_privileges (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  staff_id uuid references profiles(id) on delete cascade,
  privilege_name text not null, category text not null default 'core'
    check (category in ('core','special','emergency','telemedicine','procedural')),
  status text not null default 'active' check (status in ('active','pending','expired','suspended','under_review')),
  granted_date date, expiry_date date, prerequisites_met boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists cmo_assignments (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  competency text not null, target_type text not null default 'individual'
    check (target_type in ('individual','role','team','department','enterprise')),
  target_label text, method text not null default 'role_based'
    check (method in ('role_based','manual','campaign','rule')),
  campaign text, due_date date, status text not null default 'assigned'
    check (status in ('assigned','in_progress','completed','overdue','exempt')),
  created_at timestamptz not null default now()
);

create table if not exists cmo_forecasts (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  competency text not null, current_supply int not null default 0, demand int not null default 0,
  gap int not null default 0, horizon text, risk text not null default 'low' check (risk in ('low','medium','high')),
  created_at timestamptz not null default now()
);

create table if not exists cmo_plans (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  name text not null, plan_type text not null default 'roadmap'
    check (plan_type in ('roadmap','investment','succession','recruitment','education')),
  horizon text, status text not null default 'active' check (status in ('draft','active','completed','on_hold')),
  progress_pct numeric not null default 0, budget numeric, created_at timestamptz not null default now()
);

create index if not exists idx_cmo_cert_hosp on cmo_certifications(hospital_id, status);
create index if not exists idx_cmo_priv_hosp on cmo_privileges(hospital_id, status);
create index if not exists idx_cmo_assign_hosp on cmo_assignments(hospital_id, status);
create index if not exists idx_cmo_forecast_hosp on cmo_forecasts(hospital_id);
create index if not exists idx_cmo_plans_hosp on cmo_plans(hospital_id);

alter table cmo_certifications enable row level security;
alter table cmo_privileges     enable row level security;
alter table cmo_assignments    enable row level security;
alter table cmo_forecasts      enable row level security;
alter table cmo_plans          enable row level security;

drop policy if exists cmo_cert_read on cmo_certifications;
create policy cmo_cert_read on cmo_certifications for select to authenticated using (true);
drop policy if exists cmo_priv_read on cmo_privileges;
create policy cmo_priv_read on cmo_privileges for select to authenticated using (true);
drop policy if exists cmo_assign_read on cmo_assignments;
create policy cmo_assign_read on cmo_assignments for select to authenticated using (true);
drop policy if exists cmo_forecast_read on cmo_forecasts;
create policy cmo_forecast_read on cmo_forecasts for select to authenticated using (true);
drop policy if exists cmo_plans_read on cmo_plans;
create policy cmo_plans_read on cmo_plans for select to authenticated using (true);
