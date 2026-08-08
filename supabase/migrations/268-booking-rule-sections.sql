-- MIGRATION 268: BOOKING RULE -- REQUIRED INFORMATION, WALK-IN CUTOFF AND QUEUE, CANCELLATIONS
-- CPR-V5-007 s7.2, s7.7, s9
--
-- Additive columns on practice_booking_rule only. Nothing is dropped and nothing is backfilled:
-- every default below is the behaviour this product had before the column existed, so applying
-- this migration changes no decision anywhere until somebody configures something.
-- ============================================================

-- ---- 1. s7.2 REQUIRED INFORMATION (s9's intake) ---------------------------------------------
--
-- A JSONB COLUMN RATHER THAN A CHILD TABLE, AND THE REASON IS AC-13. The rule VERSION snapshot in
-- practice_booking_rule_version photographs COLUMNS. A child table would not be in the photograph,
-- so "which questions were required when this booking was made" would be answered with today's
-- answer -- which is the exact defect versioning exists to prevent.
--
-- The shape is { "fields": { "<field_key>": "off|optional|required" } }, or an object per field
-- carrying a condition. It is validated in requiredInformationOf(), which drops anything it does
-- not recognise rather than enforcing it. An EMPTY object means every question is accepted if given
-- and demanded of nobody, which is what this product did before this column existed.
alter table practice_booking_rule add column if not exists required_information jsonb not null default '{}'::jsonb;
alter table practice_booking_rule drop constraint if exists practice_booking_rule_required_info_object;
alter table practice_booking_rule add constraint practice_booking_rule_required_info_object
  check (jsonb_typeof(required_information) = 'object');

-- ---- 2. s7.7 WALK-IN CUTOFF AND QUEUE POLICY ------------------------------------------------
--
-- WARNING: ON THE RULE, NOT ON THE SESSION, AND THAT IS A DEPARTURE FROM WHAT recall-constants.ts SAID
-- WOULD BE NEEDED. Its note proposed walk_in_cutoff_minutes on practice_availability_template. The
-- rule table is better and the reason is the ladder that already exists: a rule may name a session
-- (session_template_id), so a cutoff here can be per session, per location, per appointment type or
-- practice-wide, and s11 decides which one applies. On the template it could only ever be one of
-- those four. The note is corrected rather than followed.
--
-- NULL MEANS NO CUTOFF. The range starts at 1 rather than 0 because a cutoff of 0 minutes before the
-- end is a session with no cutoff, and two spellings of one answer is a question with two answers.
alter table practice_booking_rule add column if not exists walk_in_cutoff_minutes integer;
alter table practice_booking_rule drop constraint if exists practice_booking_rule_walk_in_cutoff_range;
alter table practice_booking_rule add constraint practice_booking_rule_walk_in_cutoff_range
  check (walk_in_cutoff_minutes is null or walk_in_cutoff_minutes between 1 and 720);

-- 'first_come' is what happened before this column, so it is the default and applying this changes
-- no waiting room anywhere.
alter table practice_booking_rule add column if not exists walk_in_queue_policy text not null default 'first_come';
alter table practice_booking_rule drop constraint if exists practice_booking_rule_queue_policy_known;
alter table practice_booking_rule add constraint practice_booking_rule_queue_policy_known
  check (walk_in_queue_policy in ('first_come', 'priority_then_first_come'));

-- ---- 3. s7.2 CANCELLATIONS ------------------------------------------------------------------
--
-- WARNING: THESE GOVERN A PATIENT'S OWN CANCELLATION AND NOTHING ELSE. A practice must always be able to
-- correct its own diary, so nothing here is ever consulted for a practitioner or staff cancellation.
-- TRUE by default: patient self-service was already permitted and this must not switch it off.
alter table practice_booking_rule add column if not exists self_cancel_allowed boolean not null default true;
alter table practice_booking_rule add column if not exists self_reschedule_allowed boolean not null default true;

-- NULL MEANS THE CANCELLATION NOTICE GOVERNS A MOVE TOO, which is what patient-booking.ts already
-- did and reported doing. A number here separates the two.
alter table practice_booking_rule add column if not exists reschedule_notice_minutes integer;
alter table practice_booking_rule drop constraint if exists practice_booking_rule_reschedule_notice_range;
alter table practice_booking_rule add constraint practice_booking_rule_reschedule_notice_range
  check (reschedule_notice_minutes is null or reschedule_notice_minutes between 0 and 43200);

-- s7.2's DNA handling. NULL threshold means no rule, which is not the same as a threshold of 0 --
-- 0 would mean a single missed appointment counts, and somebody has to be able to write that.
alter table practice_booking_rule add column if not exists dna_threshold integer;
alter table practice_booking_rule drop constraint if exists practice_booking_rule_dna_threshold_range;
alter table practice_booking_rule add constraint practice_booking_rule_dna_threshold_range
  check (dna_threshold is null or dna_threshold between 0 and 50);

alter table practice_booking_rule add column if not exists dna_action text not null default 'none';
alter table practice_booking_rule drop constraint if exists practice_booking_rule_dna_action_known;
alter table practice_booking_rule add constraint practice_booking_rule_dna_action_known
  check (dna_action in ('none', 'require_approval', 'block_self_booking'));

-- A threshold with nothing to do, and an action with nothing to count, are both half a rule. Refused
-- here rather than left to a screen, because the halves are written on two different controls.
alter table practice_booking_rule drop constraint if exists practice_booking_rule_dna_pair;
alter table practice_booking_rule add constraint practice_booking_rule_dna_pair
  check ((dna_action = 'none' and dna_threshold is null) or (dna_action <> 'none' and dna_threshold is not null));

alter table practice_booking_rule add column if not exists waiting_list_enabled boolean not null default false;

alter table practice_booking_rule enable row level security;

notify pgrst, 'reload schema';

-- ============================================================
