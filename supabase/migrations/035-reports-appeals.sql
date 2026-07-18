-- 035: Report Builder definitions, Scheduled Reports, and Appeals
-- (Analytics & Reports "fix the omissions" pass).
-- report_definitions: saved parameterised reports (dataset + columns/filters
-- config; datasets and columns are whitelisted server-side in /api/reports/custom).
-- report_schedules: recurring delivery via the daily platform cron
-- (/api/cron/reports) — recipients get in-app notifications.
-- appeals: learner appeals against assessment outcomes, reviewed by staff.
create table if not exists report_definitions (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid references hospitals(id) on delete set null,
  name            text not null,
  dataset         text not null,
  config          jsonb not null default '{}'::jsonb,
  created_by      uuid references profiles(id) on delete cascade,
  created_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_repdefs_hospital on report_definitions(hospital_id, created_at desc);

create table if not exists report_schedules (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid references hospitals(id) on delete set null,
  definition_id uuid references report_definitions(id) on delete cascade,
  dataset       text,
  name          text not null,
  frequency     text not null check (frequency in ('daily','weekly','monthly')),
  recipients    uuid[] not null default '{}',
  active        boolean not null default true,
  next_run_at   timestamptz not null,
  last_run_at   timestamptz,
  last_status   text,
  created_by    uuid references profiles(id) on delete cascade,
  created_at    timestamptz not null default now()
);
create index if not exists idx_repsched_due on report_schedules(active, next_run_at);

create table if not exists appeals (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid references hospitals(id) on delete set null,
  assessment_id   uuid references assessments(id) on delete set null,
  nurse_id        uuid not null references profiles(id) on delete cascade,
  competency_name text,
  score           int,
  reason          text not null,
  status          text not null default 'open'
                    check (status in ('open','under_review','upheld','overturned','withdrawn')),
  reviewer_id     uuid references profiles(id) on delete set null,
  reviewer_name   text,
  resolution_note text,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index if not exists idx_appeals_hospital on appeals(hospital_id, status, created_at desc);

alter table report_definitions enable row level security;
alter table report_schedules   enable row level security;
alter table appeals            enable row level security;

do $$ begin
  create policy repdefs_select_own on report_definitions
    for select using (created_by = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy repsched_select_own on report_schedules
    for select using (created_by = auth.uid() or auth.uid() = any(recipients));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy appeals_select_involved on appeals
    for select using (nurse_id = auth.uid() or reviewer_id = auth.uid());
exception when duplicate_object then null; end $$;
-- No client insert/update policies: writes go through the APIs (service role).
