-- ============================================================
-- MIGRATION 227: AVAILABILITY RIBBON (CPR-CAL-001 v4 s13, s20, s24)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- ONE COLUMN. Everything else the calendar comp draws already exists.
--
-- practice_appointment has carried location_id, slot_id and the SIX appointment types the comp
-- colour-codes -- new_consultation, scheduled_followup, walk_in, emergency, hospital_consultation,
-- teleconsultation -- since migration 192. The queue, follow-ups, locations and patients are all there.
-- What is missing is the RIBBON's vocabulary: a slot currently says only whether it is OPEN, RESERVED,
-- BLOCKED or CLOSED, which is its BOOKING state and not what kind of session it is.
--
-- The comp's ribbon reads Clinic · Available · Full · Leave · Blocked · Emergency · Telemedicine, and
-- those are two different questions wearing one row:
--   WHAT KIND OF SESSION      clinic, telemedicine, emergency reserve, leave, blocked, admin -> below
--   WHETHER IT IS TAKEN       available / full -> DERIVED from whether a booking sits in it, never
--                             stored, because a stored "full" is wrong the moment somebody cancels
-- ────────────────────────────────────────────────────────────────────────────────────────────────────

alter table practice_availability_slot add column if not exists slot_kind text
  not null default 'clinic'
  check (slot_kind in ('clinic', 'telemedicine', 'emergency_reserve', 'leave', 'blocked', 'admin'));

create index if not exists idx_practice_slot_kind
  on practice_availability_slot(workspace_id, slot_kind, starts_at);

-- ---- Why there is no capacity column ---------------------------------------------------------------
--
-- The comp puts "82% Utilised" in a donut. On the registration screen that figure was refused because
-- capacity was recorded nowhere -- and here it IS: a slot has a start and an end, so a day with
-- availability defined has a real number of minutes behind it.
--
-- So the COUNTS are honest and are shown: hours scheduled against hours available. The PERCENTAGE is
-- still not, for the reason CPR-330 gives -- "7h 23m of 10h 00m" says everything 82% says and also says
-- what it is 82% OF, which is the part a reader needs on a morning when only two hours were ever
-- available. And on a day with no availability defined at all, the screen says that rather than
-- dividing by an assumption.

notify pgrst, 'reload schema';
