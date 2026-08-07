-- ============================================================
-- MIGRATION 255: TWO PATIENTS CANNOT BOOK THE SAME TIME, AND THE DATABASE IS WHAT REFUSES IT
-- CPR-V5-007 s7.4, s10.2, PEN-001 double-booking policy
--
-- ----------------------------------------------------------------------------------------------------
-- SEPARATE FROM 254 ON PURPOSE, BECAUSE THE RISK IS DIFFERENT.
--
-- 254 creates three empty tables and can only fail on its own syntax. This file ALTERS A LIVE TABLE with
-- live writers and, worse, an EXCLUDE constraint VALIDATES EVERY EXISTING ROW as it is added. If any two
-- live appointments already overlap, the statement fails -- and taking 254 down with it would be a bad
-- trade for a file that is applied by hand, once, with no rollback. Applied second, and independently.
--
-- CHECKED BEFORE WRITING: practice_appointment currently holds 3 rows, 2 of them live (REQUESTED,
-- CONFIRMED, one CANCELLED), all of type new_consultation, in one workspace, with ZERO overlapping live
-- pairs under the scope below. The constraint applies cleanly today.
--
-- ----------------------------------------------------------------------------------------------------
-- WHY A CONSTRAINT AND NOT A CHECK IN THE ENGINE
--
-- "Only free times are shown to the patient" is a RENDERING DECISION. It is not a control. Two patients
-- load the page in the same second, both see 09:00 free, both press book, and a read-then-write accepts
-- both -- neither request was wrong when it was read. This codebase has been bitten by exactly that shape
-- twice: the OTP attempt counter was a read-modify-write and let five parallel workers make far more than
-- five guesses, and the same file's rate limit read a failed count as nought.
--
-- checkPlacement() does the right check and does it well, but it does it BEFORE the insert, and nothing
-- holds the time between the two. This constraint closes that window: the second insert is refused by
-- Postgres with SQLSTATE 23P01, whichever engine, request or instance it came from.
--
-- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
-- the end of a statement -- the runner splits on them, and a semicolon inside a comment silently drops
-- the statements around it while still reporting success. That happened on migration 238.
-- ============================================================

-- ---- 1. btree_gist -------------------------------------------------------------------------------
--
-- A gist exclusion needs the range half for && and the SCALAR half for =. Core gist has no operator class
-- for uuid, so without this the constraint cannot name a workspace and would compare every practice's
-- diary against every other one. Migration 017 installs `vector` the same way.
create extension if not exists btree_gist;

-- ---- 2. THE OVERLAP THAT SOMEBODY MEANT ------------------------------------------------------------
--
-- WARNING: READ THIS BEFORE APPLYING. THIS COLUMN HAS A CONSEQUENCE IN CODE THAT IS NOT IN THIS FILE.
--
-- Three overlaps are legitimate today and the constraint must not refuse them:
--
--   walk_in and emergency   PEN-001's OVERLAP_EXEMPT. A queue exists precisely so that an unscheduled
--                           arrival needs no free grid slot. Excluded by appointment_type below.
--   a deliberate double-book  bookAppointment and bookUnderRules both accept allowOverlap, and s14 lets an
--                           authorised person double-book WITH A REASON. That decision is real, and it is
--                           recorded NOWHERE ON THE ROW -- allowOverlap is an argument that vanishes once
--                           the insert returns. So the database cannot currently tell a deliberate
--                           double-book from an accidental one.
--
-- This column is what makes that decision visible to the database. It is false for every existing row,
-- which is true of every existing row: none of them overlaps anything.
--
-- WARNING: UNTIL src/lib/practice/scheduling.ts (bookAppointment, rescheduleAppointment) and
-- src/lib/practice/booking-rules.ts (bookUnderRules) write `overlap_acknowledged: allowOverlap === true`
-- into their inserts, A DELIBERATE DOUBLE-BOOK WILL BE REFUSED BY THE DATABASE rather than by the engine.
-- The refusal is safe -- nothing is silently accepted -- but it is a working feature stopping until three
-- call sites each set one field. That change belongs with this migration and is not in it.
alter table practice_appointment add column if not exists overlap_acknowledged boolean not null default false;

-- ---- 3. THE SPAN, AS AN IMMUTABLE EXPRESSION -------------------------------------------------------
--
-- practice_appointment stores a start and a LENGTH, not an end, so the range has to be computed. It
-- cannot be computed inline: `timestamptz + interval` is STABLE, not IMMUTABLE, and an index or exclusion
-- expression must be immutable. A generated column does not help -- it has the same requirement -- and a
-- trigger-maintained ends_at needs plpgsql, whose body would be shredded by a runner that splits on
-- semicolons. So: a wrapper, whose own body contains no semicolon, exactly as migration 219's allocator.
--
-- '[)' -- INCLUSIVE START, EXCLUSIVE END, AND THIS IS THE DETAIL THAT DECIDES WHETHER A NORMAL DIARY
-- WORKS. A 09:00-09:30 appointment and a 09:30-10:00 appointment are back-to-back, not overlapping, and
-- under '[]' every adjacent pair in every diary would be refused. It also matches the engine exactly:
-- checkPlacement compares aStart < endMs && aEnd > startMs, which is the same half-open test.
--
-- greatest(..., 1) because an EMPTY range overlaps nothing at all. duration_minutes is NOT NULL and
-- checked between 5 and 480, so a zero-length appointment cannot exist today -- but if that check were
-- ever relaxed, a zero-minute booking would become an exemption from this constraint that nobody chose,
-- and it would be invisible.
--
-- NOT SECURITY DEFINER, DELIBERATELY. It reads nothing and needs no privilege. search_path is pinned
-- anyway, per migration 252, so the operators it resolves cannot be shadowed by a schema somebody else
-- can create in. Replacing this function later without rebuilding the constraint would leave index
-- entries computed by the old definition, so it should be treated as frozen.
create or replace function practice_appointment_span(starts_at timestamptz, minutes integer)
returns tstzrange
language sql
immutable
set search_path = pg_catalog, public
as $$ select tstzrange(starts_at, starts_at + make_interval(mins => greatest(coalesce(minutes, 20), 1)), '[)') $$;

-- ---- 4. THE CONSTRAINT -----------------------------------------------------------------------------
--
-- SCOPED BY WORKSPACE, NOT BY LOCATION, AND THAT IS NOT AN OVERSIGHT.
--
-- practice_appointment has no practitioner column. Competen Practice is an individual practitioner
-- product -- a workspace IS one clinician's diary, and team members are staff rather than clinicians with
-- diaries of their own. So workspace_id is the only key that means "one person's time", and it is exactly
-- the key checkPlacement already uses: it filters candidate clashes by workspace and status and then
-- compares times, with no location term at all. Adding location_id here would legalise 09:00 at Hospital A
-- alongside 09:00 at Hospital B, which is a regression against an engine that already refuses it -- and
-- nobody can be in two hospitals at once. The travel buffer between different locations is a separate,
-- softer rule and stays in the engine, because it depends on each location's configured buffer.
--
-- WARNING: IF THIS PRODUCT EVER PUTS TWO CLINICIANS IN ONE WORKSPACE, THIS CONSTRAINT MUST GAIN A PRACTITIONER
-- COLUMN FIRST. Until then it would refuse a second clinician's entire diary, and the refusal would look
-- like a bug rather than like this decision.
--
-- ONLY LIVE STATUSES PARTICIPATE. LIVE_STATUSES in scheduling.ts is REQUESTED, CONFIRMED, ARRIVED, and it
-- is copied here rather than widened: a CANCELLED appointment must not hold a time somebody else could
-- have, and a COMPLETED one is in the past and blocks nothing. A cancellation therefore frees the slot the
-- instant the status changes, with nothing to clean up.
alter table practice_appointment drop constraint if exists practice_appointment_no_overlap;
alter table practice_appointment add constraint practice_appointment_no_overlap
  exclude using gist (
    workspace_id with =,
    practice_appointment_span(scheduled_at, duration_minutes) with &&
  )
  where (status in ('REQUESTED', 'CONFIRMED', 'ARRIVED')
     and appointment_type not in ('walk_in', 'emergency')
     and not overlap_acknowledged);

-- ---- 5. WHAT A PATIENT MAY SEE ---------------------------------------------------------------------
--
-- A patient-facing availability read must answer "is this time free" and NOTHING ELSE. It must never
-- select patient_name, patient_id, reason or appointment_type, because "09:00 is taken" and "09:00 is
-- taken by an oncology follow-up for J Smith" are different disclosures and only one of them was asked
-- for. s14 says it outright: "Patient-facing errors must never reveal internal capacity, other patients
-- or hidden schedule details."
--
-- Nothing in this schema forces such a read: freeness is derivable from workspace_id, scheduled_at,
-- duration_minutes and status alone, and this index is on exactly those four so the cheapest query is
-- also the one that touches least. There is no column here a patient-facing path needs and no view that
-- would tempt one to select more.
create index if not exists idx_practice_appointment_live_span
  on practice_appointment(workspace_id, scheduled_at, duration_minutes)
  where status in ('REQUESTED', 'CONFIRMED', 'ARRIVED');

-- ---- 6. RLS ----------------------------------------------------------------------------------------
alter table practice_appointment enable row level security;

notify pgrst, 'reload schema';
