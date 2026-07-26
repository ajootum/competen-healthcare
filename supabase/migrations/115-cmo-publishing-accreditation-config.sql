-- Migration 115: Competency Office expansion part 2 — Publishing, Accreditation, Config, AI (CMO-015/016/020/017).
-- Plain statements only. RLS = authenticated read + service-role write.

create table if not exists cmo_publications (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  name text not null, artifact_type text not null default 'framework'
    check (artifact_type in ('framework','standard','blueprint','pathway','package','mapping')),
  version text default '1.0', target text default 'enterprise'
    check (target in ('enterprise','tenant','role','profession','workspace')),
  status text not null default 'draft'
    check (status in ('draft','in_review','approved','published','scheduled','rolled_back')),
  published_at timestamptz, created_at timestamptz not null default now()
);

create table if not exists cmo_accreditations (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  standard text not null default 'JCI', requirement text not null, mapped_competency text,
  coverage_pct numeric, compliance_status text not null default 'partial'
    check (compliance_status in ('compliant','partial','gap','not_mapped')),
  evidence_count int not null default 0, created_at timestamptz not null default now()
);

create table if not exists cmo_config (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  config_key text not null, name text not null, category text not null default 'general'
    check (category in ('scoring','workflow','approval','notification','ai','rules','general')),
  value text, source text not null default 'local' check (source in ('inherited','local')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

create table if not exists cmo_ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  title text not null, detail text, category text not null default 'gap'
    check (category in ('gap','risk','readiness','certification','privileging','planning')),
  confidence numeric, impact text not null default 'medium' check (impact in ('low','medium','high')),
  status text not null default 'open' check (status in ('open','accepted','dismissed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_cmo_pub_hosp on cmo_publications(hospital_id, status);
create index if not exists idx_cmo_accr_hosp on cmo_accreditations(hospital_id, standard);
create index if not exists idx_cmo_config_hosp on cmo_config(hospital_id, category);
create index if not exists idx_cmo_airec_hosp on cmo_ai_recommendations(hospital_id, status);

alter table cmo_publications      enable row level security;
alter table cmo_accreditations    enable row level security;
alter table cmo_config            enable row level security;
alter table cmo_ai_recommendations enable row level security;

drop policy if exists cmo_pub_read on cmo_publications;
create policy cmo_pub_read on cmo_publications for select to authenticated using (true);
drop policy if exists cmo_accr_read on cmo_accreditations;
create policy cmo_accr_read on cmo_accreditations for select to authenticated using (true);
drop policy if exists cmo_config_read on cmo_config;
create policy cmo_config_read on cmo_config for select to authenticated using (true);
drop policy if exists cmo_airec_read on cmo_ai_recommendations;
create policy cmo_airec_read on cmo_ai_recommendations for select to authenticated using (true);
