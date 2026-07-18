-- 033: OSCE Management Centre (Assessor Workspace spec). Lean OSCE core:
-- exams → stations (each optionally linked to a framework competency and an
-- assigned examiner) → registered candidates → per-station results (0–6 Benner
-- scale). Completing an exam feeds the real assessment engine: one
-- `assessments` row (method 'osce') per scored station with a linked
-- competency, into each candidate's active cycle. Writes go through /api/osce/*
-- (service role); RLS gives involved users read access.
create table if not exists osce_exams (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete set null,
  title       text not null,
  programme   text,
  exam_date   date,
  status      text not null default 'draft'
                check (status in ('draft','published','running','completed','cancelled')),
  notes       text,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists osce_stations (
  id               uuid primary key default gen_random_uuid(),
  exam_id          uuid not null references osce_exams(id) on delete cascade,
  station_no       int not null default 1,
  name             text not null,
  competency_id    uuid references framework_competencies(id) on delete set null,
  assessor_id      uuid references profiles(id) on delete set null,
  duration_minutes int not null default 10,
  brief            text,
  equipment        text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_osce_stations_exam on osce_stations(exam_id, station_no);

create table if not exists osce_candidates (
  id             uuid primary key default gen_random_uuid(),
  exam_id        uuid not null references osce_exams(id) on delete cascade,
  nurse_id       uuid not null references profiles(id) on delete cascade,
  status         text not null default 'registered'
                   check (status in ('registered','checked_in','completed','absent')),
  accommodations text,
  created_at     timestamptz not null default now(),
  unique (exam_id, nurse_id)
);
create index if not exists idx_osce_candidates_nurse on osce_candidates(nurse_id);

create table if not exists osce_results (
  id          uuid primary key default gen_random_uuid(),
  exam_id     uuid not null references osce_exams(id) on delete cascade,
  station_id  uuid not null references osce_stations(id) on delete cascade,
  nurse_id    uuid not null references profiles(id) on delete cascade,
  assessor_id uuid references profiles(id) on delete set null,
  score       int not null check (score between 0 and 6),
  notes       text,
  recorded_at timestamptz not null default now(),
  unique (station_id, nurse_id)
);
create index if not exists idx_osce_results_exam on osce_results(exam_id);

alter table osce_exams      enable row level security;
alter table osce_stations   enable row level security;
alter table osce_candidates enable row level security;
alter table osce_results    enable row level security;

do $$ begin
  create policy osce_exams_select_involved on osce_exams
    for select using (
      created_by = auth.uid()
      or exists (select 1 from osce_candidates c where c.exam_id = id and c.nurse_id = auth.uid())
      or exists (select 1 from osce_stations s where s.exam_id = id and s.assessor_id = auth.uid())
    );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy osce_stations_select_involved on osce_stations
    for select using (
      assessor_id = auth.uid()
      or exists (select 1 from osce_exams e where e.id = exam_id and e.created_by = auth.uid())
      or exists (select 1 from osce_candidates c where c.exam_id = osce_stations.exam_id and c.nurse_id = auth.uid())
    );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy osce_candidates_select_involved on osce_candidates
    for select using (
      nurse_id = auth.uid()
      or exists (select 1 from osce_exams e where e.id = exam_id and e.created_by = auth.uid())
    );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy osce_results_select_involved on osce_results
    for select using (
      nurse_id = auth.uid() or assessor_id = auth.uid()
      or exists (select 1 from osce_exams e where e.id = exam_id and e.created_by = auth.uid())
    );
exception when duplicate_object then null; end $$;
-- No client insert/update policies: writes go through /api/osce/* (service role).
