-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one plpgsql trigger function between dollar quotes.
-- ====================================================================================================
-- MIGRATION 840: COMPETEN INDIVIDUAL -- THE PERSONAL LEARNING PLAN (PLP-01..04)
--
-- Owner GO 2 Nov 2026, "Personal Learning and Development Planning Engine -- Scholar first, Professional ready".
-- Design of record: RELEASE-2026-10-25/PLANS/PLP-01-04-DESIGN.md. Shortest safe path over what already exists: the study
-- plan settings (780), the calendar entries (830), mastery, monthly review and the Learn, Revise, Apply, Evaluate records.
-- This migration adds the three things those cannot hold. Owner GO 2 Nov 2026, "My Plan Calendar Enhancement", adds the third.
--
--   1. individual_scholar_study_plan gets two nullable columns. goal_type (learn, exam or revise) is the learner answer to
--      "what are you aiming for", and session_minutes (10 to 240) is the answer to "how long is one session".
--      weekly_minutes stays the stored total (session_minutes times days_per_week) so every existing reader still works.
--   2. individual_learning_plan_event is ONE append-only log, shared by the Individual experiences (scholar and professional).
--      It holds the learner planning decisions and what the plan changed, so a declined suggestion is not offered again
--      until the evidence changes, an automatic change can be undone, and a revision history exists.
--        proposal                 a plan proposal for an uploaded material (ref is the material id): accepted, declined or deferred
--        topic_postponed          a topic put off until a date (ref is the topic, value holds the date)
--        recommendation_declined  a suggested activity the learner declined (ref is the activity, value holds the evidence fingerprint)
--        reflection               the weekly reflection (ref is the ISO week, value holds the answer and an optional private note)
--        settings_change          the plan settings before and after a change
--        auto_adjust              the plan moved an unfinished activity on its own (applied) or the learner took that back (undone)
--
--   3. individual_learning_calendar_entry and individual_learning_calendar_exception hold the learner OWN calendar entries
--      (a personal study session, an exam, a deadline, a placement, a busy time or anything else), one row per series, with
--      an exception row only for an occurrence that was cancelled, moved, edited or completed. No row per occurrence.
--      The plan never changes these. It only reads them, to leave a busy day alone and to count personal study time.
--
-- NOT COMPETENCE. A plan event is a scheduling and preference record. It is not evidence, an assessment or a Passport
-- record, and nothing here is produced by AI.
--
-- PRIVATE AND ERASABLE. RLS on, own-row SELECT only. No table grants. The server writes through the service role in the
-- store, keyed on the caller. Rows go with the learner (cascade from profiles).
--
-- APPEND-ONLY. A trigger refuses every UPDATE, and refuses DELETE except when it comes through a cascade
-- (pg_trigger_depth() greater than 1), so deleting the learner still works and nothing else removes an event.
--
-- APPLY ON STAGING FIRST. ADDITIVE. Depends on profiles, 780 (the study plan table) and nothing else. Re-running the file
-- is a no-op. Rollback: ROLLBACK-840.sql (refuses while any event exists).
--
-- FAIL CLOSED WITHOUT IT. The code detects the table and the columns. Without them My Plan still works from 780 and 830:
-- decisions, reflections, proposal memory, goal type, session minutes and automatic-change notices are hidden.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. notify pgrst last.
-- ====================================================================================================

-- ---- 1. TWO ANSWERS ON THE STUDY PLAN SETTINGS ---------------------------------------------------------------

alter table individual_scholar_study_plan add column if not exists goal_type text;
alter table individual_scholar_study_plan add column if not exists session_minutes integer;

alter table individual_scholar_study_plan drop constraint if exists individual_scholar_study_plan_goal_type_check;
alter table individual_scholar_study_plan add constraint individual_scholar_study_plan_goal_type_check
  check (goal_type is null or goal_type in ('learn', 'exam', 'revise'));

alter table individual_scholar_study_plan drop constraint if exists individual_scholar_study_plan_session_minutes_check;
alter table individual_scholar_study_plan add constraint individual_scholar_study_plan_session_minutes_check
  check (session_minutes is null or session_minutes between 10 and 240);

-- ---- 2. THE PLAN EVENT LOG, SHARED BY THE INDIVIDUAL EXPERIENCES ----------------------------------------------

create table if not exists individual_learning_plan_event (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  experience  text not null,
  kind        text not null,
  ref         text not null,
  status      text,
  value       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

alter table individual_learning_plan_event drop constraint if exists individual_learning_plan_event_check;
alter table individual_learning_plan_event add constraint individual_learning_plan_event_check
  check (experience in ('scholar', 'professional')
     and kind in ('proposal', 'topic_postponed', 'recommendation_declined', 'reflection', 'settings_change', 'auto_adjust')
     and char_length(ref) between 1 and 200
     and (status is null or status in ('accepted', 'declined', 'deferred', 'applied', 'undone'))
     and jsonb_typeof(value) = 'object'
     and octet_length(value::text) <= 8000);

create index if not exists idx_individual_learning_plan_event_user
  on individual_learning_plan_event(user_id, experience, kind, created_at desc);

-- ---- 3. THE GUARD: written once, never changed, removed only with the learner ---------------------------------

create or replace function public.individual_learning_plan_event_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'learning_plan_event: an event is never deleted, only removed with its learner';
  end if;
  raise exception 'learning_plan_event: an event is never changed. Record another event instead';
end;
$$;

drop trigger if exists individual_learning_plan_event_guard on individual_learning_plan_event;
create trigger individual_learning_plan_event_guard
  before update or delete on individual_learning_plan_event
  for each row execute function public.individual_learning_plan_event_guard();

revoke execute on function public.individual_learning_plan_event_guard() from public, anon, authenticated;

-- ---- 4. RLS: own rows, read only. The server writes through the service role -------------------------------

alter table individual_learning_plan_event enable row level security;

drop policy if exists individual_learning_plan_event_read_own on individual_learning_plan_event;
create policy individual_learning_plan_event_read_own on individual_learning_plan_event
  for select using (auth.uid() = user_id);

-- ---- 5. THE LEARNER OWN CALENDAR: ENTRIES (ONE ROW PER SERIES) AND EXCEPTIONS (ONE PER CHANGED OCCURRENCE) ------

create table if not exists individual_learning_calendar_entry (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles(id) on delete cascade,
  experience       text not null,
  entry_type       text not null,
  title            text not null,
  description      text,
  entry_date       date not null,
  start_time       time,
  end_time         time,
  duration_minutes integer,
  link             jsonb,
  recurrence       jsonb,
  status           text not null default 'planned',
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table individual_learning_calendar_entry drop constraint if exists individual_learning_calendar_entry_check;
alter table individual_learning_calendar_entry add constraint individual_learning_calendar_entry_check
  check (experience in ('scholar', 'professional')
     and entry_type in ('study_session', 'exam', 'deadline', 'placement', 'busy', 'other')
     and char_length(btrim(title)) between 1 and 200
     and (description is null or char_length(description) <= 2000)
     and (start_time is null or end_time is null or end_time > start_time)
     and (duration_minutes is null or duration_minutes between 5 and 1440)
     and (link is null or (jsonb_typeof(link) = 'object' and octet_length(link::text) <= 1000))
     and (recurrence is null or (jsonb_typeof(recurrence) = 'object' and octet_length(recurrence::text) <= 1000
          and recurrence->>'freq' in ('daily', 'weekly')
          and (recurrence->>'until' is not null or recurrence->>'count' is not null)))
     and status in ('planned', 'completed', 'cancelled'));

create index if not exists idx_individual_learning_calendar_entry_user
  on individual_learning_calendar_entry(user_id, experience, entry_date);

create unique index if not exists ux_individual_learning_calendar_entry_owner
  on individual_learning_calendar_entry(id, user_id);

create table if not exists individual_learning_calendar_exception (
  id               uuid primary key default gen_random_uuid(),
  entry_id         uuid not null,
  user_id          uuid not null,
  occurrence_date  date not null,
  action           text not null,
  new_date         date,
  new_start_time   time,
  new_end_time     time,
  title            text,
  completed_at     timestamptz,
  created_at       timestamptz not null default now()
);

alter table individual_learning_calendar_exception drop constraint if exists individual_learning_calendar_exception_owner_fk;
alter table individual_learning_calendar_exception add constraint individual_learning_calendar_exception_owner_fk
  foreign key (entry_id, user_id) references individual_learning_calendar_entry(id, user_id) on delete cascade;

alter table individual_learning_calendar_exception drop constraint if exists individual_learning_calendar_exception_check;
alter table individual_learning_calendar_exception add constraint individual_learning_calendar_exception_check
  check (action in ('cancelled', 'moved', 'edited', 'completed')
     and (action <> 'moved' or new_date is not null)
     and (new_start_time is null or new_end_time is null or new_end_time > new_start_time)
     and (title is null or char_length(btrim(title)) between 1 and 200));

create unique index if not exists ux_individual_learning_calendar_exception
  on individual_learning_calendar_exception(entry_id, occurrence_date);

-- ---- 6. RLS: own rows, read only. The server writes through the service role -------------------------------

alter table individual_learning_calendar_entry enable row level security;
alter table individual_learning_calendar_exception enable row level security;

drop policy if exists individual_learning_calendar_entry_read_own on individual_learning_calendar_entry;
create policy individual_learning_calendar_entry_read_own on individual_learning_calendar_entry
  for select using (auth.uid() = user_id);

drop policy if exists individual_learning_calendar_exception_read_own on individual_learning_calendar_exception;
create policy individual_learning_calendar_exception_read_own on individual_learning_calendar_exception
  for select using (auth.uid() = user_id);

comment on table individual_learning_calendar_entry is
  'PLP My Plan calendar (840). A learner''s own calendar entry: a personal study session, exam, deadline, placement, busy time or other. One row per series, with an optional recurrence. Never created or changed by the plan. A personal study session is planned time, never evidence of study. Private, formative, never assessment evidence.';

comment on table individual_learning_calendar_exception is
  'PLP My Plan calendar (840). One occurrence of a recurring entry that was cancelled, moved, edited or completed, so the rest of the series is untouched. Private.';

comment on table individual_learning_plan_event is
  'PLP-01..04 (840). A learner''s planning decisions and what the plan changed, append-only: plan proposals, postponed topics, declined suggestions, weekly reflections, settings changes and automatic adjustments with their undo. Shared by the Individual experiences. Private, formative, never assessment evidence.';

comment on column individual_scholar_study_plan.goal_type is
  'PLP-01..04 (840). The learner''s aim: learn, exam or revise. Null for a plan saved before 840.';
comment on column individual_scholar_study_plan.session_minutes is
  'PLP-01..04 (840). Minutes in one study session, 10 to 240. weekly_minutes stays the stored total (session minutes times days per week).';

notify pgrst, 'reload schema';
