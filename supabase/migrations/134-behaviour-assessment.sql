-- 134: CST-040 Professional Behaviour Assessment — behaviour-indicator designer. An assessment defines a
-- rating scale (BARS by default) and a set of observable behaviour indicators across the professional
-- domains (professionalism / communication / teamwork / leadership / ethics / patient-centred / cultural /
-- accountability), each with positive & negative anchors and an optional critical flag. Plain, idempotent
-- statements only. RLS = authenticated read; service-role writes.

create table if not exists cst_behaviour_assessments (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid references hospitals(id) on delete cascade,
  name              text not null,
  description       text,
  rating_scale      text not null default 'bars' check (rating_scale in ('bars','likert5','likert3','binary','global')),
  status            text not null default 'draft' check (status in ('draft','active','archived')),
  created_by        uuid references profiles(id) on delete set null,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_cstbeh_hospital on cst_behaviour_assessments(hospital_id);
create index if not exists idx_cstbeh_status on cst_behaviour_assessments(status);
alter table cst_behaviour_assessments enable row level security;
drop policy if exists cst_behaviour_assessments_read on cst_behaviour_assessments;
create policy cst_behaviour_assessments_read on cst_behaviour_assessments for select to authenticated using (true);

create table if not exists cst_behaviour_indicators (
  id                uuid primary key default gen_random_uuid(),
  assessment_id     uuid not null references cst_behaviour_assessments(id) on delete cascade,
  domain            text not null default 'professionalism'
                      check (domain in ('professionalism','communication','teamwork','leadership','ethics','patient_centred','cultural','accountability')),
  statement         text not null,
  positive_anchor   text,
  negative_anchor   text,
  is_critical       boolean not null default false,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists idx_cstbehind_assessment on cst_behaviour_indicators(assessment_id);
alter table cst_behaviour_indicators enable row level security;
drop policy if exists cst_behaviour_indicators_read on cst_behaviour_indicators;
create policy cst_behaviour_indicators_read on cst_behaviour_indicators for select to authenticated using (true);

notify pgrst, 'reload schema';
