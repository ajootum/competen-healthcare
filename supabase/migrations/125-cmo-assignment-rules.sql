-- 125: COMP-018 Competency Assignment & Distribution Engine — the RULES primitive. A rule pairs a POPULATION
-- (role, matched against profiles.role / roles[]) with a competency and a cadence (priority / due window /
-- recurrence / trigger). Applying a rule MATERIALISES it into one target-based cmo_assignments row
-- (method='rule', already valid in mig 114). Plain, idempotent statements only (no do-blocks).
-- RLS = authenticated read; service-role (admin API) writes.

create table if not exists cmo_assignment_rules (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  name text not null,
  target_role text,                 -- role to match against profiles.role / profiles.roles[]; null=any
  target_label text,                -- human label for the population, e.g. "ICU Nurses"
  competency_id uuid references framework_competencies(id) on delete set null,
  competency_name text,             -- denormalized (cmo_assignments.competency is TEXT)
  priority text not null default 'medium',    -- low | medium | high
  due_days int not null default 30,
  recurrence_months int,            -- null = one-off
  trigger text,                     -- manual | role_change | dept_change | annual
  is_active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz default now()
);
create index if not exists idx_cmo_rules_hospital on cmo_assignment_rules(hospital_id);
create index if not exists idx_cmo_rules_competency on cmo_assignment_rules(competency_id);
alter table cmo_assignment_rules enable row level security;
drop policy if exists cmo_rules_read on cmo_assignment_rules;
create policy cmo_rules_read on cmo_assignment_rules for select to authenticated using (true);
