-- ============================================================
-- MIGRATION 243: THREE NEW EXCEPTION KINDS COULD NOT TAKE A WHOLE DAY
--
-- ----------------------------------------------------------------------------------------------------
-- WARNING: THIS IS THE SECOND HALF OF MIGRATION 242, WHICH I LEFT UNDONE.
--
-- 242 widened practice_availability_exception.kind from four values to seven. It did not touch
-- practice_availability_exception_window_check, which migration 230 wrote as:
--
--     (kind in ('leave', 'closure'))
--     or (starts_minute is not null and ends_minute is not null and ends_minute > starts_minute)
--
-- 230's own comment explains the intent exactly: "Adding time requires saying when. Removing it does
-- not -- leave takes the day." That is right, and it named the only two kinds that existed then which
-- could take a whole day.
--
-- Of 242's three new kinds, TWO REMOVE OR REPLACE TIME AND CAN LEGITIMATELY TAKE THE WHOLE DAY:
--
--   emergency_interruption  s5.2's example is "unexpected absence". A practitioner called away for the
--                           day is the ordinary case, and requiring them to type a window to say "I am
--                           not here" is the product arguing with them at the worst moment.
--   location_change         "temporary transfer" -- Tuesday happens at the other hospital, all of it.
--   activity_substitution   "clinic replaced by theatre" -- likewise, the whole session.
--
-- Until now the database refused all three without a window, so "I am away and the whole day is gone"
-- was not expressible for any of them. Phase 2's engine worked around it by marking the three as
-- needing a window. That workaround should now be removed.
--
-- WARNING: AND THIS IS THE CONSTRAINT THAT FOOLED MY OWN PROBE. Verifying 242, I inserted an
-- emergency_interruption with no window, saw it refused, and concluded the KIND list had not widened --
-- the silent-no-op failure I was primed to expect. It had widened. A different constraint was refusing,
-- and the only thing that settled it was reading the error message, which names the constraint. A
-- refusal tells you THAT something refused, never WHICH RULE did.
--
-- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
-- the end of a statement.
-- ============================================================

-- ---- THE WHOLE-DAY KINDS -----------------------------------------------------------------------------
--
-- extra_session and extended_hours are deliberately NOT added to the first clause. Both ADD time, and
-- 230's rule holds for them unchanged: you cannot add availability without saying when it is. A
-- whole-day extra session with no hours would generate nothing and look like a bug in the generator.
alter table practice_availability_exception drop constraint if exists practice_availability_exception_window_check;
alter table practice_availability_exception add constraint practice_availability_exception_window_check
  check (
    (kind in ('leave', 'closure', 'emergency_interruption', 'location_change', 'activity_substitution'))
    or (starts_minute is not null and ends_minute is not null and ends_minute > starts_minute)
  );

-- A window is still optional for those five and still valid: a two-hour emergency interruption on a
-- Tuesday afternoon is as real as losing the day, and the check above permits both. What it no longer
-- does is DEMAND one.
alter table practice_availability_exception enable row level security;

notify pgrst, 'reload schema';
