-- ====================================================================================================
-- APPLY THIS FILE WHOLE. Run it as one script, never statement by statement.
--
-- MIGRATION 374: COMPETEN PROFESSIONAL REMINDER PREFERENCES -- IN-APP DEFAULT ON, EMAIL OPT-IN
--
-- COMPETEN-IND-007, owner continuation GO (Professional reminders, Option A). STAGING ONLY until a
-- separate owner GO for production.
--
-- WHAT IT DOES. Two preference columns on the own professional record of the person (migration 373):
--
--   reminder_in_app   default TRUE.  Show expiry reminders inside Competen Professional.
--   reminder_email    default FALSE. Also email them, through the existing email sender. Opt-in only.
--
-- The two are independent: either can be on or off without the other.
--
-- WHY HERE AND NOT notification_preferences. The estate table is ONE row per person, shared by every
-- product and read by unit managers for their staff (src/lib/operations/unit-communications.ts). An
-- Individual email switch stored there would also silence the employer notifications of the person, and an
-- employer-side change would silence their own reminders. Individual notifications stay separate from
-- Enterprise and Practice (owner ruling D1), so the preference lives on the own row of the person.
--
-- DEPENDENCIES. Only individual_professional_profile (migration 373). Independent of 375 (Scholar).
-- No new table, policy or index: the row keeps the own-row SELECT policy from 373 and no write policy.
--
-- HOUSE RULES (scripts/migration-house-rules.ts). ASCII only. No semicolons inside comments. Every
-- statement is idempotent (add column if not exists). No backfill is needed: the column defaults
-- apply to existing rows. notify pgrst LAST.
--
-- ROLLBACK (recorded in docs/COMPETEN-IND-007-professional-mvp.md): drop both columns. The application
-- reads them with their own query and falls back to the defaults (in-app on, email off) when they are
-- absent, so a rollback needs no code change.
-- ====================================================================================================

alter table individual_professional_profile
  add column if not exists reminder_in_app boolean not null default true;

alter table individual_professional_profile
  add column if not exists reminder_email boolean not null default false;

comment on column individual_professional_profile.reminder_in_app is
  'COMPETEN-IND-007, migration 374. Show expiry reminders inside Competen Professional. Default on. Independent of reminder_email.';

comment on column individual_professional_profile.reminder_email is
  'COMPETEN-IND-007, migration 374. Also email expiry reminders through the existing sender. Default off, opt-in. Independent of reminder_in_app. Never stored in the estate notification_preferences.';

notify pgrst, 'reload schema';
