-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 381 (confirmed auth email to profiles.email). STAGING REHEARSAL, AND THE
-- PRODUCTION ROLLBACK SHOULD 381 EVER BE APPLIED THERE UNDER ITS OWN GO.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On the STAGING project (ref ezhvpgtcqcdsgylrxgdb) the trigger
-- on_auth_user_email_confirmed and the function sync_confirmed_auth_email_to_profile exist after 381.
-- This file is safe to run where they do not exist -- it does nothing there -- but it belongs only on
-- the project where 381 was applied.
--
-- Drops the trigger, then the function. Touches no data: profiles.email values already synced stay as
-- they are (they are the confirmed Auth email), and the audit_log rows stay as the record. After this,
-- profiles.email simply stops following Auth again, which is the pre-381 behaviour. Every statement is
-- IF EXISTS, so re-running it is a no-op.
--
-- ASCII only. No semicolons inside comments. notify pgrst last.
-- ====================================================================================================

drop trigger if exists on_auth_user_email_confirmed on auth.users;
drop function if exists public.sync_confirmed_auth_email_to_profile();

notify pgrst, 'reload schema';
