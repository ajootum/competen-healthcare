-- Migration 188a: the objects no repository file creates -- eleven tables and two columns
--
-- ============================ WHY THIS EXISTS ============================
--
-- The clean build reached 189-drop-blanket-reads.sql and died on relation "skills" does not exist.
-- Rather than add one table, production was diffed against every create-table in the repository:
--
--   production public tables                663
--   tables created somewhere in the repo    666
--   IN PRODUCTION, CREATED NOWHERE          11   <- this file
--
-- A second failure in the same class was found by dry run: 280-mullen-corrective-migration.sql writes
-- audit_log.notes, and no migration adds that column. Checking the whole table rather than the one
-- symptom found TWO absent columns -- notes and organisation_id. tenant_id and trace_id looked absent
-- to a first, careless instrument and are not: 040 adds tenant_id and 178 adds trace_id.
--
-- These are early-era tables that predate the numbered chain and were never captured by it. They are a
-- third class, distinct from the two the baseline already covers: the nine foundational tables, and the
-- one function plus seven policies that live only in loose supabase/*.sql files. These eleven are in
-- NO repository file at all.
--
-- ============================ WHY 188a AND NOT 001 ============================
--
-- Six of the eleven carry foreign keys to frameworks, departments and competency_cycles, which are
-- created by migrations 003, 006 and 009. At 001 those targets do not exist, so the constraints could
-- not be declared and would have to be bolted on later.
--
-- 188a places them at the LAST point before first use -- 189 and 190 are the first migrations to
-- reference them. That keeps the 006-to-188 sequence exactly as already proven, rather than
-- reintroducing eleven tables into 183 migrations that have been demonstrated to run without them.
--
-- The letter suffix sorts correctly for both the runner and a human: 188- < 188a- < 189-.
--
-- ============================ WHAT IS AND IS NOT REPRODUCED ============================
--
-- Columns, types, nullability, defaults, primary keys and foreign key TARGETS are taken from the live
-- production PostgREST schema, not from memory.
--
-- !! ON DELETE / ON UPDATE ACTIONS ARE NOT REPRODUCED, because the OpenAPI schema does not expose them
-- and this estate has no foreign key registry to read them from. They default to NO ACTION here. This
-- is a KNOWN, DELIBERATE fidelity gap, recorded rather than guessed -- closing it needs a catalogue
-- read that the current registry instrumentation does not provide.
--
-- NO POLICIES ARE CREATED HERE. Five of the eleven carry one policy each in production, and all five
-- are already declared by numbered migrations: skills by 189, and certifications, enrolments,
-- lesson_progress and subscriptions by 190. The other six carry RLS on and NO policy, which is the
-- service-role-only posture this estate uses -- reproduced exactly by enabling RLS and stopping.
--
-- ============================ RETIREMENT IS A SEPARATE DECISION ============================
--
-- All eleven hold ZERO rows. Seven have no application reference at all -- certifications,
-- department_frameworks, enrolments, lesson_progress, lessons, skills, subscriptions. On usage alone
-- they are dead.
--
-- !! THEY ARE CREATED ANYWAY. Retiring tables is not what a reproducibility fix is for, and the same
-- ruling was already made for competencies in COMP-ENG-002F section 9.4. Four ARE referenced by
-- application code and are not candidates at all: content_approvals in 9 files, framework_versions in
-- 4, framework_rules in 2, cycle_assessors in 1.

create table if not exists skills (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  category           text,
  validity_months    integer default 12,
  required_for_roles text[],
  created_at         timestamptz default now()
);

create table if not exists lessons (
  id               uuid primary key default gen_random_uuid(),
  course_id        uuid,
  title            text not null,
  video_url        text,
  pdf_url          text,
  duration_minutes integer default 0,
  sort_order       integer default 0,
  created_at       timestamptz default now()
);

create table if not exists lesson_progress (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid,
  lesson_id    uuid references lessons(id),
  completed    boolean default false,
  completed_at timestamptz
);

create table if not exists enrolments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid,
  course_id       uuid,
  progress_pct    numeric default 0,
  completed       boolean default false,
  completed_at    timestamptz,
  certificate_url text,
  enrolled_at     timestamptz default now()
);

create table if not exists certifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid,
  title           text not null,
  issued_by       text,
  issued_at       timestamptz default now(),
  expires_at      timestamptz,
  certificate_url text,
  course_id       uuid,
  created_at      timestamptz default now()
);

create table if not exists subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid,
  hospital_id            uuid,
  stripe_subscription_id text,
  plan                   text not null,
  status                 text default 'active',
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  created_at             timestamptz default now()
);

create table if not exists content_approvals (
  id                uuid primary key default gen_random_uuid(),
  framework_id      uuid not null references frameworks(id),
  framework_name    text,
  submitted_by      uuid,
  submitted_by_name text,
  submitted_at      timestamptz not null default now(),
  reviewed_by       uuid,
  reviewed_by_name  text,
  reviewed_at       timestamptz,
  status            text not null default 'pending',
  comment           text
);

create table if not exists cycle_assessors (
  id          uuid primary key default gen_random_uuid(),
  cycle_id    uuid not null references competency_cycles(id),
  assessor_id uuid not null,
  assigned_by uuid,
  assigned_at timestamptz default now()
);

create table if not exists department_frameworks (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id),
  framework_id  uuid not null references frameworks(id),
  created_at    timestamptz default now()
);

create table if not exists framework_rules (
  id                uuid primary key default gen_random_uuid(),
  framework_id      uuid not null references frameworks(id),
  hospital_id       uuid references hospitals(id),
  min_passing_score integer not null default 4,
  min_passing_pct   integer not null default 80,
  created_at        timestamptz default now()
);

create table if not exists framework_versions (
  id                uuid primary key default gen_random_uuid(),
  framework_id      uuid not null references frameworks(id),
  version_num       integer not null,
  snapshot          jsonb not null,
  published_by_name text,
  published_at      timestamptz not null default now(),
  notes             text
);

alter table skills                enable row level security;
alter table lessons               enable row level security;
alter table lesson_progress       enable row level security;
alter table enrolments            enable row level security;
alter table certifications        enable row level security;
alter table subscriptions         enable row level security;
alter table content_approvals     enable row level security;
alter table cycle_assessors       enable row level security;
alter table department_frameworks enable row level security;
alter table framework_rules       enable row level security;
alter table framework_versions    enable row level security;

-- ---- audit_log, the same class at column level -------------------------------------------------
-- 040 creates audit_log and adds ten columns, 178 adds trace_id. Production carries two more that no
-- migration ever adds. 280 writes notes, so a clean build fails there without this.

alter table audit_log add column if not exists notes           text;
alter table audit_log add column if not exists organisation_id uuid;

notify pgrst, 'reload schema';
