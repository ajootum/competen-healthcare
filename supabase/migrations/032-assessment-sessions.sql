-- 032: Conduct Assessment session records (cockpit "fix the omissions" pass).
-- Persists each conducted session: method, duration, the assessor's overall
-- RECOMMENDATION (advisory — formal decisions stay with the educator/admin
-- decision run), feedback text, and e-signature file paths (PNGs drawn on the
-- cockpit signature pads, stored in the private "evidence" bucket).
create table if not exists assessment_sessions (
  id             uuid primary key default gen_random_uuid(),
  cycle_id       uuid not null references competency_cycles(id) on delete cascade,
  nurse_id       uuid not null references profiles(id) on delete cascade,
  assessor_id    uuid not null references profiles(id) on delete cascade,
  hospital_id    uuid references hospitals(id) on delete set null,
  scheduled_assessment_id uuid references scheduled_assessments(id) on delete set null,
  method         text not null,
  location       text,
  duration_seconds int,
  scored_count   int not null default 0,
  recommendation text check (recommendation in
                   ('competent','competent_with_supervision','needs_development',
                    'reassessment_required','critical_failure')),
  strengths      text,
  improvements   text,
  assessor_signature_path text,
  learner_signature_path  text,
  witness_name   text,
  witness_signature_path  text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_sessions_nurse    on assessment_sessions(nurse_id, created_at desc);
create index if not exists idx_sessions_assessor on assessment_sessions(assessor_id, created_at desc);

alter table assessment_sessions enable row level security;
do $$ begin
  create policy sessions_select_involved on assessment_sessions
    for select using (nurse_id = auth.uid() or assessor_id = auth.uid());
exception when duplicate_object then null; end $$;
-- No client insert/update policies: writes go through /api/assess/submit (service role).
