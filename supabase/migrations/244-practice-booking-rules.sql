-- ============================================================
-- MIGRATION 244: BOOKING RULES BECOME CARDS, AND EVERY DECISION REMEMBERS WHICH ONE DECIDED IT
-- CPR-V5-007 Phase 3 (s7, s11, s12, s14, s18 AC-05/AC-13)
--
-- ----------------------------------------------------------------------------------------------------
-- practice_booking_rule (migration 230) is a single inline row: one location, one appointment type, a
-- lead time, a horizon, a walk-in limit. s2.1 names that exactly as a problem to resolve -- "booking
-- rules are a single inline row / cannot express real clinical booking policy" -- and s22 says the
-- inline interface "is retired as the primary configuration method".
--
-- What a card needs that a row does not: a NAME somebody can recognise, a STATUS that is not just
-- active/inactive, a PRIORITY for when two rules could apply, and a VERSION -- because s11's last line
-- and AC-13 both require every evaluated booking to store the rule id AND THE VERSION that decided it.
--
-- WARNING: THE VERSION IS THE LOAD-BEARING PART, AND IT IS NOT DECORATION.
--
-- A booking made in March under a rule that was edited in June must still be explicable in September.
-- Without a version, "which rule allowed this?" can only ever be answered with the rule AS IT IS NOW,
-- which is a different rule wearing the same id -- and the one question anybody asks about a booking
-- that should not have happened is why it was allowed. s14 requires overrides to be immutable and
-- auditable. A mutable rule behind an immutable audit record makes that record decorative.
--
-- So: `version` increments on every substantive edit, and practice_booking_rule_version keeps the whole
-- prior shape. The booking side of that (storing applied_rule_id + applied_rule_version on an
-- appointment) is Phase 3's ENGINE work and is added here as two nullable columns, so a booking made
-- before the rules engine exists is honestly null rather than falsely attributed.
--
-- WHAT IS NOT HERE: s8's patient-facing access (handle, OTP, publish state) is Phase 4 and is a
-- separable service by s8's own instruction. s10's publish validation is Phase 6.
--
-- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
-- the end of a statement -- the runner splits on them, and a semicolon inside a comment silently drops
-- the statements around it while still reporting success. That happened on migration 238.
-- ============================================================

-- ---- 1. THE CARD (s7.1) ----------------------------------------------------------------------------
--
-- Every field here is one the card must show WITHOUT being opened -- s7.1's point is that scope and
-- effect are legible from the list, because a practitioner with four rules needs to see which one
-- governs Friday without reading four forms.
alter table practice_booking_rule add column if not exists name text;
alter table practice_booking_rule drop constraint if exists practice_booking_rule_name_len;
alter table practice_booking_rule add constraint practice_booking_rule_name_len
  check (name is null or char_length(btrim(name)) between 1 and 120);

alter table practice_booking_rule add column if not exists description text;
alter table practice_booking_rule drop constraint if exists practice_booking_rule_description_len;
alter table practice_booking_rule add constraint practice_booking_rule_description_len
  check (description is null or char_length(description) between 1 and 1000);

-- s7.1: Active / Draft / Paused. `active` (230) stays and is kept in step by the engine rather than
-- being dropped, because the generator and the legacy console both read it -- and migration 241 is a
-- fresh reminder that dropping a column with live readers is its own piece of work, not a tidy-up.
alter table practice_booking_rule add column if not exists status text not null default 'active';
alter table practice_booking_rule drop constraint if exists practice_booking_rule_status_allowed;
alter table practice_booking_rule add constraint practice_booking_rule_status_allowed
  check (status in ('draft', 'active', 'paused', 'archived'));

-- s11: "At equal specificity, explicit priority determines the winner." Higher wins. Default 0 so every
-- existing row starts equal, which is the honest starting point -- and s11's last clause says equal
-- specificity AND equal priority BLOCKS activation until resolved, so a tie is a refusal rather than a
-- coin toss the engine makes quietly.
alter table practice_booking_rule add column if not exists priority integer not null default 0;
alter table practice_booking_rule drop constraint if exists practice_booking_rule_priority_range;
alter table practice_booking_rule add constraint practice_booking_rule_priority_range
  check (priority between 0 and 1000);

alter table practice_booking_rule add column if not exists effective_from date;
alter table practice_booking_rule add column if not exists effective_to date;
alter table practice_booking_rule drop constraint if exists practice_booking_rule_effective_order;
alter table practice_booking_rule add constraint practice_booking_rule_effective_order
  check (effective_from is null or effective_to is null or effective_to >= effective_from);

-- ---- 2. SCOPE (s7.2 "Scope", s11's specificity ladder) ---------------------------------------------
--
-- 230 gave the rule a location and an appointment type. s11's ladder needs one rung more precise than
-- that -- "specific recurring session + appointment type" -- so a rule may name the session it governs.
-- Null means the rule is not session-specific, which is what every existing row is.
alter table practice_booking_rule add column if not exists session_template_id uuid
  references practice_availability_template(id) on delete cascade;

-- s7.3's six channels. Null means every channel, which is what a rule written before channels existed
-- meant in practice.
alter table practice_booking_rule add column if not exists channel text;
alter table practice_booking_rule drop constraint if exists practice_booking_rule_channel_allowed;
alter table practice_booking_rule add constraint practice_booking_rule_channel_allowed
  check (channel is null or channel in (
    'patient_self', 'practitioner', 'staff', 'referral', 'follow_up', 'walk_in'));

-- ---- 3. CAPACITY (s7.2 "Capacity", s7.4) -----------------------------------------------------------
--
-- s7.4: "Reserved capacity may not exceed the session capacity", and capacity is per SESSION, not per
-- day. These are the rule's allocation of a session's time -- the session still owns how much time
-- there is (migration 240's `capacity`).
alter table practice_booking_rule add column if not exists capacity_total integer;
alter table practice_booking_rule add column if not exists capacity_new integer;
alter table practice_booking_rule add column if not exists capacity_follow_up integer;
alter table practice_booking_rule add column if not exists capacity_urgent_reserve integer;
alter table practice_booking_rule add column if not exists overbooking_allowed integer not null default 0;

alter table practice_booking_rule drop constraint if exists practice_booking_rule_capacity_range;
alter table practice_booking_rule add constraint practice_booking_rule_capacity_range
  check ((capacity_total is null or capacity_total between 0 and 500)
     and (capacity_new is null or capacity_new between 0 and 500)
     and (capacity_follow_up is null or capacity_follow_up between 0 and 500)
     and (capacity_urgent_reserve is null or capacity_urgent_reserve between 0 and 100)
     and overbooking_allowed between 0 and 50);

-- WARNING: s7.4's FIRST RULE, IN THE DATABASE RATHER THAN ONLY THE ENGINE. "Reserved capacity may not
-- exceed the session capacity." A reserve larger than the total is not a strict policy, it is a rule
-- that can never be satisfied -- and it would fail at BOOKING time, in front of a patient, rather than
-- at configuration time in front of the person who typed it.
alter table practice_booking_rule drop constraint if exists practice_booking_rule_reserve_within_total;
alter table practice_booking_rule add constraint practice_booking_rule_reserve_within_total
  check (capacity_total is null
      or coalesce(capacity_new, 0) + coalesce(capacity_follow_up, 0) + coalesce(capacity_urgent_reserve, 0)
         <= capacity_total);

-- ---- 4. ELIGIBILITY, CONFIRMATION, WINDOW (s7.2, s7.5, s7.6) ---------------------------------------
--
-- s7.6's list. `any` is the honest default and the one every existing row already means.
alter table practice_booking_rule add column if not exists patient_eligibility text not null default 'any';
alter table practice_booking_rule drop constraint if exists practice_booking_rule_eligibility_allowed;
alter table practice_booking_rule add constraint practice_booking_rule_eligibility_allowed
  check (patient_eligibility in (
    'any', 'new_only', 'existing_only', 'referred_only', 'paediatric', 'adult', 'active_follow_up'));

alter table practice_booking_rule add column if not exists min_age_years integer;
alter table practice_booking_rule add column if not exists max_age_years integer;
alter table practice_booking_rule drop constraint if exists practice_booking_rule_age_range;
alter table practice_booking_rule add constraint practice_booking_rule_age_range
  check ((min_age_years is null or min_age_years between 0 and 130)
     and (max_age_years is null or max_age_years between 0 and 130)
     and (min_age_years is null or max_age_years is null or max_age_years >= min_age_years));

-- s7.2 "Confirmation": instant, practitioner approval, staff approval or conditional.
alter table practice_booking_rule add column if not exists confirmation_mode text not null default 'instant';
alter table practice_booking_rule drop constraint if exists practice_booking_rule_confirmation_allowed;
alter table practice_booking_rule add constraint practice_booking_rule_confirmation_allowed
  check (confirmation_mode in ('instant', 'practitioner_approval', 'staff_approval', 'conditional'));

-- s7.5's follow-up window: how early and how late a due follow-up may be booked against its date.
alter table practice_booking_rule add column if not exists follow_up_early_days integer;
alter table practice_booking_rule add column if not exists follow_up_late_days integer;
alter table practice_booking_rule drop constraint if exists practice_booking_rule_followup_window;
alter table practice_booking_rule add constraint practice_booking_rule_followup_window
  check ((follow_up_early_days is null or follow_up_early_days between 0 and 365)
     and (follow_up_late_days is null or follow_up_late_days between 0 and 365));

-- ---- 5. THE VERSION, AND THE HISTORY BEHIND IT (s11, s13, AC-13) -----------------------------------
alter table practice_booking_rule add column if not exists version integer not null default 1;
alter table practice_booking_rule drop constraint if exists practice_booking_rule_version_positive;
alter table practice_booking_rule add constraint practice_booking_rule_version_positive
  check (version >= 1);

-- WARNING: THE WHOLE PRIOR SHAPE, NOT A DIFF. A diff can only be read by replaying every earlier diff in
-- order, and the question this table exists to answer is asked about ONE booking months later. The
-- payload is jsonb because it is a photograph of a row whose columns will keep changing -- a set of
-- typed columns here would have to be migrated in step with the live table forever, and the day
-- somebody forgot, the history would silently start omitting a field.
create table if not exists practice_booking_rule_version (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  rule_id uuid not null references practice_booking_rule(id) on delete cascade,
  version integer not null check (version >= 1),
  payload jsonb not null,
  -- Why it changed. s13 asks for versioning and s14 for actor and timestamp on every configuration
  -- change. A version with no reason is a row somebody has to guess about.
  reason text check (reason is null or char_length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  created_by uuid
);

-- One row per version of a rule. A second would make "what did version 3 say" ambiguous.
create unique index if not exists ux_practice_booking_rule_version
  on practice_booking_rule_version(rule_id, version);
create index if not exists idx_practice_booking_rule_version_ws
  on practice_booking_rule_version(workspace_id, created_at desc);
alter table practice_booking_rule_version enable row level security;

-- ---- 6. WHAT DECIDED THIS BOOKING (s11 last line, AC-13) -------------------------------------------
--
-- Nullable on purpose. Every appointment that exists today was booked before any rules engine did, and
-- back-filling a rule id would be inventing a decision nobody made. Null means "not decided by a rule",
-- which is true, and a screen must say that rather than showing a blank where a rule name goes.
alter table practice_appointment add column if not exists applied_rule_id uuid
  references practice_booking_rule(id) on delete set null;
alter table practice_appointment add column if not exists applied_rule_version integer;

-- The two travel together or not at all. A rule id with no version cannot answer the question the pair
-- exists for.
alter table practice_appointment drop constraint if exists practice_appointment_applied_rule_complete;
alter table practice_appointment add constraint practice_appointment_applied_rule_complete
  check ((applied_rule_id is null and applied_rule_version is null)
      or (applied_rule_id is not null and applied_rule_version is not null));

create index if not exists idx_practice_appointment_applied_rule
  on practice_appointment(applied_rule_id);

-- ---- 7. RLS ----------------------------------------------------------------------------------------
alter table practice_booking_rule enable row level security;
alter table practice_appointment enable row level security;

notify pgrst, 'reload schema';
