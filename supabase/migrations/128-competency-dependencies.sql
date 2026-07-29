-- 128: CST-105 Competency Dependency Manager — competency↔competency sequencing relationships.
-- Prerequisite / co-requisite / recommended / inherited links (the "what must be achieved before
-- progression" graph). Equivalency/recognition lives separately in competency_equivalencies (migration
-- 123); this table is the progression/sequencing spine. Plain, idempotent statements only (no do-blocks).
-- RLS = authenticated read; service-role writes.

create table if not exists competency_dependencies (
  id                    uuid primary key default gen_random_uuid(),
  hospital_id           uuid references hospitals(id) on delete cascade,
  source_competency_id  uuid not null references framework_competencies(id) on delete cascade,
  target_competency_id  uuid not null references framework_competencies(id) on delete cascade,
  dependency_type       text not null default 'prerequisite'
                          check (dependency_type in ('prerequisite','co_requisite','recommended','inherited')),
  notes                 text,
  created_by            uuid references profiles(id) on delete set null,
  created_by_name       text,
  created_at            timestamptz not null default now()
);

create unique index if not exists uq_competency_dependencies
  on competency_dependencies (source_competency_id, target_competency_id, dependency_type);
create index if not exists idx_compdep_source on competency_dependencies(source_competency_id);
create index if not exists idx_compdep_target on competency_dependencies(target_competency_id);
create index if not exists idx_compdep_hospital on competency_dependencies(hospital_id);

alter table competency_dependencies enable row level security;
drop policy if exists competency_dependencies_read on competency_dependencies;
create policy competency_dependencies_read on competency_dependencies for select to authenticated using (true);

notify pgrst, 'reload schema';
