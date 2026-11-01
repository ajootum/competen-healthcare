-- ====================================================================================================
-- MIGRATION 830: COMPETEN SCHOLAR -- THE STUDY CALENDAR ENTRIES (SCHOLAR-MONTHLY-REVIEW-01)
--
-- Owner GO 1 Nov 2026, "Competen Scholar -- Monthly Learning Reviews and Study Calendar" (gap only). The calendar on
-- Progress is a VIEW of records that already exist (the study plan 780, cards 372, sessions 414 and 417, evaluations 426).
-- Three things need a place to live and had none, so this migration adds ONE small table, written only by the server.
--
--   plan_activity   the learner moved a planned activity to another day. ref is the activity key the calendar derives from
--                   the plan (space, title and which of that title), original_date the day the plan had, scheduled_date
--                   the day the learner chose.
--   monthly_review  the learner moved the recommended date of a month review (ref is the month, YYYY-MM), and/or a review
--                   was started and is waiting to be resumed (value holds where it is). The review itself is an evaluation
--                   (426) and is not stored here.
--   preference      the learner chose not to be shown monthly review suggestions (ref monthly_review_optout). No existing
--                   per-learner store fits: individual_scholar_learning_preference has CHECKed columns for lessons only.
--
-- NEVER A CARD DATE. Moving a planned activity or a review never changes when a card is due. Card schedules stay in
-- individual_scholar_card and the review log and nothing here reads or writes them.
-- NOT COMPETENCE. A calendar entry is a scheduling choice. It is not evidence, an assessment or a Passport record.
--
-- PRIVATE AND ERASABLE. RLS on, own-row SELECT only. No table grants. The server writes through the service role in the
-- Scholar store, keyed on the caller, and only dates within 60 days of today. Rows go with the learner (cascade from profiles).
--
-- APPLY ON STAGING FIRST. ADDITIVE. One new table. No existing table, column, row, function or trigger is touched.
-- Re-running the file is a no-op. Depends on profiles only. Nothing depends on it except the calendar Move button, the
-- monthly review resume link and the opt-out choice. Rollback: ROLLBACK-830.sql (refuses while any entry exists).
--
-- FAIL CLOSED WITHOUT IT. The store detects the table. Without it the calendar still shows everything, there is no Move
-- button, the opt-out is hidden, and a started review is resumed from Revise. The monthly review itself needs no migration.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. No function. notify pgrst last.
-- ====================================================================================================

-- ---- 1. THE CALENDAR ENTRIES, ONE ROW PER LEARNER, KIND AND REFERENCE ---------------------------------------

create table if not exists individual_scholar_calendar_entry (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  kind            text not null,
  ref             text not null,
  original_date   date,
  scheduled_date  date,
  value           jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table individual_scholar_calendar_entry drop constraint if exists individual_scholar_calendar_entry_check;
alter table individual_scholar_calendar_entry add constraint individual_scholar_calendar_entry_check
  check (kind in ('plan_activity', 'monthly_review', 'preference')
     and char_length(ref) between 1 and 200
     and (kind <> 'plan_activity' or (original_date is not null and scheduled_date is not null))
     and (kind <> 'monthly_review' or ref ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
     and (kind <> 'preference' or (ref = 'monthly_review_optout' and original_date is null and scheduled_date is null))
     and (value is null or (jsonb_typeof(value) = 'object' and octet_length(value::text) <= 20000)));

create unique index if not exists ux_individual_scholar_calendar_entry
  on individual_scholar_calendar_entry(user_id, kind, ref);

-- ---- 2. RLS: own rows, read only. The server writes through the service role -------------------------------

alter table individual_scholar_calendar_entry enable row level security;

drop policy if exists individual_scholar_calendar_entry_read_own on individual_scholar_calendar_entry;
create policy individual_scholar_calendar_entry_read_own on individual_scholar_calendar_entry
  for select using (auth.uid() = user_id);

comment on table individual_scholar_calendar_entry is
  'SCHOLAR-MONTHLY-REVIEW-01 (830). A learner''s study calendar choices: a planned activity moved to another day, a monthly review date moved or a review waiting to resume, and the choice not to be shown monthly review suggestions. Never a card date. Private, formative, never assessment evidence.';

notify pgrst, 'reload schema';
