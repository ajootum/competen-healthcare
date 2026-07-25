-- 100: Mortality & Morbidity Centre (UMG-QS-009) — the store behind the M&M review platform. A unified case
-- register (mortality + morbidity) drives the review lifecycle (new → initial review → RCA → peer review →
-- CAPA → closed), preventability scoring, cause-of-death coding and RCA/CAPA completion; contributory factors
-- are a child table (many per case); period stats hold the discharge denominators so mortality/morbidity RATES
-- are real. No PHI — patients are referenced by opaque label + age/sex band only. Idempotent; RLS service-role
-- only (writes via the admin client behind hospital_admin/super_admin-gated surfaces), mirroring the quality stores.

create table if not exists mm_cases (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid references hospitals(id) on delete cascade,
  case_ref          text unique,                        -- M-2026-0189 (mortality) / B-2026-0212 (morbidity)
  case_type         text not null check (case_type in ('mortality','morbidity')),
  patient_ref       text,                               -- opaque label only, e.g. P-000189
  patient_age       int,
  patient_sex       text check (patient_sex in ('M','F','O')),
  unit              text,                               -- ICU / Neuro Ward / Theatres …
  event_date        date not null,                      -- date of death / date of morbidity event
  primary_diagnosis text,                               -- mortality
  event_type        text,                               -- morbidity (Unplanned ICU Admission, Medication Harm, …)
  severity          text check (severity in ('serious','moderate','minor')),   -- morbidity
  cause_of_death    text,
  cause_category    text check (cause_category in ('sepsis','neurological','cardiorespiratory','postoperative','haemorrhage','other')),
  status            text not null default 'new'
                      check (status in ('new','initial_review','rca_in_progress','peer_review','pending_capa','closed')),
  preventability    text check (preventability in ('definitely','probably','possibly','probably_not','not','insufficient')),
  rca_required      boolean default false,
  rca_status        text not null default 'not_started' check (rca_status in ('not_started','in_progress','complete')),
  capa_required     boolean default false,
  capa_status       text not null default 'not_started' check (capa_status in ('not_started','in_progress','complete')),
  review_meeting_date date,
  created_at        timestamptz not null default now()
);
create index if not exists idx_mm_cases_hosp on mm_cases(hospital_id, event_date desc);
create index if not exists idx_mm_cases_type on mm_cases(case_type, status);

create table if not exists mm_contributory_factors (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references mm_cases(id) on delete cascade,
  factor     text not null check (factor in ('infection_sepsis','delay_diagnosis','clinical_decision','communication','resource_equipment','documentation','medication','monitoring')),
  created_at timestamptz not null default now()
);
create index if not exists idx_mm_factors_case on mm_contributory_factors(case_id);

create table if not exists mm_period_stats (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  period      date not null,                            -- month the stats cover
  discharges  int not null default 0,
  admissions  int not null default 0,
  unique (hospital_id, period)
);

alter table mm_cases enable row level security;
alter table mm_contributory_factors enable row level security;
alter table mm_period_stats enable row level security;
-- No client policies on purpose: reads/writes go through the service-role admin client behind gated surfaces.
