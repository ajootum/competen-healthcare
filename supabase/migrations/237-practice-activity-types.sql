-- ============================================================
-- MIGRATION 237: THE FIVE ACTIVITY TYPES CPR-V5-005 ASKS FOR AND 232 REJECTS
--
-- ----------------------------------------------------------------------------------------------------
-- Migration 232 wrote CPR-V3-001 s4's list of eight activity types into a CHECK constraint, with the
-- comment "a type not on it is a type no screen knows how to draw". That was right then. CPR-V5-005
-- names a longer list twice, and the constraint is now the thing standing between the planner and its
-- own specification:
--
--   s2  "Supports outpatient, inpatient, theatre, teaching, administration, telemedicine, MEETINGS,
--        RESEARCH, LEAVE, TRAVEL and CUSTOM activities."
--   s9  Quick Actions: Add Clinic, Add Ward Round, Add Theatre, Add Telemedicine, ADD MEETING,
--        Add Administration, ADD TRAVEL, ADD CUSTOM ACTIVITY.
--
-- Six of s9's eight buttons already have a type behind them. Without this migration the other two, and
-- three of s2's eleven categories, are buttons that throw a constraint violation on click -- which is
-- the failure mode where the screen looks finished and the product is not.
--
-- WHY EACH ONE IS A PLANNED ACTIVITY AND NOT SOMETHING ELSE:
--
--   meeting   An MDT, a board, a supervision hour. It occupies the practitioner, it has a place, and
--             the Current Activity engine should say so -- "you are in a meeting" is a real answer to
--             "where are you", and today it can only be recorded by mislabelling it administration.
--
--   research  Distinguished from administration because it is the category practitioners are asked to
--             account for separately, by funders and by universities. Folding it into admin destroys
--             the one figure anybody wants from it.
--
--   leave     WARNING: THE MOST IMPORTANT ONE, AND IT IS NOT AN ABSENCE OF A ROW. A day with no activities is
--             ambiguous: nothing planned yet, or deliberately not working? The planner's conflict check,
--             its workload arithmetic and any future cover arrangement all need to tell those apart,
--             and only a positive record can. Leave is a thing you plan, not a gap you leave.
--
--   travel    s5 lists "Add Travel" as an action and s9 as a quick action, so travel is a BLOCK a
--             practitioner puts in the day, not a computed gap.
--             WARNING: THIS IS NOT practice_location.travel_buffer_minutes AND MUST NOT BE CONFUSED WITH IT.
--             The buffer is an allowance typed once against a location and summed by the planner. A
--             travel activity is a specific journey somebody deliberately planned. Migration 236 and
--             hospital-booking.ts both refuse to call either one a measured distance, and neither
--             becomes measured by being stored here.
--
--   custom    The escape hatch s2 asks for by name. NO NEW COLUMN IS NEEDED: practice_activity.title
--             has been free text since 232, so a custom activity is a row whose type says "the label is
--             the whole answer". This is deliberately the LAST resort -- a typed activity can be counted
--             and a custom one can only be read, so anything that recurs deserves its own type here
--             rather than a thousand hand-typed variations of the same word.
--
-- WHAT THIS MIGRATION DOES NOT DO:
--
--   NO STATUS, NO DEFAULT, NO BACKFILL. Nothing existing changes type. Every row already in the table
--   is valid under the wider constraint by construction, so the re-add validates trivially.
--
--   NO NEW CAPABILITY. Creating any activity is appointment.manage (migration 192), whatever its type.
--   A per-type capability would be a permission model nobody asked for, and an invented code compiles
--   perfectly and returns 403 for every user including the owner -- that has shipped here five times.
--
--   WARNING: THE CONSTRAINT STAYS CLOSED. It would be easier to drop it and let any string through, and that
--   is exactly the wrong lesson to take from having to widen it twice. A closed list is what lets a
--   screen know how to draw a type, a report know how to group one, and this file be the one place the
--   vocabulary is written down. Widening it is a decision with a document behind it. Removing it would
--   mean nobody ever has to make that decision again, and nobody could ever answer what the types are.
--
-- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
-- the end of a statement -- the migration runner splits the file on them and a semicolon inside a
-- comment cuts the statement it sits in half.
-- ============================================================

-- ---- 1. WIDEN THE TYPE CONSTRAINT ------------------------------------------------------------------
--
-- DROP THEN ADD, because Postgres has no "add constraint if not exists" and a do-block is not available
-- here. The pair is idempotent and is the pattern migrations 203, 211, 222, 229, 230 and 236 use.
--
-- The dropped name is the one Postgres generated for 232's INLINE column check. An inline
-- "check (activity_type in (...))" on column activity_type is named <table>_<column>_check, so the drop
-- below targets 232's constraint and the add below replaces it with an explicitly named one that later
-- migrations can find without having to know that rule.

alter table practice_activity drop constraint if exists practice_activity_activity_type_check;
alter table practice_activity drop constraint if exists practice_activity_type_allowed;

alter table practice_activity add constraint practice_activity_type_allowed
  check (activity_type in (
    'outpatient_clinic', 'ward_round', 'theatre', 'emergency_consult',
    'virtual_clinic', 'telephone_review', 'administration', 'teaching',
    'meeting', 'research', 'leave', 'travel', 'custom'));

-- ---- 2. A CUSTOM ACTIVITY MUST CARRY A REAL LABEL ---------------------------------------------------
--
-- Every other type is self-describing: a row typed ward_round says what it is even if the title is
-- thin. A custom one says nothing at all, so its title IS the type and a placeholder there is a block on
-- the week that nobody can identify. 232 already requires a title of 1 to 200 characters, which stops
-- the empty string but not the word "Custom" -- and "Custom" is precisely the title a form defaults to.
--
-- Checked in the database rather than only in the engine because the alternative is a week view holding
-- four identical grey blocks and no way to find out what any of them were.
alter table practice_activity drop constraint if exists practice_activity_custom_needs_title;
alter table practice_activity add constraint practice_activity_custom_needs_title
  check (activity_type <> 'custom' or lower(btrim(title)) not in ('custom', 'custom activity', 'activity', 'untitled'));

-- ---- 3. RLS -----------------------------------------------------------------------------------------
--
-- Re-asserted rather than assumed. No new table: both constraints land on practice_activity, whose
-- deny-by-default posture and reasoning are in migration 232.
alter table practice_activity enable row level security;

notify pgrst, 'reload schema';
