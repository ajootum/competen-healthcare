-- 153: HWW-WARD-001 §4 / HWW-ICU-001 §6-7 / HWW-AE-001 §3 — Acuity & Workload assessment stores.
-- The reassessment spine of the bedside workspace: patients are scored REPEATEDLY through a shift with full
-- history ("continuous reassessment"), and these scores are the Assignment & Workload Engine's primary inputs.
-- One generic pair with a framework discriminator, not ICU-specific tables:
--   op_acuity_assessments   framework 'ward' (Competen Ward Acuity, 6 domains 0-3, score 0-18) or
--                           'icu' (Competen ICU Acuity Assessment, 6 organ-system domains 0-3)
--   op_workload_assessments framework 'nas' (Nursing Activities Score, Miranda 2003 weightings, score = % of
--                           one nurse's capacity) or 'ward' (ward workload components)
-- domains/items jsonb hold the per-component selections so the instrument stays inspectable; score/level are
-- computed server-side by the shipped engine (src/lib/hww/assessments.ts) — never trusted from the client.
-- significant_change flags reassessments that jump ≥4 points or change level ("acuity changes trigger
-- assignment review", WARD-001 §10) — the recording engine also syncs op_patients.acuity_level so every
-- existing surface (dashboards, safety centre, ward map) sees the new state immediately.
-- Tenancy: rows belong to the PATIENT's hospital (subject-scoped). Plain, idempotent statements only
-- (no do-blocks). RLS = authenticated read; service-role writes.

create table if not exists op_acuity_assessments (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid references hospitals(id) on delete cascade,
  department_id  uuid references departments(id) on delete set null,
  unit_id        uuid references units(id) on delete set null,
  patient_id     uuid not null references op_patients(id) on delete cascade,
  shift_id       uuid references op_shifts(id) on delete set null,
  framework      text not null default 'ward' check (framework in ('ward','icu')),
  score          int not null check (score >= 0 and score <= 18),
  level          text not null check (level in ('stable','moderate','high','critical')),
  domains        jsonb not null default '{}'::jsonb,        -- per-domain 0-3 component scores
  previous_score int,                                       -- latest prior score at recording time
  significant_change boolean not null default false,        -- |Δ| >= 4 or level change vs previous
  assessed_by    uuid references profiles(id) on delete set null,
  assessed_by_name text,
  assessed_at    timestamptz not null default now(),
  notes          text,
  created_at     timestamptz not null default now()
);

create table if not exists op_workload_assessments (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid references hospitals(id) on delete cascade,
  department_id  uuid references departments(id) on delete set null,
  unit_id        uuid references units(id) on delete set null,
  patient_id     uuid not null references op_patients(id) on delete cascade,
  shift_id       uuid references op_shifts(id) on delete set null,
  framework      text not null default 'nas' check (framework in ('nas','ward')),
  items          jsonb not null default '[]'::jsonb,        -- selected instrument item keys
  score          numeric(6,1) not null check (score >= 0),  -- NAS: sum of item weightings
  percentage     numeric(6,1) not null check (percentage >= 0), -- % of one nurse's capacity (NAS: = score)
  assessed_by    uuid references profiles(id) on delete set null,
  assessed_by_name text,
  assessed_at    timestamptz not null default now(),
  notes          text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_op_acuity_patient   on op_acuity_assessments(patient_id, assessed_at desc);
create index if not exists idx_op_acuity_hosp      on op_acuity_assessments(hospital_id, assessed_at desc);
create index if not exists idx_op_acuity_shift     on op_acuity_assessments(shift_id);
create index if not exists idx_op_acuity_assessor  on op_acuity_assessments(assessed_by, assessed_at desc);
create index if not exists idx_op_workload_patient on op_workload_assessments(patient_id, assessed_at desc);
create index if not exists idx_op_workload_hosp    on op_workload_assessments(hospital_id, assessed_at desc);
create index if not exists idx_op_workload_shift   on op_workload_assessments(shift_id);

alter table op_acuity_assessments enable row level security;
alter table op_workload_assessments enable row level security;
drop policy if exists op_acuity_assessments_read on op_acuity_assessments;
create policy op_acuity_assessments_read on op_acuity_assessments for select to authenticated using (true);
drop policy if exists op_workload_assessments_read on op_workload_assessments;
create policy op_workload_assessments_read on op_workload_assessments for select to authenticated using (true);

notify pgrst, 'reload schema';
