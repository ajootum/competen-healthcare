-- ============================================================
-- MIGRATION 363: THE EMERGENCY NOTICE ON A BOOKING PAGE (CPR-BOOK-FLOW-002 s8.5)
--
-- s8.5: "include a concise safety statement that online booking is not for emergencies and directs the
-- user to urgent local care. The wording must be deployment-appropriate and configurable. Do not
-- hard-code US emergency numbers."
--
-- ---- WHY A COLUMN RATHER THAN A CONSTANT --------------------------------------------------------
--
-- The sentence differs by country, by service and by practice. "Call 911" under a booking form in
-- Kampala is worse than saying nothing at all -- it sends somebody to a number that does not answer
-- while they are having the emergency. A constant in the codebase can only be wrong somewhere, so the
-- wording belongs to the practice that serves the patients reading it.
--
-- ---- NULLABLE, WITH NO DATABASE DEFAULT ---------------------------------------------------------
--
-- A default here would put words in the mouth of every practice that already exists, retroactively,
-- without anybody reading them -- and safety copy is the last thing to assign by migration. New
-- practices are offered a country-neutral suggestion by the provisioning baseline, and existing ones
-- are offered the same wording in the booking-page editor with a button that fills it in. Both are a
-- choice somebody makes. Null means this practice has not written one, and the patient page shows
-- nothing rather than something invented.
--
-- Bounded like its siblings (instructions, consent_text) so a paragraph cannot become a page.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

alter table practice_booking_access
  add column if not exists emergency_notice text;

alter table practice_booking_access
  drop constraint if exists practice_booking_access_emergency_notice_check;

alter table practice_booking_access
  add constraint practice_booking_access_emergency_notice_check
  check (emergency_notice is null or char_length(emergency_notice) between 1 and 600);

-- Verification: the column exists, is nullable, has no default, and the length bound is present.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_name = 'practice_booking_access'
   and column_name = 'emergency_notice';

select conname
  from pg_constraint
 where conname = 'practice_booking_access_emergency_notice_check';

notify pgrst, 'reload schema';
