-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 381 (confirmed auth email to profiles.email). STAGING REHEARSAL, AND THE
-- PRODUCTION ROLLBACK SHOULD 381 EVER BE APPLIED THERE UNDER ITS OWN GO.
--
-- Drops the trigger, then the function. Touches no data: profiles.email values already synced stay as
-- they are (they are the confirmed Auth email), and the audit_log rows stay as the record. After this,
-- profiles.email simply stops following Auth again, which is the pre-381 behaviour. Re-running it is a
-- no-op.
--
-- ASCII only. No semicolons inside comments. notify pgrst last.
-- ====================================================================================================

drop trigger if exists on_auth_user_email_confirmed on auth.users;
drop function if exists public.sync_confirmed_auth_email_to_profile();

notify pgrst, 'reload schema';
