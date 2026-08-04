-- ============================================================
-- MIGRATION 231: AVAILABILITY SESSION MANAGEMENT (CPR-SETUP-003 v1)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- A SESSION BECOMES A FIRST-CLASS OBJECT WITH A LIFECYCLE, not a row you can only add.
--
-- CPR-SET-002 shipped with add and remove and nothing between them, which is how a practitioner ends
-- up with two 09:00-13:00 Tuesdays at two different hospitals and no way to fix either. This migration
-- adds what the lifecycle needs: a third state, a capacity, and the columns the edit form writes.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────

-- ---- 1. Three states, not a boolean ---------------------------------------------------------------
--
-- CPR-SETUP-003 s"Data Model" asks for Active / Suspended / Closed, and the difference between the last
-- two is the point of the feature:
--
--   suspended  I am not running this clinic for now, and I intend to come back to it. Stops generating,
--              keeps the row, keeps its place in the week.
--   closed     This clinic is over. Equivalent to the old `active = false`.
--
-- A boolean cannot express "paused", so a practitioner suspending a clinic for six weeks had to delete
-- it and retype it afterwards -- and retyping is where the second 09:00 Tuesday comes from.
--
-- BACKFILLED FROM `active`, and `active` is KEPT IN STEP rather than dropped: CPR-SET-002's engine, the
-- setup hub's count and the availability read all filter on it, and a migration that silently changed
-- what those queries mean would be the quietest possible way to break the generator.

alter table practice_availability_template add column if not exists status text
  not null default 'active'
  check (status in ('active', 'suspended', 'closed'));

update practice_availability_template
  set status = case when active then 'active' else 'closed' end
  where status = 'active' and active = false;

-- ---- 2. Capacity ----------------------------------------------------------------------------------
--
-- "Display: time, location, appointment type, booking capacity" (s"Session Card"). Nullable, and null
-- means UNLIMITED rather than nought -- the same distinction migration 230 drew for walk_in_daily_limit,
-- for the same reason: "no limit" and "none allowed" are different instructions.

alter table practice_availability_template add column if not exists capacity integer
  check (capacity is null or capacity >= 0);

-- ---- 3. The appointment type a session is for -----------------------------------------------------
--
-- Null means the session takes any type, which is what every session created before this migration was
-- doing. Constrained to migration 192's list so a session cannot offer a type the diary cannot store.

alter table practice_availability_template add column if not exists appointment_type text
  check (appointment_type is null or appointment_type in (
    'new_consultation', 'scheduled_followup', 'walk_in', 'emergency',
    'hospital_consultation', 'teleconsultation', 'home_visit'));

-- ---- 4. Where a session came from ------------------------------------------------------------------
--
-- Duplicating is one of the four actions, and a duplicate that carries no trace of its origin is
-- indistinguishable from a session somebody typed twice by mistake -- which is exactly the confusion
-- this whole migration exists to clear up.

alter table practice_availability_template add column if not exists duplicated_from_id uuid
  references practice_availability_template(id) on delete set null;

create index if not exists idx_practice_avail_template_status
  on practice_availability_template(workspace_id, status, weekday);

notify pgrst, 'reload schema';
