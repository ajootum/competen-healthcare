-- 129: CST-108 Standards Mapping Centre — competency ↔ external standard mappings for regulatory
-- traceability. Maps a competency to a named standard clause (WHO / JCI / SafeCare / MOH / council / …)
-- at a coverage level (full / partial / reference). Standard reference is free text because standard
-- codes are heterogeneous across bodies; the competency is the FK. Plain, idempotent statements only
-- (no do-blocks). RLS = authenticated read; service-role writes.

create table if not exists competency_standard_mappings (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid references hospitals(id) on delete cascade,
  competency_id     uuid not null references framework_competencies(id) on delete cascade,
  standard_body     text not null default 'other',
  standard_ref      text not null,
  standard_title    text,
  coverage          text not null default 'full' check (coverage in ('full','partial','reference')),
  notes             text,
  created_by        uuid references profiles(id) on delete set null,
  created_by_name   text,
  created_at        timestamptz not null default now()
);

create unique index if not exists uq_comp_std_mapping on competency_standard_mappings (competency_id, standard_body, standard_ref);
create index if not exists idx_csm_competency on competency_standard_mappings(competency_id);
create index if not exists idx_csm_body on competency_standard_mappings(standard_body);
create index if not exists idx_csm_hospital on competency_standard_mappings(hospital_id);

alter table competency_standard_mappings enable row level security;
drop policy if exists competency_standard_mappings_read on competency_standard_mappings;
create policy competency_standard_mappings_read on competency_standard_mappings for select to authenticated using (true);

notify pgrst, 'reload schema';
