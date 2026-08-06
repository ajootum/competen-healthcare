-- ============================================================
-- MIGRATION 240: A WEEKLY TIME BLOCK BECOMES A PRACTICE SESSION
-- CPR-V5-007 Phase 1 (s4.3), CPR-V5-008 Domain 2
--
-- ----------------------------------------------------------------------------------------------------
-- s4.3, verbatim: "A weekly time block must become a Practice Session. A session is a NAMED, RECURRING
-- period that carries enough context for planning, booking and encounter inheritance."
--
-- IT IS NOT A NEW TABLE. practice_availability_template (migration 230) has been that recurring weekly
-- period since it was written -- workspace, location, clinic, weekday, start and end minute, slot kind,
-- appointment length, active. What it lacks is the CONTEXT half of s4.3's sentence, which is what makes
-- a block a session: a name, what kind of work it is, whether patients may book it, how much capacity
-- it holds, and when the pattern starts and stops applying.
--
-- Creating practice_session_template beside it would have produced two answers to "when do I work on a
-- Tuesday", and every screen would have had to pick one. s12's entity list names PracticeSessionTemplate
-- and this is it -- the name in a specification is a description of a role, not an instruction to
-- create a row somewhere new.
--
-- WHAT IS NOT HERE, and is deliberately left for later phases rather than stubbed:
--   Phase 2  exceptions already exist (practice_availability_exception, migration 230). The
--            affected-booking workflow of s5.3 needs a table of its own and is not started.
--   Phase 3  s7's booking rule CARD model is far richer than practice_booking_rule. Widening it is its
--            own migration, with its own versioning decision -- s11 requires every booking to store the
--            rule ID AND VERSION that decided it, which this schema cannot yet do.
--   Phase 4  patient-facing access (handle, OTP, publish state) is a separable service by s8's own
--            instruction, and nothing here anticipates its shape.
--
-- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
-- the end of a statement -- the runner splits on them, and a semicolon inside a comment silently drops
-- the statements around it while still reporting success. That happened on migration 238.
-- ============================================================

-- ---- 1. THE NAME (s4.3) ----------------------------------------------------------------------------
--
-- Nullable, because every row that exists predates this and naming them by hand is not a migration's
-- job. s4.3 says the name may be SUGGESTED from location + activity + day, which is a screen's
-- responsibility -- and a suggestion written into the database becomes a name nobody chose.
alter table practice_availability_template add column if not exists session_name text;
alter table practice_availability_template drop constraint if exists practice_session_name_len;
alter table practice_availability_template add constraint practice_session_name_len
  check (session_name is null or char_length(btrim(session_name)) between 1 and 120);

-- ---- 2. WHAT KIND OF WORK IT IS (s4.3 "Activity type") ---------------------------------------------
--
-- WARNING: THIS IS THE SAME VOCABULARY AS practice_activity, AND IT HAS TO BE. s4.4's last line says a
-- confirmed Current Activity INHERITS the session's activity type -- so a session typed with a word the
-- activity table rejects would produce a session nobody can start. Migration 237 widened that list to
-- thirteen. This is the same thirteen, and the two must be widened together.
--
-- Nullable: an existing row has no activity type and guessing one from slot_kind would put a clinical
-- label on somebody's Tuesday that they never chose.
alter table practice_availability_template add column if not exists activity_type text;
alter table practice_availability_template drop constraint if exists practice_session_activity_allowed;
alter table practice_availability_template add constraint practice_session_activity_allowed
  check (activity_type is null or activity_type in (
    'outpatient_clinic', 'ward_round', 'theatre', 'emergency_consult',
    'virtual_clinic', 'telephone_review', 'administration', 'teaching',
    'meeting', 'research', 'leave', 'travel', 'custom'));

-- ---- 3. WHETHER PATIENTS MAY BOOK IT (s4.3, s4.4) --------------------------------------------------
--
-- WARNING: THE DEFAULT IS `none`, AND THAT IS THE SAFE DIRECTION. s4.4 says an inpatient or
-- administrative session is not publicly bookable by default, and the same reasoning applies to every
-- row that already exists: this migration cannot know which of them a practitioner would be willing to
-- expose to patients, and defaulting to bookable would publish somebody's ward round the moment the
-- booking page went live. Opening a session is a decision, and it should require one.
alter table practice_availability_template add column if not exists booking_mode text not null default 'none';
alter table practice_availability_template drop constraint if exists practice_session_booking_mode_allowed;
alter table practice_availability_template add constraint practice_session_booking_mode_allowed
  check (booking_mode in ('none', 'internal', 'link_only', 'public'));

-- ---- 4. CAPACITY AND WALK-INS (s4.3, s7.4) ---------------------------------------------------------
--
-- s7.4 divides the responsibility three ways -- availability provides the time, appointment types
-- provide the expected duration, and booking rules control how the resulting capacity is allocated.
-- (Paraphrased rather than quoted: the sentence uses semicolons, and a semicolon inside a comment is
-- what shredded migration 238.) So capacity here is a CONSTRAINT a practitioner may impose, not the
-- calculation -- null means "derive it from the time and the appointment length", which the engine can
-- already do from starts_minute, ends_minute and appointment_minutes.
--
-- The manual figure is kept separately from the derived one rather than overwriting it, because s7.4
-- requires the STRICTER of the two to win: a value that replaced the derivation could not be compared
-- against it.
alter table practice_availability_template add column if not exists capacity_manual integer;
alter table practice_availability_template drop constraint if exists practice_session_capacity_range;
alter table practice_availability_template add constraint practice_session_capacity_range
  check (capacity_manual is null or capacity_manual between 0 and 500);

alter table practice_availability_template add column if not exists walk_ins_allowed boolean not null default false;
alter table practice_availability_template add column if not exists walk_in_limit integer;
alter table practice_availability_template drop constraint if exists practice_session_walkin_limit;
alter table practice_availability_template add constraint practice_session_walkin_limit
  check (walk_in_limit is null or (walk_ins_allowed and walk_in_limit between 0 and 100));

-- ---- 5. WHEN THE PATTERN APPLIES (s4.3 "optional effective start/end date") ------------------------
--
-- WARNING: THIS IS WHAT MAKES s4.1 TRUE -- "Layer 1 defines the practitioner's stable but editable
-- baseline. It does not represent an immutable contract. Changes to employment, clinic days, locations
-- or responsibilities may update the baseline PROSPECTIVELY."
--
-- Without these two dates the only way to stop a Tuesday clinic is to delete the row, which erases the
-- fact that it ran for two years -- and every past occurrence, planner view and audit answer that
-- depended on it. Ending a session is a date, not a deletion.
alter table practice_availability_template add column if not exists effective_from date;
alter table practice_availability_template add column if not exists effective_to date;
alter table practice_availability_template drop constraint if exists practice_session_effective_order;
alter table practice_availability_template add constraint practice_session_effective_order
  check (effective_from is null or effective_to is null or effective_to >= effective_from);

-- An operational note. s4.3 is explicit that it is "Operational note only -- no clinical documentation",
-- so it is bounded and sits on the SESSION, never on a patient.
alter table practice_availability_template add column if not exists session_note text;
alter table practice_availability_template drop constraint if exists practice_session_note_len;
alter table practice_availability_template add constraint practice_session_note_len
  check (session_note is null or char_length(session_note) between 1 and 1000);

-- ---- 6. WHICH APPOINTMENT TYPES A SESSION OFFERS (s4.3, s4.5) --------------------------------------
--
-- s4.3: "Appointment types offered -- zero or more. ZERO MEANS NOT PATIENT-BOOKABLE." That sentence is
-- why this is a join table and not a column: zero, one and several are all real answers, and a single
-- reference could not express the first or the last.
--
-- s4.5 keeps appointment types a reusable child module referenced by BOTH sessions and booking rules,
-- so nothing about a type is copied here -- only the fact that this session offers it.
create table if not exists practice_session_appointment_type (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  template_id uuid not null references practice_availability_template(id) on delete cascade,
  appointment_type text not null check (char_length(btrim(appointment_type)) between 1 and 60),
  created_at timestamptz not null default now(),
  created_by uuid
);

-- A session offering the same type twice is a duplicate, not a stronger offer.
create unique index if not exists ux_practice_session_appt_type
  on practice_session_appointment_type(template_id, appointment_type);
create index if not exists idx_practice_session_appt_type_ws
  on practice_session_appointment_type(workspace_id);
alter table practice_session_appointment_type enable row level security;

-- ---- 7. RLS ----------------------------------------------------------------------------------------
alter table practice_availability_template enable row level security;

notify pgrst, 'reload schema';
