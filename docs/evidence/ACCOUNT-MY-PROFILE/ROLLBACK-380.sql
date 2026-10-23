-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 380 (profiles.given_name / profiles.family_name). STAGING REHEARSAL, AND THE
-- PRODUCTION ROLLBACK SHOULD 380 EVER BE APPLIED THERE UNDER ITS OWN GO.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On the STAGING project (ref ezhvpgtcqcdsgylrxgdb) the two columns
-- exist after 380. This file is safe to run where they do not exist -- it does nothing there -- but it
-- belongs only on the project where 380 was applied.
--
-- Reverses 380 exactly: drops the two CHECK constraints and the two columns. Dropping a column also
-- drops every privilege granted on it, so the two-column UPDATE grant of 380 goes with the columns and
-- needs no separate revoke (a revoke naming a column that is already gone is an error, which is why
-- there is none here). It touches nothing else -- not the five pre-existing column grants, not any
-- policy, not profile_authority_unchanged. Every statement is IF EXISTS, so re-running it is a no-op.
--
-- !! DROPPING THE COLUMNS DISCARDS ANY GIVEN OR FAMILY NAME A PERSON HAS ENTERED. Count them first
-- (select count(*) from profiles where given_name is not null or family_name is not null) and record the
-- count. On staging at the rehearsal it was 0.
--
-- ASCII only. No semicolons inside comments. notify pgrst last.
-- ====================================================================================================

alter table profiles drop constraint if exists profiles_given_name_check;
alter table profiles drop constraint if exists profiles_family_name_check;

alter table profiles drop column if exists given_name;
alter table profiles drop column if exists family_name;

notify pgrst, 'reload schema';
