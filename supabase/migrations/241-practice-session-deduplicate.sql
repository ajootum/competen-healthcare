-- ============================================================
-- MIGRATION 241: TWO COLUMNS FOR ONE FACT, TWICE -- RESOLVED
--
-- ----------------------------------------------------------------------------------------------------
-- WARNING: THIS CORRECTS A MISTAKE IN MIGRATION 240, WHICH I WROTE.
--
-- 240 added `capacity_manual` and the practice_session_appointment_type join table to
-- practice_availability_template. Migration 231 had ALREADY added `capacity` and `appointment_type` to
-- that same table. I read migration 230's column list, which is where the table was created, and never
-- looked at what 231 later added to it -- so the current shape of a table amended across four
-- migrations is the SUM of them, and I checked only the origin.
--
-- The engine has been keeping both in step on write and resolving in the safe direction on read since
-- 240 landed, so nothing is broken. But safe handling of a duplicate is not the same as not having one,
-- and the next person to write against this table would have had to discover the arrangement rather
-- than read it.
--
-- WARNING: DROPPING A COLUMN IS DESTRUCTIVE AND IS NOT IDEMPOTENT IN THE WAY THE REST OF THIS SERIES IS. Each
-- drop below is guarded with `if exists`, so a second run is harmless -- but a first run genuinely
-- removes data, which is why section 1 COPIES BEFORE IT DROPS and why the copy is a separate statement
-- that can be verified before the drop is run.
--
-- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
-- the end of a statement -- the runner splits on them, and a semicolon inside a comment silently drops
-- the statements around it while still reporting success. That happened on migration 238.
-- ============================================================

-- ---- 1. APPOINTMENT TYPES: THE JOIN TABLE WINS, AND THE COLUMN'S DATA MOVES FIRST -------------------
--
-- The table is kept and the column goes, because they are NOT equally expressive. CPR-V5-007 s4.3 says
-- "Appointment types offered -- zero or more. ZERO MEANS NOT PATIENT-BOOKABLE", and a single text column
-- cannot say "several" at all, nor distinguish "none offered" from "not yet decided". The join table
-- can say all three. Where two stores overlap, the one that can express the requirement is the one to
-- keep, regardless of which arrived first.
--
-- THE COPY RUNS BEFORE THE DROP. Every session created since migration 231 may carry a type in that
-- column, and dropping it without moving the value would silently un-configure real sessions --
-- the kind of loss that is invisible until somebody's Friday clinic stops offering follow-ups.
--
-- `on conflict do nothing` because the engine has been writing BOTH since 240, so most rows will
-- already have their pair in the join table. This is the reconciliation, not the first write.
insert into practice_session_appointment_type (workspace_id, template_id, appointment_type)
select t.workspace_id, t.id, t.appointment_type
from practice_availability_template t
where t.appointment_type is not null
on conflict (template_id, appointment_type) do nothing;

alter table practice_availability_template drop column if exists appointment_type;

-- ---- 2. CAPACITY: NOT A DUPLICATE BUT AN AMBIGUITY, WHICH IS WORSE ----------------------------------
--
-- WARNING: THE TWO NULLS MEANT DIFFERENT THINGS, AND THAT IS THE REAL DEFECT HERE.
--
--   231's `capacity`         null means UNLIMITED. Its own comment says so, by analogy with
--                            walk_in_daily_limit: "no limit" and "none allowed" are different.
--   240's `capacity_manual`  null means DERIVE IT from the session length and the appointment length.
--
-- A reader looking at a null could not tell which question it was the answer to. Two columns holding
-- one fact is untidy. Two columns whose ABSENCE means opposite things is a trap.
--
-- `capacity` IS KEPT -- it is older, holds live data, and has more readers, so keeping it is the smaller
-- change. What changes is the MEANING of its null, which now follows s7.4: availability provides the
-- time, appointment types provide the duration, and the derived figure is the ceiling unless a
-- practitioner constrains it further.
--
-- THAT REDEFINITION IS SAFE IN ONE DIRECTION ONLY, AND IT IS THE RIGHT ONE. A row that was null meant
-- "unlimited" and now means "as many as the session's own length allows" -- for a 09:00-13:00 clinic at
-- twenty minutes each, twelve rather than infinity. Every such row therefore becomes STRICTER, never
-- looser. Nobody's session is silently opened wider than they left it, and "unlimited appointments in a
-- four-hour clinic" was never a real instruction anyway.
update practice_availability_template
set capacity = capacity_manual
where capacity is null and capacity_manual is not null;

alter table practice_availability_template drop column if exists capacity_manual;

-- The range check travelled with the dropped column, so the surviving one gets 240's bound. 231's own
-- check allowed any non-negative integer. 500 is the same ceiling 240 chose, and a session with more
-- than five hundred appointments in it is a typo rather than a clinic.
alter table practice_availability_template drop constraint if exists practice_session_capacity_range;
alter table practice_availability_template drop constraint if exists practice_availability_template_capacity_check;
alter table practice_availability_template add constraint practice_session_capacity_range
  check (capacity is null or capacity between 0 and 500);

-- ---- 3. RLS ----------------------------------------------------------------------------------------
alter table practice_availability_template enable row level security;

notify pgrst, 'reload schema';
