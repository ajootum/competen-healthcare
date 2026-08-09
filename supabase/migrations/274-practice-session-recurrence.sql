-- ============================================================
-- MIGRATION 274: A SESSION THAT DOES NOT REPEAT EVERY WEEK
-- CPR-RECUR-001. Extends practice_availability_template (migrations 230, 240, 241).
--
-- ----------------------------------------------------------------------------------------------------
-- The practice owner, walking the product: "I would like to set my weekly plan as alternate Saturdays to
-- be at TMR, not every Saturday. How do we do this?"
--
-- You could not. A session was a weekday and a time and it ran EVERY week. The only thing that could be
-- done instead was to create the weekly Saturday and then add a closure on every alternate Saturday for
-- ever -- which makes the week grid claim TMR every Saturday and corrects it one fortnight at a time.
--
-- ---- TWO COLUMNS, AND THE SECOND ONE IS THE WHOLE DESIGN --------------------------------------------
--
-- recurrence_weeks        repeat every N weeks. 1 is weekly and is what every existing row is.
-- recurrence_anchor_date  the FIRST OCCURRENCE THE PRACTITIONER CHOSE. Whole weeks are counted from it.
--
-- WARNING: THE TEMPTING SHORTCUT IS ISO WEEK-NUMBER PARITY -- even weeks on, odd weeks off -- which
-- needs one integer and no second column, and is wrong three ways.
--
--   1. IT DOES NOT SURVIVE A YEAR BOUNDARY. A 53-week ISO year puts two odd weeks side by side, so a
--      fortnightly clinic skips or doubles once every few years and every session after it moves
--      permanently. 2020, 2026 and 2032 are all 53-week years.
--   2. IT IS NOT WHAT A PRACTITIONER MEANS. They mean "this Saturday, then the one after next". Nobody
--      knows their own clinic's ISO week number.
--   3. TWO PRACTITIONERS WHO BOTH CHOSE ALTERNATE SATURDAYS A WEEK APART WOULD LAND ON THE SAME
--      SATURDAYS, because parity belongs to the calendar rather than to either of their choices.
--
-- An anchor date is a fact about somebody's diary. No calendar can move it.
--
-- ---- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ---------------------------------------------------
--
-- It does not touch a single existing row's behaviour. recurrence_weeks defaults to 1, and the engine
-- consults no anchor at 1, so every session that exists today keeps generating exactly the slots it
-- generated yesterday. There is no backfill because there is nothing to back-fill.
--
-- It does not model MONTHLY patterns ("first Tuesday of the month"). That is a different model with a
-- different edge case -- five-Tuesday months -- and inventing a column for it here would leave a store
-- nothing reads, which is this project's own recurring failure.
--
-- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
-- the end of a statement. The runner splits on them, and a semicolon inside a comment silently drops the
-- statements around it while still reporting success. That happened on migration 238.
-- ============================================================

-- ---- 1. HOW OFTEN --------------------------------------------------------------------------------
--
-- NOT NULL DEFAULT 1, so every existing row is answered by the migration itself rather than by a
-- nullable column every future reader has to remember means weekly.
--
-- Capped at 4. The four intervals the session editor offers are every week, every other week, every
-- three weeks and every four weeks, and a constraint wider than the control would store a number no
-- screen can display or edit.
alter table practice_availability_template
  add column if not exists recurrence_weeks integer not null default 1;

alter table practice_availability_template
  drop constraint if exists practice_session_recurrence_weeks_range;
alter table practice_availability_template
  add constraint practice_session_recurrence_weeks_range
  check (recurrence_weeks between 1 and 4);

-- ---- 2. WHICH WEEKS ------------------------------------------------------------------------------
--
-- Nullable, because a weekly session has no on-week and off-week to tell apart and inventing an anchor
-- for one would be storing a decision nobody made.
alter table practice_availability_template
  add column if not exists recurrence_anchor_date date;

-- WARNING: AN INTERVAL WITHOUT AN ANCHOR IS THE ONE STATE THAT CANNOT BE HONOURED. "Every other
-- Saturday" with no first Saturday names no Saturdays at all, and an engine handed that row has to guess
-- -- so the database refuses it instead. Existing rows all carry recurrence_weeks = 1 and pass.
alter table practice_availability_template
  drop constraint if exists practice_session_recurrence_anchor_required;
alter table practice_availability_template
  add constraint practice_session_recurrence_anchor_required
  check (recurrence_weeks = 1 or recurrence_anchor_date is not null);

-- WARNING: AN ANCHOR THAT IS NOT AN OCCURRENCE IS A SILENT PHASE ERROR. The anchor of a Saturday session
-- must itself be a Saturday, or every week is counted from a date the session never ran on and the
-- pattern lands on the wrong set of days without anything looking wrong. extract(isodow) is 1 = Monday
-- .. 7 = Sunday, matching the weekday column migration 230 defined.
--
-- The engine aligns an anchor onto the session's weekday when the weekday is edited, keeping the WEEK
-- the practitioner chose and changing only the day. This constraint is what catches every other writer.
alter table practice_availability_template
  drop constraint if exists practice_session_recurrence_anchor_weekday;
alter table practice_availability_template
  add constraint practice_session_recurrence_anchor_weekday
  check (recurrence_anchor_date is null
    or extract(isodow from recurrence_anchor_date) = weekday);

-- ---- 3. RLS --------------------------------------------------------------------------------------
--
-- Already enabled by migration 240 and repeated because enabling it twice is harmless and forgetting it
-- once is not.
alter table practice_availability_template enable row level security;

notify pgrst, 'reload schema';
