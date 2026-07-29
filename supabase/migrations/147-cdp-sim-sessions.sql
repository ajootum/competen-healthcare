-- 147: CDP-005 Clinical Simulation & Practice — practice sessions + debrief. The scenario library and the
-- branching runtime exist, but a practice run was never captured. This records a deliberate-practice session
-- against a scenario with a structured debrief (what went well / to improve / action plan) and a self-rating,
-- so simulation becomes measurable delivery — participation, coverage and follow-up. A "needs_practice" outcome
-- seeds a reinforcement card. Plain, idempotent statements only. RLS = authenticated read; service-role writes.

create table if not exists cdp_sim_sessions (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid references hospitals(id) on delete set null,
  nurse_id        uuid not null references profiles(id) on delete cascade,
  scenario_id     uuid references simulation_scenarios(id) on delete set null,
  scenario_name   text,
  scenario_type   text,
  competency_id   uuid references framework_competencies(id) on delete set null,
  competency_name text,
  outcome         text not null default 'completed' check (outcome in ('completed','needs_practice')),
  self_rating     int,                               -- 1..5 confidence after the run
  duration_min    int,
  went_well       text,
  to_improve      text,
  action_plan     text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_cdp_sim_nurse on cdp_sim_sessions(nurse_id);
create index if not exists idx_cdp_sim_hospital on cdp_sim_sessions(hospital_id);
create index if not exists idx_cdp_sim_type on cdp_sim_sessions(scenario_type);

alter table cdp_sim_sessions enable row level security;
drop policy if exists cdp_sim_read on cdp_sim_sessions;
create policy cdp_sim_read on cdp_sim_sessions for select to authenticated using (true);

notify pgrst, 'reload schema';
