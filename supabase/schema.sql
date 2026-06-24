-- ============================================================
-- COMPETEN HEALTHCARE — DATABASE SCHEMA
-- Safe to re-run: uses IF NOT EXISTS throughout
-- Paste into Supabase SQL Editor and click Run
-- ============================================================

-- ── PROFILES (extends auth.users) ──────────────────────────
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null default 'New User',
  email         text,
  role          text not null default 'nurse' check (role in ('nurse', 'hospital_admin', 'super_admin')),
  country       text default 'Kenya',
  phone         text,
  specialization text,
  avatar_url    text,
  hospital_id   uuid,
  created_at    timestamptz default now()
);

-- ── HOSPITALS ───────────────────────────────────────────────
create table if not exists hospitals (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  country       text not null,
  city          text,
  tier          text default 'free' check (tier in ('free', 'professional', 'enterprise')),
  admin_id      uuid references profiles(id),
  created_at    timestamptz default now()
);

alter table profiles add column if not exists hospital_id uuid references hospitals(id);

-- ── COURSES (CPD Academy) ───────────────────────────────────
create table if not exists courses (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  category      text not null,
  level         text default 'beginner' check (level in ('beginner', 'intermediate', 'advanced')),
  duration_hours numeric(4,1) default 1,
  cpd_points    int default 1,
  thumbnail_url text,
  is_published  boolean default false,
  created_at    timestamptz default now()
);

create table if not exists course_enrollments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  course_id       uuid not null references courses(id) on delete cascade,
  progress        int default 0 check (progress between 0 and 100),
  completed_at    timestamptz,
  certificate_url text,
  enrolled_at     timestamptz default now(),
  unique (user_id, course_id)
);

-- ── COMPETENCIES ────────────────────────────────────────────
create table if not exists competencies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  category      text not null,
  expiry_months int default 12
);

create table if not exists nurse_competencies (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  competency_id   uuid not null references competencies(id) on delete cascade,
  status          text default 'pending' check (status in ('pending', 'in_progress', 'competent', 'expired', 'required')),
  achieved_date   date,
  expiry_date     date,
  evidence_url    text,
  assessed_by     uuid references profiles(id),
  created_at      timestamptz default now(),
  unique (user_id, competency_id)
);

-- ── QUESTION BANK ───────────────────────────────────────────
create table if not exists questions (
  id              uuid primary key default gen_random_uuid(),
  content         text not null,
  type            text default 'mcq' check (type in ('mcq', 'case_study', 'osce', 'true_false')),
  options         jsonb,
  correct_answer  text not null,
  explanation     text,
  category        text not null,
  difficulty      text default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  policy_source   text,
  is_published    boolean default true,
  created_at      timestamptz default now()
);

create table if not exists quiz_attempts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  question_id     uuid not null references questions(id) on delete cascade,
  selected_answer text,
  is_correct      boolean,
  attempted_at    timestamptz default now()
);

-- ── CPD LOGS ────────────────────────────────────────────────
create table if not exists cpd_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  activity_type   text not null check (activity_type in ('course', 'workshop', 'conference', 'self_study', 'simulation', 'osce')),
  title           text not null,
  hours           numeric(4,1) not null,
  cpd_points      int default 1,
  activity_date   date default current_date,
  verified        boolean default false,
  certificate_url text,
  created_at      timestamptz default now()
);

-- ── SEED: DEFAULT COMPETENCIES ──────────────────────────────
insert into competencies (name, category, expiry_months)
select * from (values
  ('BLS Certification',               'Emergency',     12),
  ('ALS Certification',               'Emergency',     12),
  ('Pediatric Nurse Assessment',      'Pediatrics',    24),
  ('Infection Control',               'Safety',        12),
  ('Medication Safety',               'Pharmacology',  12),
  ('Handwashing & Aseptic Technique', 'Safety',         6),
  ('ICP Monitoring',                  'Critical Care', 12),
  ('IV Cannulation',                  'Clinical',      24),
  ('Patient Assessment',              'Clinical',      12),
  ('Wound Management',                'Clinical',      10)
) as v(name, category, expiry_months)
where not exists (select 1 from competencies limit 1);

-- ── SEED: SAMPLE COURSES ────────────────────────────────────
insert into courses (title, category, level, duration_hours, cpd_points, is_published)
select * from (values
  ('Basic Life Support (BLS)',         'Emergency',     'beginner',     3::numeric, 3, true),
  ('Infection Prevention & Control',   'Safety',        'beginner',     2::numeric, 2, true),
  ('Pediatric Emergency Care',         'Pediatrics',    'intermediate', 4::numeric, 4, true),
  ('Safe Medication Administration',   'Pharmacology',  'beginner',     2::numeric, 2, true),
  ('Critical Care Fundamentals',       'Critical Care', 'advanced',     6::numeric, 6, true),
  ('Airway Management',                'Emergency',     'intermediate', 3::numeric, 3, true),
  ('Wound Care & Dressing Techniques', 'Clinical',      'beginner',     2::numeric, 2, true),
  ('Patient Assessment Framework',     'Clinical',      'beginner',     2::numeric, 2, true)
) as v(title, category, level, duration_hours, cpd_points, is_published)
where not exists (select 1 from courses limit 1);

-- ── ROW LEVEL SECURITY ──────────────────────────────────────
alter table profiles          enable row level security;
alter table hospitals         enable row level security;
alter table courses           enable row level security;
alter table course_enrollments enable row level security;
alter table competencies      enable row level security;
alter table nurse_competencies enable row level security;
alter table questions         enable row level security;
alter table quiz_attempts     enable row level security;
alter table cpd_logs          enable row level security;

-- Profiles
do $$ begin
  create policy "Users see own profile"    on profiles for select using (auth.uid() = id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Users update own profile" on profiles for update using (auth.uid() = id);
exception when duplicate_object then null; end $$;

-- Enrollments
do $$ begin
  create policy "Users see own enrollments"    on course_enrollments for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Users insert own enrollments" on course_enrollments for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Users update own enrollments" on course_enrollments for update using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Nurse competencies
do $$ begin
  create policy "Users see own competencies" on nurse_competencies for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- CPD logs
do $$ begin
  create policy "Users manage own CPD" on cpd_logs for all using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Quiz attempts
do $$ begin
  create policy "Users manage own attempts" on quiz_attempts for all using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Public read: courses, questions, competencies
do $$ begin
  create policy "Anyone can view published courses"   on courses      for select using (is_published = true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Anyone can view published questions" on questions    for select using (is_published = true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Anyone can view competencies"        on competencies for select using (true);
exception when duplicate_object then null; end $$;

-- ── AUTO-CREATE PROFILE ON SIGNUP ───────────────────────────
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'New User'),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
