-- ====================================================================================================
-- 294  PROCEDURE LIFECYCLE  (CPR-TRT-PROC-003 s7 and s10)
-- ====================================================================================================
--
-- WHAT THIS DOES
--   practice_procedure gains the lifecycle the specification asks for. Until now the only recordable
--   statuses were PERFORMED and ABANDONED, because migration 197 took the position that a plan which
--   was never carried out is the treatment row and nothing else. CPR-TRT-PROC-003 s9 disagrees on
--   purpose: a procedure planned for later is a procedure with a lifecycle rather than a treatment
--   plan, and the owner has ruled the newer specification the source of truth.
--
-- WHY IT IS SAFE TO RUN
--   practice_procedure holds ZERO rows. That was read from the live database before this file was
--   written, not assumed. No clinical record is rewritten and nothing changes meaning.
--
-- WARNING: ABANDONED STAYS VALID, ON PURPOSE, AND IT IS NOT A SECOND NAME FOR A LIVE STATE.
--   ABANDONED and the new ATTEMPTED are the same clinical fact under two names, and shipping both as
--   live values would guarantee a reporting bug where one query counts half the cases. It is retained
--   here for one reason only: this file is applied BY HAND, so for some window the running code is the
--   old code, and the old code writes ABANDONED. Removing the value would make procedure recording
--   fail outright for whoever is using the product during that window. Widen the database first,
--   narrow the code second. The UPDATE below moves any row that does exist onto ATTEMPTED, so the
--   value is valid but unused, and a later migration can drop it once nothing writes it.
--
-- WARNING: THE DEFAULT ON performed_at IS DROPPED, AND THAT IS THE HONESTY FIX IN THIS FILE.
--   performed_at was NOT NULL DEFAULT now(). With ORDERED and SCHEDULED now recordable, an inserted
--   row that has not happened yet would have silently carried a performance time -- a record claiming
--   the procedure was carried out, at a precise moment, because nobody passed a column. procedures.ts
--   line 184 sets performed_at explicitly on every insert, so dropping the default breaks no caller.
--   That was checked before this file was written.
--
-- WHAT IS NOT HERE
--   No configurable per-category status list yet. CPR-TRT-PROC-003 s14 asks for one, and this codebase
--   has a recorded habit of adding columns for a feature and then never reading them. It belongs with
--   the screen that reads it.
--
-- Apply in the Supabase SQL editor. Expected result: Success. No rows returned.
-- ====================================================================================================

-- ---- 1. The old two-value constraint comes off first -------------------------------------------------
-- The name is deterministic: migration 197 declared the check inline on the column, so PostgreSQL
-- named it practice_procedure_status_check.
alter table practice_procedure drop constraint if exists practice_procedure_status_check;

-- ---- 2. Any ABANDONED row becomes ATTEMPTED ---------------------------------------------------------
-- A no-op today at zero rows. It is here because this file is applied by hand at a time nobody can
-- predict, and rows may exist by then. It must run AFTER the drop above, because ATTEMPTED is not a
-- value the old constraint permits.
update practice_procedure set status = 'ATTEMPTED' where status = 'ABANDONED';

-- ---- 3. The lifecycle from s7 -----------------------------------------------------------------------
alter table practice_procedure add constraint practice_procedure_status_check
  check (status in ('ORDERED', 'SCHEDULED', 'PERFORMED', 'ATTEMPTED', 'CANCELLED', 'DECLINED', 'ABANDONED'));

-- ---- 4. A procedure that has not happened has no performance time -----------------------------------
alter table practice_procedure alter column performed_at drop not null;
alter table practice_procedure alter column performed_at drop default;

alter table practice_procedure add column if not exists ordered_at timestamptz;
alter table practice_procedure add column if not exists scheduled_at timestamptz;

-- ---- 5. Each status carries the timestamp that makes it true ----------------------------------------
-- Stated as three separate constraints rather than one, so a refusal names which fact is missing
-- instead of reporting that something about the row is wrong.
alter table practice_procedure drop constraint if exists practice_procedure_performed_at_check;
alter table practice_procedure add constraint practice_procedure_performed_at_check
  check (status <> 'PERFORMED' or performed_at is not null);

alter table practice_procedure drop constraint if exists practice_procedure_scheduled_at_check;
alter table practice_procedure add constraint practice_procedure_scheduled_at_check
  check (status <> 'SCHEDULED' or scheduled_at is not null);

alter table practice_procedure drop constraint if exists practice_procedure_ordered_at_check;
alter table practice_procedure add constraint practice_procedure_ordered_at_check
  check (status <> 'ORDERED' or ordered_at is not null);

-- ---- 6. The outstanding-work query ------------------------------------------------------------------
-- What is ordered or scheduled and not yet done, per practice. The existing indexes are all keyed on
-- performed_at, which is precisely the column an outstanding procedure does not have.
create index if not exists idx_practice_proc_lifecycle
  on practice_procedure(workspace_id, status, scheduled_at);

notify pgrst, 'reload schema';
