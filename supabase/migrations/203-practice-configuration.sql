-- ============================================================
-- MIGRATION 203: CONFIGURATION AND PERSONALISATION (CPR-360)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- practice_configuration HAS EXISTED SINCE MIGRATION 191 AND NOTHING HAS EVER READ IT.
--
-- Provisioning writes one row carrying the locale and then never looks at it again. `date_format`,
-- `default_encounter_mode`, `identifier_policy` and `feature_flags` have sat at their defaults since
-- Phase 0, honoured by nothing. That is the same shape as the bug CPR-310 found in
-- practice_role_assignment: a table designed correctly and then not wired up, which is worse than an
-- absent feature because it reads as a working one.
--
-- So this migration adds almost nothing. CPR-360 is mostly the work of making the existing table real.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- THE ONE COLUMN THAT IS GENUINELY MISSING is the default appointment length, which is hardcoded as 20
-- in two places in scheduling.ts. A practice whose consultations run 30 minutes has been fighting that
-- number since Phase 1.
--
-- NO NEW TRAIL TABLE, DELIBERATELY. Every module since CPR-140 has added one -- follow-up events, task
-- events, membership events, the access log -- and the reflex to add a fifth here is exactly the reflex
-- this codebase keeps warning itself about. Configuration changes are operational, practice_audit_event
-- is the workspace-wide operational log, and it already carries an actor, a payload and a correlation
-- id. "Who changed the timezone" is answerable from it. A dedicated table would be a second one of
-- something.
--
-- WHAT IS NOT HERE: personalisation. CPR-360's title includes it, and nothing in this product has a
-- per-user preference worth storing -- no themes, no densities, no default landing page anybody has
-- asked for. Inventing a preferences table so the module matches its own title would be building a
-- feature to fill a heading. Named rather than quietly skipped.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- this file survives any splitter.
-- ============================================================

-- ---- 1. The default appointment length ---------------------------------------------------------------
--
-- Bounded at both ends. Five minutes is the shortest thing anybody books; four hours is longer than any
-- consultation and a larger number is a typo that would wreck the double-booking check.

alter table practice_configuration add column if not exists default_appointment_minutes integer not null default 20;

alter table practice_configuration drop constraint if exists practice_configuration_duration_sane;
alter table practice_configuration add constraint practice_configuration_duration_sane
  check (default_appointment_minutes between 5 and 240);

-- ---- 2. One effective configuration per workspace ----------------------------------------------------
--
-- The `is_effective` flag has been in the table since 191 with nothing enforcing it. Two effective rows
-- would make "the configuration" ambiguous, and the code that reads it would pick whichever the planner
-- returned first -- a bug that appears as a setting that sometimes reverts.
--
-- A PARTIAL unique index, so superseded rows can accumulate if a future version wants history. Note for
-- whoever wires that up: PostgREST upsert cannot target a partial index -- check-then-write instead,
-- and check the error. That trap has cost this codebase two silent write failures already.

create unique index if not exists ux_practice_configuration_effective
  on practice_configuration(workspace_id) where is_effective = true;

-- ---- 3. Capability ----------------------------------------------------------------------------------
--
-- practice.settings.manage and practice.locations.manage BOTH ALREADY EXIST on the owner role from
-- migration 191, which is why nothing is inserted here. The nav has carried a Practice Settings item
-- pointing at an unbuilt route since Phase 0; CPR-360 is the route arriving, not a new permission.

-- ---- 4. RLS ------------------------------------------------------------------------------------------
--
-- practice_configuration and practice_location were both already enabled deny-by-default in 191.
-- Restated here only so a reader of this file does not have to go and check.

alter table practice_configuration enable row level security;
alter table practice_location enable row level security;

notify pgrst, 'reload schema';
