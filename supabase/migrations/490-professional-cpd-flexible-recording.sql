-- ====================================================================================================
-- MIGRATION 490: COMPETEN PROFESSIONAL STAGE 4 -- FLEXIBLE CPD RECORDING, CORRECTION HISTORY, CPD SETTING
--
-- !! APPLY THIS FILE WHOLE. It contains two plpgsql trigger functions. A runner that splits on
-- !! semicolons would cut a function body in half. Paste the entire file into the SQL editor and run it.
--
-- COMPETEN-PROFESSIONAL-LCPD-01, owner GO (Stage 4 Learning and CPD), LCPD-2 and LCPD-5. Development and
-- staging authorised. Production needs a separate owner GO. Build record:
-- docs/evidence/COMPETEN-PROFESSIONAL-LCPD-01/490-build-record.md.
--
-- DEPENDS ON 373 (individual_professional_cpd). Independent of every other file. Re-running it is a no-op.
-- It changes no existing row value.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT CHANGES, AND WHY.
--
--   1. Activity types are CONFIGURATION. The 373 CHECK listed nine types in the schema. The owner asks for
--      workplace learning, mentorship, quality improvement, reflective practice and other configurable
--      types. The CHECK now requires a code shape only, and the application accepts only the types the
--      Individual policy configures. Every existing value still passes.
--   2. Only a description and a date are required. Hours become optional (still above 0 and at most 1000
--      when given). CPD points become CPD credits with one decimal (0.5 credits). Every existing value fits.
--   3. Corrections keep history. individual_professional_cpd_history holds the entry as it was before each
--      material correction, written by trigger, so no writer can skip it. Append-only, own-row read. A
--      history row goes only with its entry (the cascade, through the pg_trigger_depth() > 1 allowance).
--      The recording date stays created_at, and the activity date stays activity_date: they are separate.
--   4. A stable reference already exists: ux_individual_professional_cpd_id_user (id, user_id), from 393. A
--      Stage 3 development activity points at the CPD entry that happened through it. Nothing to add here.
--   5. The CPD requirement a person follows. individual_professional_cpd_setting: one row per person, the
--      code of a configured requirement (Individual policy, CONFIG-002) and the start of their cycle. No
--      requirement is seeded and none is assumed. Own-row read.
--
-- Nothing here is shared or scoped: no hospital, organisation or tenant column, owner ruling D1.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/COMPETEN-PROFESSIONAL-LCPD-01/ROLLBACK-490.sql
-- VERIFY:             docs/evidence/COMPETEN-PROFESSIONAL-LCPD-01/VERIFY-490.sql
-- ====================================================================================================

-- ---- 1 and 2. configurable types, optional hours, credits ------------------------------------------------

alter table individual_professional_cpd drop constraint if exists individual_professional_cpd_type_check;
alter table individual_professional_cpd add constraint individual_professional_cpd_type_check
  check (activity_type ~ '^[a-z][a-z0-9_]{1,40}$');

alter table individual_professional_cpd alter column hours drop not null;
alter table individual_professional_cpd alter column cpd_points type numeric(6,1);

alter table individual_professional_cpd drop constraint if exists individual_professional_cpd_hours_check;
alter table individual_professional_cpd add constraint individual_professional_cpd_hours_check
  check ((hours is null or (hours > 0 and hours <= 1000)) and (cpd_points is null or cpd_points between 0 and 1000));

-- ---- 3. correction history -------------------------------------------------------------------------------

create table if not exists individual_professional_cpd_history (
  id uuid primary key default gen_random_uuid(),
  cpd_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  activity_type text not null,
  title text not null,
  provider text,
  hours numeric(5,1),
  cpd_points numeric(6,1),
  activity_date date not null,
  reflection text,
  goal_id uuid,
  document_name text,
  evidence_class text,
  was_updated_at timestamptz not null,
  corrected_at timestamptz not null default now()
);

alter table individual_professional_cpd_history drop constraint if exists individual_professional_cpd_history_cpd_fk;
alter table individual_professional_cpd_history add constraint individual_professional_cpd_history_cpd_fk
  foreign key (cpd_id, user_id) references individual_professional_cpd(id, user_id) on delete cascade;

create index if not exists idx_individual_professional_cpd_history_cpd
  on individual_professional_cpd_history(cpd_id, corrected_at desc);

create or replace function public.individual_professional_cpd_keep_history()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if (old.activity_type, old.title, old.provider, old.hours, old.cpd_points, old.activity_date, old.reflection, old.goal_id, old.document_name)
     is distinct from
     (new.activity_type, new.title, new.provider, new.hours, new.cpd_points, new.activity_date, new.reflection, new.goal_id, new.document_name) then
    insert into individual_professional_cpd_history
      (cpd_id, user_id, activity_type, title, provider, hours, cpd_points, activity_date, reflection, goal_id, document_name, evidence_class, was_updated_at)
    values
      (old.id, old.user_id, old.activity_type, old.title, old.provider, old.hours, old.cpd_points, old.activity_date, old.reflection, old.goal_id, old.document_name, old.evidence_class, old.updated_at);
  end if;
  return new;
end
$$;

drop trigger if exists trg_individual_professional_cpd_keep_history on individual_professional_cpd;
create trigger trg_individual_professional_cpd_keep_history
  after update on individual_professional_cpd
  for each row execute function public.individual_professional_cpd_keep_history();

create or replace function public.individual_professional_cpd_history_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'individual_professional_cpd_history is append-only: history goes only with its entry';
end
$$;

drop trigger if exists trg_individual_professional_cpd_history_guard on individual_professional_cpd_history;
create trigger trg_individual_professional_cpd_history_guard
  before update or delete on individual_professional_cpd_history
  for each row execute function public.individual_professional_cpd_history_guard();

alter table individual_professional_cpd_history enable row level security;
drop policy if exists individual_professional_cpd_history_read_own on individual_professional_cpd_history;
create policy individual_professional_cpd_history_read_own on individual_professional_cpd_history
  for select using (auth.uid() = user_id);

comment on table individual_professional_cpd_history is
  'COMPETEN-PROFESSIONAL-LCPD-01 LCPD-2. A CPD entry as it was before each material correction, by trigger. Append-only. Own-row read. Goes only with its entry.';

-- ---- 5. the CPD requirement a person follows -------------------------------------------------------------

create table if not exists individual_professional_cpd_setting (
  user_id uuid primary key references profiles(id) on delete cascade,
  requirement_code text,
  cycle_start date,
  updated_at timestamptz not null default now()
);

alter table individual_professional_cpd_setting drop constraint if exists individual_professional_cpd_setting_shape;
alter table individual_professional_cpd_setting add constraint individual_professional_cpd_setting_shape
  check ((requirement_code is null or requirement_code ~ '^[a-z][a-z0-9_]{1,60}$')
     and (requirement_code is not null or cycle_start is null));

alter table individual_professional_cpd_setting enable row level security;
drop policy if exists individual_professional_cpd_setting_read_own on individual_professional_cpd_setting;
create policy individual_professional_cpd_setting_read_own on individual_professional_cpd_setting
  for select using (auth.uid() = user_id);

comment on table individual_professional_cpd_setting is
  'COMPETEN-PROFESSIONAL-LCPD-01 LCPD-5. The configured CPD requirement a person chose to follow, and their cycle start. Own-row read, service-role write. No requirement is seeded.';

notify pgrst, 'reload schema';
