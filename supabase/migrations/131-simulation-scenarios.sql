-- 131: CST-006 Simulation Studio — persistent, versioned simulation scenario store. Today simulations
-- exist as AI drafts + static briefs + delivery runtime; this adds the authoring store: named, typed,
-- competency-linked, versioned scenarios with a publish lifecycle. The visual branching flow-builder
-- (nodes / decisions / outcomes) is the next-phase layer on top of this store. Plain, idempotent
-- statements only (no do-blocks). RLS = authenticated read; service-role writes.

create table if not exists simulation_scenarios (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid references hospitals(id) on delete cascade,
  name              text not null,
  description       text,
  scenario_type     text not null default 'clinical'
                      check (scenario_type in ('mock_code','emergency','virtual_patient','skills','team','procedure','communication','disaster','orientation','reassessment','clinical')),
  competency_id     uuid references framework_competencies(id) on delete set null,
  competency_name   text,
  difficulty        text not null default 'intermediate' check (difficulty in ('beginner','intermediate','advanced')),
  participants      int default 1,
  duration_min      int,
  status            text not null default 'draft' check (status in ('draft','published','archived')),
  version           text not null default '1.0.0',
  created_by        uuid references profiles(id) on delete set null,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_simscn_hospital on simulation_scenarios(hospital_id);
create index if not exists idx_simscn_status on simulation_scenarios(status);
create index if not exists idx_simscn_competency on simulation_scenarios(competency_id);

alter table simulation_scenarios enable row level security;
drop policy if exists simulation_scenarios_read on simulation_scenarios;
create policy simulation_scenarios_read on simulation_scenarios for select to authenticated using (true);

notify pgrst, 'reload schema';
