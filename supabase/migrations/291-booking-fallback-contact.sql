-- 291 - THE WAY THROUGH WHEN THE DIARY CANNOT HELP
-- The owner, 2026-08-12: booking should be automatic and need no human step "as long as the spaces are
-- available... Human intervention needs to come in, AFTER the automated booking system has failed
-- e.g. if they need to be seen sooner than times available, they call a number or send an Email."
--
-- ====================================================================================================
-- WHAT THIS FIXES, IN ONE SENTENCE: THE PAGE ALREADY TOLD PATIENTS TO MAKE CONTACT AND NEVER SAID HOW.
--
-- When no slot is free the public booking page says "Try a later week, or contact the practice
-- directly" -- with no number and no address anywhere on it. That is the dead end this product keeps
-- being told about: a screen that names an action a person cannot take. These two columns are what the
-- sentence needs to be true.
--
-- ====================================================================================================
-- !! BOTH ARE NULLABLE, AND THAT IS THE FEATURE, NOT A DEFAULT-DODGE.
--
-- The owner asked for "either one or both". A practice with no telephone shows an address, one that
-- takes calls only shows a number, and one that has set neither shows the honest sentence it shows
-- today rather than an empty "call" label. So there is no NOT NULL and no placeholder string -- an
-- unset field is a fact the screen can read, and a blank-but-present one is not.
--
-- The email is BACKFILLED for existing practices at the owner's instruction, so the escape route works
-- from the moment this lands rather than from whenever somebody next opens the settings page.
--
-- !! btrim(...) <> '' RATHER THAN "IS NOT NULL" on the checks. A column that permits '' has two ways of
-- being empty and every reader must remember both -- migration 256 shipped exactly that bug and 257 is
-- the file that fixed it.
--
-- ====================================================================================================
-- ONBOARDING. PROV-001 s12's step list gains 'booking_fallback_contact' before 'review_activate', so a
-- practice is ASKED for this while it is being set up rather than discovering the gap from a patient
-- who could not reach anybody.
--
-- !! HONEST NOTE ABOUT WHAT THAT DOES TODAY: practice_onboarding_step_catalog is currently read in ONE
-- place (operations.ts, as a count for a platform figure) and there is no wizard iterating it. Adding
-- the row DECLARES the step where the steps are declared. It does not by itself draw a screen. The
-- field is configurable in Practice Setup from the same commit, which is the part a practice can use.
--
-- House rules obeyed: ASCII only, plain idempotent statements, no plpgsql, no do blocks, no functions,
-- notify pgrst last, and NO SEMICOLON ANYWHERE EXCEPT ENDING A STATEMENT - INCLUDING INSIDE A COMMENT,
-- because the runner splits the file on semicolons and one inside a comment silently drops the
-- statements around it while still reporting Success. No rows returned.

alter table practice_booking_access add column if not exists fallback_email text;

alter table practice_booking_access add column if not exists fallback_phone text;

alter table practice_booking_access drop constraint if exists ck_practice_booking_fallback_email;

alter table practice_booking_access add constraint ck_practice_booking_fallback_email
  check (fallback_email is null or (btrim(fallback_email) <> '' and fallback_email like '%@%.%'));

alter table practice_booking_access drop constraint if exists ck_practice_booking_fallback_phone;

alter table practice_booking_access add constraint ck_practice_booking_fallback_phone
  check (fallback_phone is null or btrim(fallback_phone) <> '');

-- The owner's address, seeded for every practice that already has a booking page.
update practice_booking_access
  set fallback_email = 'competenhealth@gmail.com'
  where fallback_email is null;

-- PROV-001 s12. review_activate moves to 7 so the new step sits before it and the order stays 1..7.
insert into practice_onboarding_step_catalog (step_code, position, required, title) values
  ('booking_fallback_contact', 6, false, 'How patients reach you when the diary is full')
on conflict (step_code) do nothing;

update practice_onboarding_step_catalog set position = 7 where step_code = 'review_activate';

notify pgrst, 'reload schema';
