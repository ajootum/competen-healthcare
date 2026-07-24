-- 089: LDS-001 Learning Management Service — operational core (Assignment / Enrolment / Progress).
-- The learning CATALOGUE already partly exists (learning_resources / curricula / learning_pathways);
-- LDS-001's genuine gap over the platform is the operational tracking layer that the UMG-005 oversight
-- (Active Assignments, Mandatory-Overdue by due date, Completion) needs. This adds that layer:
--
--   • learning_courses      — the course catalogue (LDS-001 COURSE + COURSE_VERSION, simplified: one row
--     carries version_no + status; only one active version per code). Optionally links a course to the
--     competency it develops (competency_id) so gaps map to courses.
--   • learning_assignments  — rule-based assignments (LDS-001 ASSIGNMENT): target audience (jsonb rules),
--     mandatory flag, start/due dates, priority. Renewals create a NEW assignment (business rule).
--   • learning_enrolments   — per-user enrolment + progress (LDS-001 ENROLMENT): status, progress %, score,
--     mandatory flag, due date, completion. One enrolment per user / course / assignment.
--
-- Key rules baked in: mandatory + due_date drive compliance; completion is a terminal state; server
-- timestamps. Content-object-level progress is simplified to progress_pct here (a further phase).
-- Idempotent; RLS enabled, service-role only — reads/writes via audited APIs, matching migrations 084-088.

-- ── learning_courses — catalogue (COURSE + COURSE_VERSION, simplified) ───────────────────────────
create table if not exists learning_courses (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid references hospitals(id) on delete cascade,   -- null = shared/master course
  code           text,
  title          text not null,
  course_type    text,                                              -- elearning / classroom / simulation / module
  mandatory      boolean not null default false,
  validity_months integer,                                          -- renewal interval (null = no expiry)
  competency_id  uuid references framework_competencies(id) on delete set null,
  version_no     integer not null default 1,
  status         text not null default 'active' check (status in ('draft','active','retired')),
  active         boolean not null default true,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_learning_courses_hosp on learning_courses(hospital_id, active);
create index if not exists idx_learning_courses_comp on learning_courses(competency_id);

-- ── learning_assignments — rule-based assignments (ASSIGNMENT) ───────────────────────────────────
create table if not exists learning_assignments (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references hospitals(id) on delete cascade,
  course_id       uuid references learning_courses(id) on delete set null,
  path_id         uuid references learning_pathways(id) on delete set null,
  name            text,
  assignment_type text not null default 'mandatory' check (assignment_type in ('mandatory','recommended','development','remediation')),
  audience        jsonb not null default '{}'::jsonb,               -- {org,role,position,skills,attributes} rules
  mandatory       boolean not null default false,
  start_date      date,
  due_date        date,
  priority        text check (priority is null or priority in ('low','normal','high','urgent')),
  active          boolean not null default true,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_learning_assign_hosp on learning_assignments(hospital_id, active);

-- ── learning_enrolments — per-user enrolment + progress (ENROLMENT) ──────────────────────────────
create table if not exists learning_enrolments (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references hospitals(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  course_id     uuid references learning_courses(id) on delete set null,
  assignment_id uuid references learning_assignments(id) on delete set null,
  status        text not null default 'not_started' check (status in ('not_started','in_progress','completed','overdue','exempt','failed')),
  progress_pct  integer not null default 0 check (progress_pct >= 0 and progress_pct <= 100),
  score         integer,
  mandatory     boolean not null default false,
  due_date      date,
  enrolled_on   timestamptz not null default now(),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, course_id, assignment_id)
);
create index if not exists idx_learning_enrol_hosp on learning_enrolments(hospital_id, status);
create index if not exists idx_learning_enrol_user on learning_enrolments(user_id);
create index if not exists idx_learning_enrol_due on learning_enrolments(hospital_id, due_date) where due_date is not null;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='learning_courses') then
    execute 'alter table public.learning_courses enable row level security';
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='learning_assignments') then
    execute 'alter table public.learning_assignments enable row level security';
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='learning_enrolments') then
    execute 'alter table public.learning_enrolments enable row level security';
  end if;
end $$;
