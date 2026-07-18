-- 030: Assessment scheduling (Assessor Workspace redesign — calendar and
-- Today's Schedule need a real store; doc §D "assessment assignment and
-- scheduling"). Writes go through /api/schedule (service role); RLS gives the
-- assessor and the nurse read access to their own sessions.
create table if not exists scheduled_assessments (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid references hospitals(id) on delete set null,
  nurse_id      uuid not null references profiles(id) on delete cascade,
  assessor_id   uuid not null references profiles(id) on delete cascade,
  competency_id uuid references framework_competencies(id) on delete set null,
  method        text not null default 'direct_observation',
  scheduled_for timestamptz not null,
  location      text,
  note          text,
  status        text not null default 'scheduled',  -- scheduled | completed | cancelled
  created_at    timestamptz not null default now()
);
create index if not exists idx_sched_assessor on scheduled_assessments(assessor_id, scheduled_for);
create index if not exists idx_sched_nurse    on scheduled_assessments(nurse_id, scheduled_for);

alter table scheduled_assessments enable row level security;
do $$ begin
  create policy sched_select_involved on scheduled_assessments
    for select using (nurse_id = auth.uid() or assessor_id = auth.uid());
exception when duplicate_object then null; end $$;
