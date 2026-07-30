-- 157: HWW instrument redesigns + unit tool resolution.
--   HWW-WARD-ACU-001  Ward acuity = rapid PEWS entry (total 0-15 + category-3 trigger + colour band)
--   HWW-WARD-WKL-001  Ward workload = 12 domains 0-3 (max 36) + modifiers + W1-W5 levels + ratio
--   HWW-ICU-ACU-001   ICU acuity = CIAF composite /100 (AACN Synergy + neuro + organ support + risk) + A1-A5
--   HWW-ICU-WKL-001   ICU workload = NAS (existing Miranda activities) + I1-I5 levels + ratio + override
--   HWW-UNIT-ASM-001  tools resolve from the patient's care location; wrong-tool submissions are 409-rejected
-- Additive schema changes so EXISTING rows (frameworks 'ward'/'icu'/'nas') stay valid and historical
-- assessments remain immutable under their original instrument:
--   op_acuity_assessments: score cap widens to 100 (CIAF composite; PEWS uses 0-15; legacy 0-18 rows valid);
--     new framework values 'pews' and 'ciaf'; classification carries the instrument-native band (PEWS colour /
--     A-level) while level keeps mapping to the operational spine vocabulary; category3 records the PEWS
--     special trigger; components keeps CIAF tool results inspectable.
--   op_workload_assessments: new framework value 'ward12'; level (W1-W5 / I1-I5), ratio, modifiers and the
--     professional-judgement override (mandatory reason enforced by the engine).
-- Constraint changes use drop-then-add (re-runnable). Plain idempotent statements only (no do-blocks).

alter table op_acuity_assessments add column if not exists classification text;
alter table op_acuity_assessments add column if not exists category3 boolean not null default false;
alter table op_acuity_assessments add column if not exists components jsonb not null default '{}'::jsonb;
alter table op_acuity_assessments add column if not exists reassess_by timestamptz;

alter table op_acuity_assessments drop constraint if exists op_acuity_assessments_score_check;
alter table op_acuity_assessments add constraint op_acuity_assessments_score_check
  check (score >= 0 and score <= 100);
alter table op_acuity_assessments drop constraint if exists op_acuity_assessments_framework_check;
alter table op_acuity_assessments add constraint op_acuity_assessments_framework_check
  check (framework in ('ward','icu','pews','ciaf'));

alter table op_workload_assessments add column if not exists level text;
alter table op_workload_assessments add column if not exists ratio text;
alter table op_workload_assessments add column if not exists modifiers jsonb not null default '[]'::jsonb;
alter table op_workload_assessments add column if not exists override_level text;
alter table op_workload_assessments add column if not exists override_reason text;

alter table op_workload_assessments drop constraint if exists op_workload_assessments_framework_check;
alter table op_workload_assessments add constraint op_workload_assessments_framework_check
  check (framework in ('nas','ward','ward12'));

notify pgrst, 'reload schema';
