-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 402 (educational context with history). THE STAGING ROLLBACK, AND THE PRODUCTION
-- ROLLBACK SHOULD 402 EVER BE APPLIED THERE UNDER ITS OWN GO.
--
-- RUN THIS AFTER ROLLBACK-403. Reverse order of application: 403 first, then 402.
--
-- !! THIS DELETES THE WHOLE CONTEXT HISTORY, THE BACKFILL INCLUDED. Dropping
-- individual_scholar_learner_context removes every period with the table -- the one-per-learner rows 402
-- backfilled from chosen_at, and every period written since. Export it first if it must be kept.
--
-- !! THE CURRENT LEVEL AND INSTITUTION ARE LOST. The four columns 402 added to individual_scholar_learner
-- are dropped. The pointer itself stays, with its 387 columns (user_id, programme_code, chosen_at), so each
-- learner keeps their current programme exactly as 387 recorded it before 402.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb) the objects exist after 402.
-- This file is safe where they do not exist -- it does nothing there.
--
-- Dependency order: the pointer trigger and its function FIRST, so no later statement can fire them, then
-- the history trigger and its function, then the history table (its index, constraints and RLS policy go
-- with it), then the CHECK and the four columns on the pointer. Every statement is IF EXISTS, so re-running
-- it is a no-op. It touches no object 402 did not create.
--
-- After this, the programme route records a programme alone the 387 way and refuses a level or an
-- institution, the join activation fails closed, and individual_self_registration must stay OFF.
--
-- ASCII only. No semicolons inside comments. notify pgrst last.
-- ====================================================================================================

drop trigger if exists trg_individual_scholar_learner_history on public.individual_scholar_learner;
drop function if exists public.individual_scholar_learner_history();

drop trigger if exists trg_individual_scholar_learner_context_append_only on public.individual_scholar_learner_context;
drop function if exists public.individual_scholar_learner_context_append_only();
drop table if exists public.individual_scholar_learner_context;

alter table if exists public.individual_scholar_learner drop constraint if exists individual_scholar_learner_context_shape;
alter table if exists public.individual_scholar_learner drop column if exists institution_label;
alter table if exists public.individual_scholar_learner drop column if exists institution_code;
alter table if exists public.individual_scholar_learner drop column if exists level_label;
alter table if exists public.individual_scholar_learner drop column if exists level_code;

notify pgrst, 'reload schema';
