-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 378 (individual_invitation). THE STAGING ROLLBACK, AND THE PRODUCTION ROLLBACK
-- SHOULD 378 EVER BE APPLIED THERE UNDER ITS OWN GO.
--
-- !! THIS DELETES EVERY INVITATION ROW. Dropping individual_invitation removes all invitation records --
-- pending, accepted and revoked -- with the table. Export them first if they must be kept. Nothing else is
-- deleted: identities created by invitations (auth users and their profiles rows, role null) stay, any
-- Individual membership or entitlement an accepted invitation granted stays (370 owns those), and the
-- audit_log rows individual_invitation_created, _revoked and _accepted stay as the record.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb) the objects exist after 378.
-- This file is safe where they do not exist -- it does nothing there -- but it belongs only on a project
-- where 378 was applied.
--
-- Dependency order: the trigger, then its function, then the view that reads the table, then the table
-- (its indexes, constraints, generated column and RLS policy go with it). Every statement is IF EXISTS,
-- so re-running it is a no-op. It touches no object 378 did not create.
--
-- After this, the invitation routes answer 503 NOT_SET_UP and the HQ screen says invitations are not set
-- up here: the code fails closed while the table is absent.
--
-- ASCII only. No semicolons inside comments. notify pgrst last.
-- ====================================================================================================

drop trigger if exists trg_individual_invitation_guard on public.individual_invitation;
drop function if exists public.individual_invitation_guard();
drop view if exists public.individual_live_invitation;
drop table if exists public.individual_invitation;

notify pgrst, 'reload schema';
