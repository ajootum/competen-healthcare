-- ====================================================================================================
-- MIGRATION 780: COMPETEN SCHOLAR -- THE LEARNER STUDY PLAN SETTINGS (SCHOLAR-COMPANION-01, Learning and Progress Intelligence E)
--
-- Owner GO 31 Oct 2026: configurable study plans built from the learner goals, programme, exam date, available study
-- time, priorities and previous performance. The plan itself is computed, on request, by a deterministic function
-- (src/lib/individual/scholar/study-plan.ts) from the learner own evidence. NO AI, and the plan is NOT stored. This
-- migration stores only what the learner TYPES: one small settings row per learner.
-- Build record: docs/evidence/SCHOLAR-COMPANION/780-build-record.md.
--
-- APPLY ON STAGING FIRST. ADDITIVE. One new table, one row per learner at most. No existing table, column, row,
-- function or trigger is touched. Re-running the file is a no-op. OPS-001 s8: proposed Low.
-- DEPENDS ON profiles only (the learner). Application order: any time after profiles exists, then 780. It does not
-- depend on 730 or 740 and nothing depends on it except the Scholar study plan card.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT HOLDS (census: no column existed for any of this).
--
--   exam_date       the learner exam date, optional. With none, the plan is a rolling weekly plan.
--   exam_label      the name of the exam, optional, up to 120 characters.
--   weekly_minutes  the study time the learner has each week, 30 to 3000 minutes.
--   days_per_week   how many days a week the learner studies, 1 to 7.
--   goal            the learner own goal in words, optional, up to 300 characters. A label only.
--   priorities      up to 10 topics the learner wants first. Topics are text, as the learner topics are everywhere
--                   in Scholar (a label of the learner notes, not a catalogue id), so no foreign key.
--
-- PRIVATE AND ERASABLE. RLS on, own-row SELECT only (owner ruling D6, as 372, 417, 720, 730 and 740). No grants. The
-- server writes through the service role in the Scholar store, keyed on the caller. The row goes with the learner
-- (cascade from profiles).
--
-- NOT COMPETENCE. A study plan is a plan, not an assessment. Nothing here is evidence, a verified competency, a
-- grade or a Passport record.
--
-- FAIL CLOSED WITHOUT IT. The Individual policy switch scholar_study_plan defaults off, and the code treats the
-- feature as off while this table is absent (the card is hidden, the route answers 409).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. No function. notify pgrst last.
-- ROLLBACK (staging): docs/evidence/SCHOLAR-COMPANION/ROLLBACK-780.sql. It refuses while any plan row exists.
-- ====================================================================================================

-- ---- 1. THE STUDY PLAN SETTINGS, ONE ROW PER LEARNER -------------------------------------------------

create table if not exists individual_scholar_study_plan (
  user_id         uuid primary key references profiles(id) on delete cascade,
  exam_date       date,
  exam_label      text,
  weekly_minutes  integer not null,
  days_per_week   smallint not null,
  goal            text,
  priorities      text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint individual_scholar_study_plan_exam_label_check
    check (exam_label is null or char_length(btrim(exam_label)) between 1 and 120),
  constraint individual_scholar_study_plan_weekly_minutes_check
    check (weekly_minutes between 30 and 3000),
  constraint individual_scholar_study_plan_days_per_week_check
    check (days_per_week between 1 and 7),
  constraint individual_scholar_study_plan_goal_check
    check (goal is null or char_length(btrim(goal)) between 1 and 300),
  constraint individual_scholar_study_plan_priorities_check
    check (cardinality(priorities) <= 10 and char_length(array_to_string(priorities, '|')) <= 2000)
);

-- ---- 2. RLS: own row, read only. The server writes through the service role -------------------------

alter table individual_scholar_study_plan enable row level security;

drop policy if exists individual_scholar_study_plan_read_own on individual_scholar_study_plan;
create policy individual_scholar_study_plan_read_own on individual_scholar_study_plan
  for select using (auth.uid() = user_id);

comment on table individual_scholar_study_plan is
  'SCHOLAR-COMPANION-01 (780). A learner''s study plan settings: optional exam date and name, study minutes and days per week, an optional goal, and up to 10 priority topics. The plan itself is computed on request and never stored. Private, formative, never assessment evidence.';

notify pgrst, 'reload schema';
