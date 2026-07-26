-- Migration 109: UMW Administration & Configuration — Structure, Documents & Assets (ADM-002/003/004).
-- Part 1 of 2 (see 110 for forms/config/governance/change/AI) — split to stay short so ;-splitting SQL runners
-- apply every statement (migration 108's last table was truncated by a long paste). Reuses existing departments /
-- op_beds / positions for structure; adds the genuinely-new admin stores. Plain statements only (no do-block).
-- RLS = authenticated read + service-role write.

-- ── Unit profile (one row per unit — identity/specialty/cost-centre/hours/manager/config version)
create table if not exists adm_unit_profile (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid references hospitals(id) on delete cascade,
  department_id     uuid references departments(id) on delete set null,
  unit_name         text not null,
  unit_code         text,
  specialty         text,
  cost_centre       text,
  location          text,
  operational_hours text default '24/7',
  manager_id        uuid references profiles(id) on delete set null,
  established_on    date,
  config_version    text,
  created_at        timestamptz not null default now()
);

-- ── Rooms (physical layout)
create table if not exists adm_rooms (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  name        text not null,
  room_type   text not null default 'patient' check (room_type in ('patient','clinical_support','staff','utility','isolation','theatre','store','nurse_station')),
  floor       text,
  bed_count   int not null default 0,
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now()
);

-- ── Service catalogue
create table if not exists adm_services (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  name        text not null,
  category    text,
  cases       int not null default 0,
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now()
);

-- ── Operational rules
create table if not exists adm_operational_rules (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  name        text not null,
  rule_type   text not null default 'admission' check (rule_type in ('admission','bed_allocation','patient_flow','escalation','staffing','emergency','coverage','continuity')),
  status      text not null default 'active' check (status in ('active','inactive','draft')),
  created_at  timestamptz not null default now()
);

-- ── Documents (policies / SOPs / guidelines / protocols / forms — the controlled document library)
create table if not exists adm_documents (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid references hospitals(id) on delete cascade,
  title             text not null,
  doc_type          text not null default 'policy' check (doc_type in ('policy','sop','guideline','protocol','form','work_instruction')),
  category          text,
  status            text not null default 'draft' check (status in ('draft','in_review','pending_approval','published','archived')),
  version           text default '1.0',
  owner_id          uuid references profiles(id) on delete set null,
  review_date       date,
  acknowledgement_pct numeric,
  regulatory        text,
  created_at        timestamptz not null default now()
);

-- ── Assets (richer asset register than op_equipment — location, maintenance/calibration/warranty, custodian, vendor)
create table if not exists adm_assets (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid references hospitals(id) on delete cascade,
  name              text not null,
  asset_tag         text,
  category          text not null default 'clinical' check (category in ('clinical','it','furniture','infrastructure','emergency','other')),
  status            text not null default 'in_service' check (status in ('in_service','under_maintenance','out_of_service','in_storage','pending')),
  location          text,
  custodian_id      uuid references profiles(id) on delete set null,
  maintenance_due   date,
  calibration_due   date,
  warranty_expiry   date,
  vendor            text,
  utilisation_pct   numeric,
  created_at        timestamptz not null default now()
);

-- ── Indexes
create index if not exists idx_adm_profile_hosp on adm_unit_profile(hospital_id);
create index if not exists idx_adm_rooms_hosp on adm_rooms(hospital_id);
create index if not exists idx_adm_services_hosp on adm_services(hospital_id);
create index if not exists idx_adm_rules_hosp on adm_operational_rules(hospital_id);
create index if not exists idx_adm_docs_hosp on adm_documents(hospital_id, status);
create index if not exists idx_adm_assets_hosp on adm_assets(hospital_id, status);

-- ── RLS (plain statements)
alter table adm_unit_profile      enable row level security;
alter table adm_rooms             enable row level security;
alter table adm_services          enable row level security;
alter table adm_operational_rules enable row level security;
alter table adm_documents         enable row level security;
alter table adm_assets            enable row level security;

drop policy if exists adm_profile_read on adm_unit_profile;
create policy adm_profile_read on adm_unit_profile for select to authenticated using (true);
drop policy if exists adm_rooms_read on adm_rooms;
create policy adm_rooms_read on adm_rooms for select to authenticated using (true);
drop policy if exists adm_services_read on adm_services;
create policy adm_services_read on adm_services for select to authenticated using (true);
drop policy if exists adm_rules_read on adm_operational_rules;
create policy adm_rules_read on adm_operational_rules for select to authenticated using (true);
drop policy if exists adm_docs_read on adm_documents;
create policy adm_docs_read on adm_documents for select to authenticated using (true);
drop policy if exists adm_assets_read on adm_assets;
create policy adm_assets_read on adm_assets for select to authenticated using (true);
