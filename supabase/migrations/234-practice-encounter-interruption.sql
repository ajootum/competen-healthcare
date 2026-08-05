-- ============================================================
-- MIGRATION 234: INTERRUPTION-SAFE ENCOUNTERS (CPR-CORE-001 s6.2, backlog CORE-05 and CORE-06)
--
-- s7's Current Encounter feeder: "single active foreground encounter. drafts remain accessible."
-- s6.2: "the original session remains resumable and its queue is preserved", and "interruption time
-- must not be counted as active consultation time for another patient."
-- s16: "an emergency interruption does not lose the current clinic queue or active draft."
--
-- The encounter state machine already existed and was already right. What did not exist was any
-- constraint that only ONE of them may be ACTIVE, or any record of WHY one was paused. Without the
-- first, an emergency opened mid-consultation left two encounters running and the consult-time average
-- counted the interruption against the patient who was not in the room. Without the second, resuming
-- was guesswork.
--
-- Plain idempotent statements, ASCII only, no do-blocks, and no semicolon anywhere except at the end of
-- a statement -- the migration runner splits on them and a semicolon inside a comment cuts the file
-- mid-sentence.
-- ============================================================

-- ---- 1. What interrupted this encounter ------------------------------------------------------------
--
-- Set on the encounter that was PAUSED, pointing at the encounter that displaced it. Null is the normal
-- case: most pauses are somebody stepping out, not an emergency.
--
-- `on delete set null` rather than cascade. If the interrupting encounter is later voided, the
-- consultation it interrupted must not be deleted with it -- the interruption still happened, and the
-- paused time is still excluded from the average either way.
alter table practice_encounter add column if not exists interrupted_by_id uuid
  references practice_encounter(id) on delete set null;

-- The resume path reads this: given an encounter, what is waiting behind it.
create index if not exists idx_practice_encounter_interrupted_by
  on practice_encounter(interrupted_by_id) where interrupted_by_id is not null;

-- ---- 2. ONE ACTIVE ENCOUNTER PER PRACTITIONER ------------------------------------------------------
--
-- s7's "single active foreground encounter", enforced by the database rather than by the engine alone.
-- Two browser tabs both read "nothing active" and both write, and every figure downstream is built on
-- there being exactly one answer to "who am I with right now".
--
-- PER PRACTITIONER, not per practice. A two-doctor practice runs two consultations at once and always
-- has -- `created_by` is the closest thing this table has to an owner, which the engine comments on
-- where it writes it.
--
-- WARNING: PARTIAL, SO POSTGREST UPSERT CANNOT TARGET IT -- the same trap migrations 232 and 233 record.
-- Transitions here are UPDATE by id, never onConflict, and they must stay that way.
create unique index if not exists uq_practice_encounter_one_active
  on practice_encounter(workspace_id, created_by)
  where status = 'ACTIVE';

notify pgrst, 'reload schema';
