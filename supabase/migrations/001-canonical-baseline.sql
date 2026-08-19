-- APPLY THIS FILE WHOLE, AND ONLY TO A FRESH DATABASE. It defines a function body, so a
-- statement-splitting runner would cut it in half.
--
-- !!!! DO NOT PASTE THIS INTO THE PRODUCTION SQL EDITOR. On 2026-08-19 that happened and it reverted
-- !!!! two objects migration 249 had hardened -- see 335-restore-249-after-baseline-overwrite.sql.
-- !!!! Run it only through scripts/apply-migrations.ts, which refuses to target production.
-- !!!! The guard below is the second line of defence and will abort on any built database.
--
-- Migration 001: canonical baseline (COMP-ENG-002F)
--
-- ============================ WHAT THIS IS ============================
--
-- It SUPERSEDES supabase/schema.sql as the clean-build bootstrap source. The numbered chain has always
-- started at 002, and 002-add-roles.sql assumes `profiles` already exists -- so a build from
-- supabase/migrations/ alone died on the first file. That was found empirically by the clean-build test
-- on 2026-08-19, not predicted from reading.
--
-- !! IT IS NOT AUTHORIZATION TO REWRITE PRODUCTION MIGRATION HISTORY. Production already contains every
-- object below and was built incrementally by hand. This file exists so a FRESH database can be
-- constructed from the repository alone. Verified before writing: production has no
-- supabase_migrations.schema_migrations ledger at all, so numbering this 001 cannot diverge from a
-- remote history that does not exist.
--
-- !! IT IS NOT A REPLAY OF schema.sql. Four of that file's eleven policies are deliberately omitted --
-- see the omission table. The baseline's job is to make a clean build arrive at the APPROVED PRESENT
-- STATE, not to re-enact 2026.
--
-- ============================ WHAT IT CREATES ============================
--
-- Nine foundational tables, none of which any numbered migration creates:
--   profiles, hospitals, courses, course_enrollments, competencies,
--   nurse_competencies, questions, quiz_attempts, cpd_logs
-- RLS enabled on all nine. FOURTEEN policies and one RLS helper function -- the six omitted below are
-- excluded.
-- handle_new_user() and the on_auth_user_created trigger.
--
-- Collision review (COMP-ENG-002F section 9.2): NONE. No numbered migration creates any of the nine.
-- 151-service-profiles.sql creates service_profiles and service_required_competencies -- different
-- objects -- and only holds a foreign key to profiles.
--
-- Load: profiles carries foreign keys from 144 migrations and 1030 application references, and
-- hospitals from 116 and 90. Their absence is why the clean build stopped on file one.
--
-- ============================ POLICIES DELIBERATELY OMITTED ============================
--
-- The loose files declare twenty across them. SIX are NOT created here. Each was checked against live
-- production before being omitted, and each is measurably absent there:
--
--   profiles :: "Users see own profile"
--       RETIRED RECURSION LINEAGE. Dropped by supabase/fix-super-admin-rls-recursion.sql because
--       profiles policies that query profiles cause RLS recursion. One of the two remaining MISSING
--       policies in the reconciliation, held as deliberate absence. COMP-ENG-002F section 4, row 1.
--
--   courses :: "Anyone can view published courses"
--       SUPERSEDED. Production carries courses_read_published instead. Creating this would leave a
--       clean build with BOTH.
--
--   questions :: "Anyone can view published questions"
--       ABSENT IN PRODUCTION. questions currently carries no policy at all -- RLS on, nothing granted,
--       which is the service-role-only posture the estate uses. Not resurrected here.
--
--   competencies :: "Anyone can view competencies"
--       SUPERSEDED. Production carries competencies_read instead.
--
--   profiles :: "Users insert own profile"
--       DELIBERATELY CLOSED by migration 250, which shut the profile insert door. Recreating it here
--       would reopen in a clean build the exact hole 250 was written to close.
--
--   profiles :: "Admins view hospital nurses"
--       RETIRED RECURSION LINEAGE, same class as "Users see own profile" above. Declared in both
--       rls-updates.sql and fix-rls-recursion.sql, absent from production, and the second of the two
--       remaining MISSING policies in the reconciliation.
--
-- ============================ LATER MIGRATIONS THAT EXTEND THIS ============================
--
-- profiles is altered by 9 later migrations (roles, hospital/org/tenant columns, account_status).
-- hospitals by 5. questions by 1. handle_new_user() is REPLACED twice: 171 rewrites the body, then
-- 249 rewrites it again WITH `set search_path = public, pg_catalog`, which is the deployed state.
-- create-or-replace preserves the function OID, so the trigger created here is never disturbed --
-- 249's own header says so.
--
-- !! SEED DATA IS NOT INCLUDED. schema.sql inserts ten competencies and eight courses. Those are data,
-- not schema, and COMP-ENG-002E section 9 requires staging fixtures to be synthetic and provisioned
-- deliberately. COMP-ENG-002F section 12 also rules out blindly copying all 223 lines.
--
-- Proof reference: the clean-build test that produced this, and the fidelity manifest that must pass
-- after it, are scripts/apply-migrations.ts and scripts/fidelity-manifest.ts.

-- ---- REFUSE TO RUN ON A DATABASE THAT IS NOT FRESH -------------------------------------------
-- profile_authority_unchanged is created by migration 249 and by nothing else, so its presence proves
-- the chain has already been applied here. Postgres has no RAISE outside plpgsql and this repo bans
-- do-blocks, so the abort is a cast to integer of a message the CASE produces. THE CASE MUST SIT
-- INSIDE THE CAST. Written the other way round, as a cast of a literal inside a CASE branch, the
-- planner constant-folds that cast before execution and the file aborts on EVERY database including a
-- fresh one. That is not hypothetical -- it is what the first version of this guard did, and the
-- break-test caught it. The whole file runs in one transaction, so aborting here leaves nothing behind.

select cast(
  case
    when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'profile_authority_unchanged'
    )
    then 'MIGRATION 001 REFUSES TO RUN - this database is NOT fresh, it already has later migrations applied'
    else '0'
  end as integer);

-- ---- Foundational tables ----------------------------------------------------------------------

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

-- ---- RLS ---------------------------------------------------------------------------------------

alter table profiles           enable row level security;
alter table hospitals          enable row level security;
alter table courses            enable row level security;
alter table course_enrollments enable row level security;
alter table competencies       enable row level security;
alter table nurse_competencies enable row level security;
alter table questions          enable row level security;
alter table quiz_attempts      enable row level security;
alter table cpd_logs           enable row level security;

-- ---- The seven retained policies ---------------------------------------------------------------
-- Idempotent as drop-then-create rather than schema.sql's exception blocks, matching this repo's
-- house style. Each was confirmed live in production before inclusion.

drop policy if exists "Users update own profile" on profiles;
create policy "Users update own profile" on profiles for update to authenticated using (auth.uid() = id);

drop policy if exists "Users see own enrollments" on course_enrollments;
create policy "Users see own enrollments" on course_enrollments for select using (auth.uid() = user_id);

drop policy if exists "Users insert own enrollments" on course_enrollments;
create policy "Users insert own enrollments" on course_enrollments for insert with check (auth.uid() = user_id);

drop policy if exists "Users update own enrollments" on course_enrollments;
create policy "Users update own enrollments" on course_enrollments for update using (auth.uid() = user_id);

drop policy if exists "Users see own competencies" on nurse_competencies;
create policy "Users see own competencies" on nurse_competencies for select using (auth.uid() = user_id);

drop policy if exists "Users manage own CPD" on cpd_logs;
create policy "Users manage own CPD" on cpd_logs for all using (auth.uid() = user_id);

drop policy if exists "Users manage own attempts" on quiz_attempts;
create policy "Users manage own attempts" on quiz_attempts for all using (auth.uid() = user_id);

-- ---- The hidden bootstrap the loose fix scripts left behind -------------------------------------
--
-- FOUND EMPIRICALLY, 2026-08-19. With the nine tables in place the clean build reached
-- 006-org-hierarchy.sql and died on current_user_is_hospital_admin_for. A repository-wide scan then
-- showed the full extent rather than one more symptom: ONE function and THIRTEEN policies are declared
-- only in unnumbered files under supabase/, and by no numbered migration at all.
--
-- SEVEN of the thirteen are live in production and are created below. The other six are measurably
-- absent and stay omitted -- they are the omission table above.
--
-- Written as drop-then-create. The loose originals use do-blocks with an exception handler for
-- duplicate_object, which this repository bans because the owner runner splits on semicolons.
--
-- 252 pins this helper search_path later. It is pinned here too, in the order production carries it,
-- so a clean build never holds an unpinned SECURITY DEFINER function even briefly. The body is
-- production live text, unqualified profiles included -- the pinned search_path is what resolves it.

create or replace function public.current_user_is_hospital_admin_for(target_hospital_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $HELPER$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role = 'hospital_admin'
      and hospital_id = target_hospital_id
  );
$HELPER$;

drop policy if exists "users_read_own_profile" on profiles;
create policy "users_read_own_profile" on profiles for select using (auth.uid() = id);

drop policy if exists "Users insert own competencies" on nurse_competencies;
create policy "Users insert own competencies" on nurse_competencies for insert with check (auth.uid() = user_id);

drop policy if exists "Users update own competencies" on nurse_competencies;
create policy "Users update own competencies" on nurse_competencies for update using (auth.uid() = user_id);

drop policy if exists "Authenticated users view hospitals" on hospitals;
create policy "Authenticated users view hospitals" on hospitals for select using (auth.role() = 'authenticated');

drop policy if exists "Admins view hospital nurse competencies" on nurse_competencies;
create policy "Admins view hospital nurse competencies"
  on nurse_competencies for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from profiles nurse
      where nurse.id = nurse_competencies.user_id
        and current_user_is_hospital_admin_for(nurse.hospital_id)
    )
  );

drop policy if exists "Admins view hospital CPD logs" on cpd_logs;
create policy "Admins view hospital CPD logs"
  on cpd_logs for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from profiles nurse
      where nurse.id = cpd_logs.user_id
        and current_user_is_hospital_admin_for(nurse.hospital_id)
    )
  );

drop policy if exists "Admins view hospital enrollments" on course_enrollments;
create policy "Admins view hospital enrollments"
  on course_enrollments for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from profiles nurse
      where nurse.id = course_enrollments.user_id
        and current_user_is_hospital_admin_for(nurse.hospital_id)
    )
  );

-- ---- Signup trigger ----------------------------------------------------------------------------
-- !! NO NUMBERED MIGRATION CREATES on_auth_user_created -- only schema.sql ever did, which is why it
-- must live here. The function is created in its bootstrap form and REPLACED later by 171 and then by
-- 249, whose version pins search_path and is the deployed state. create-or-replace preserves the OID,
-- so this trigger survives both replacements untouched.

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $BODY$
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
$BODY$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

notify pgrst, 'reload schema';
