-- ============================================================
-- MIGRATION 242: THE SIX EXCEPTION TYPES, AND WHAT HAPPENS TO THE PATIENTS
-- CPR-V5-007 Phase 2 (s5.2, s5.3, s12)
--
-- ----------------------------------------------------------------------------------------------------
-- WARNING: THE POINT OF THIS PHASE IS NOT THE EXCEPTIONS. IT IS THE PATIENTS.
--
-- practice_availability_exception (migration 230) already closes and opens days. What it cannot do is
-- the thing s5.3 spends its whole section on: work out WHO WAS BOOKED into the time being changed, say
-- so before the change is committed, and require somebody to decide what happens to them.
--
-- Without that, cancelling a Friday clinic is a one-click operation that silently strands six people who
-- still think they have an appointment. s5.3's own words are "schedule changes can strand booked
-- patients", and the correction it asks for is a workflow, not a warning.
--
-- TWO CHANGES, THEREFORE:
--   1. the exception KIND list grows from four to s5.2's six categories
--   2. a new table records, per affected booking, what was decided about it
--
-- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
-- the end of a statement -- the runner splits on them, and a semicolon inside a comment silently drops
-- the statements around it while still reporting success. That happened on migration 238.
-- ============================================================

-- ---- 1. s5.2's SIX TYPES ---------------------------------------------------------------------------
--
-- 230 has leave, closure, extra_session and extended_hours. s5.2 names six categories, and three of them
-- have no home: a LOCATION CHANGE (temporary transfer or alternate room), an ACTIVITY SUBSTITUTION
-- (clinic replaced by theatre) and an EMERGENCY INTERRUPTION (urgent theatre, unexpected absence).
--
-- The four existing values are kept rather than renamed onto s5.2's vocabulary. Renaming would rewrite
-- every row and every reader for a tidier word list, and `leave` and `closure` are both s5.2's
-- "Unavailable" while remaining usefully different to a practitioner reading their own calendar.
--
-- DROP THEN ADD, because Postgres has no "add constraint if not exists". The dropped name is the one
-- Postgres generates for 230's INLINE column check.
alter table practice_availability_exception drop constraint if exists practice_availability_exception_kind_check;
alter table practice_availability_exception drop constraint if exists practice_exception_kind_allowed;
alter table practice_availability_exception add constraint practice_exception_kind_allowed
  check (kind in (
    'leave', 'closure', 'extra_session', 'extended_hours',
    'location_change', 'activity_substitution', 'emergency_interruption'));

-- WHERE IT MOVES TO, for a location change. Null for every other kind -- a constraint below refuses a
-- location change that does not say where, because "moved" without a destination is not information.
alter table practice_availability_exception add column if not exists replacement_location_id uuid
  references practice_location(id) on delete set null;

-- WHAT IT BECOMES, for an activity substitution. Same thirteen as practice_activity and migration 240's
-- session types -- a substitution that names a type Current Activity cannot start would produce a day
-- nobody can begin.
alter table practice_availability_exception add column if not exists replacement_activity_type text;
alter table practice_availability_exception drop constraint if exists practice_exception_activity_allowed;
alter table practice_availability_exception add constraint practice_exception_activity_allowed
  check (replacement_activity_type is null or replacement_activity_type in (
    'outpatient_clinic', 'ward_round', 'theatre', 'emergency_consult',
    'virtual_clinic', 'telephone_review', 'administration', 'teaching',
    'meeting', 'research', 'leave', 'travel', 'custom'));

-- A change that changes nothing is a row nobody can act on.
alter table practice_availability_exception drop constraint if exists practice_exception_replacement_present;
alter table practice_availability_exception add constraint practice_exception_replacement_present
  check (kind <> 'location_change' or replacement_location_id is not null);
alter table practice_availability_exception drop constraint if exists practice_exception_substitution_present;
alter table practice_availability_exception add constraint practice_exception_substitution_present
  check (kind <> 'activity_substitution' or replacement_activity_type is not null);

-- WARNING: s5.3 REQUIRES A RESOLUTION TO BE CHOSEN BEFORE THE CHANGE IS COMMITTED, so an exception
-- carries the moment somebody accepted responsibility for the people in it. Null means the impact has
-- not been reviewed -- which a screen must treat as "not ready", never as "nobody was affected".
alter table practice_availability_exception add column if not exists impact_reviewed_at timestamptz;
alter table practice_availability_exception add column if not exists impact_reviewed_by uuid;

-- ---- 2. WHAT WAS DECIDED ABOUT EACH AFFECTED PATIENT (s5.3, s12 AffectedBookingAction) -------------
--
-- ONE ROW PER BOOKING, NOT ONE PER EXCEPTION, and that is the whole design. s5.3's resolution options
-- include "Bulk reschedule -- user selects another session and CONFIRMS PATIENT-BY-PATIENT EXCEPTIONS",
-- so the unit of the decision is a person. A single strategy stored on the exception could not record
-- that five were moved and one was cancelled, which is the ordinary outcome.
--
-- IT IS ALSO THE ACTION QUEUE. `keep_pending` is a real choice in s5.3, and a booking parked there is
-- exactly what the workflow exists to make visible: unresolved, attached to a named patient, and
-- impossible to lose because the row outlives the screen that created it.
create table if not exists practice_affected_booking_action (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  exception_id uuid not null references practice_availability_exception(id) on delete cascade,
  appointment_id uuid not null references practice_appointment(id) on delete cascade,
  -- Denormalised so the queue can be read and named without joining through the diary.
  patient_id uuid references practice_patient(id) on delete set null,

  -- s5.3's six options, exactly.
  resolution text not null default 'keep_pending' check (resolution in (
    'keep_pending', 'offer_next_available', 'bulk_reschedule',
    'waiting_list', 'cancel_and_notify', 'no_patient_impact')),

  -- WARNING: `resolved` DOES NOT MEAN `keep_pending` WAS CHOSEN. Choosing to park something IS a
  -- decision, but it is not a resolution, and collapsing the two would let a practitioner clear a queue
  -- by deciding to do nothing about it. So the flag is derived from the resolution and enforced below.
  resolved boolean not null default false,

  -- Where it went, when it went somewhere. Null for every other outcome.
  rescheduled_appointment_id uuid references practice_appointment(id) on delete set null,
  note text check (note is null or char_length(note) between 1 and 500),

  decided_at timestamptz,
  decided_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table practice_affected_booking_action drop constraint if exists practice_affected_resolved_consistent;
alter table practice_affected_booking_action add constraint practice_affected_resolved_consistent
  check ((resolution = 'keep_pending' and resolved = false)
      or (resolution <> 'keep_pending' and resolved = true and decided_at is not null));

-- A booking is affected by an exception once. A second row would let two decisions about one patient
-- both look current, and the queue could not say which was acted on.
create unique index if not exists ux_practice_affected_booking
  on practice_affected_booking_action(exception_id, appointment_id);
-- The action queue read: everything still unresolved, newest exception first.
create index if not exists idx_practice_affected_pending
  on practice_affected_booking_action(workspace_id, created_at desc)
  where resolved = false;
create index if not exists idx_practice_affected_patient
  on practice_affected_booking_action(patient_id);

alter table practice_affected_booking_action enable row level security;

-- ---- 3. RLS ----------------------------------------------------------------------------------------
alter table practice_availability_exception enable row level security;

notify pgrst, 'reload schema';
