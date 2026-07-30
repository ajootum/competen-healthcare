-- 155: HWW-AE-001 - Assignment & Workload Engine recommendation store.
-- Each row is one GENERATED recommendation run for a shift's unit: the input snapshot (who was on duty,
-- which patients, the weights and caps used), the explainable nurse-to-patient proposals, coverage gaps,
-- risk alerts and per-nurse projected loads - then the charge nurse's decision trail (published /
-- partially published / discarded, with professional-judgement notes). The PUBLISHED assignments land in
-- op_patient_assignments (the real store, same semantics as the single-assignment API: primary uniqueness,
-- competency validation, mandatory override reason); this table is the decision + explainability record
-- (spec S6 explainability report, S8 AssignmentRecommendation/AssignmentOverride; AssignmentHistory = the
-- op_patient_assignments rows + audit_log).
-- Tenancy: rows belong to the shift's hospital. Plain, idempotent statements only (no do-blocks).
-- RLS = authenticated read; service-role writes.

create table if not exists op_assignment_recommendations (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid references hospitals(id) on delete cascade,
  shift_id        uuid references op_shifts(id) on delete set null,
  department_id   uuid references departments(id) on delete set null,
  unit_id         uuid references units(id) on delete set null,
  status          text not null default 'generated'
                    check (status in ('generated','published','partially_published','discarded')),
  inputs          jsonb not null default '{}'::jsonb,   -- snapshot: nurse/patient counts, cap, weight defaults
  proposals       jsonb not null default '[]'::jsonb,   -- [{patient_id,patient,staff_id,nurse,explanation,load_after,continuity,needs_override,flags}]
  gaps            jsonb not null default '[]'::jsonb,   -- [{patient_id,patient,reason}]
  risk_alerts     jsonb not null default '[]'::jsonb,   -- [{severity,text}]
  nurse_loads     jsonb not null default '[]'::jsonb,   -- [{staff_id,nurse,patients,load,overloaded}]
  generated_by    uuid references profiles(id) on delete set null,
  generated_by_name text,
  created_at      timestamptz not null default now(),
  acted_by        uuid references profiles(id) on delete set null,
  acted_at        timestamptz,
  action_notes    text                                   -- publish/override/discard notes (professional judgement)
);

create index if not exists idx_op_asg_rec_hosp  on op_assignment_recommendations(hospital_id, created_at desc);
create index if not exists idx_op_asg_rec_shift on op_assignment_recommendations(shift_id);

alter table op_assignment_recommendations enable row level security;
drop policy if exists op_assignment_recommendations_read on op_assignment_recommendations;
create policy op_assignment_recommendations_read on op_assignment_recommendations for select to authenticated using (true);

notify pgrst, 'reload schema';
