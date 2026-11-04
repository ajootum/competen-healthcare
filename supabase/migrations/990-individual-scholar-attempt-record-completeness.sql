-- ====================================================================================================
-- MIGRATION 990: COMPETEN SCHOLAR -- ATTEMPT RECORD COMPLETENESS (SQIE-CLOSE-2026-11 WS-D)
--
-- Owner directive SQIE-CLOSE-2026-11 (4 Nov 2026) s5 "persist the exact rubric version used for each attempt" and s7
-- "connect question performance to the appropriate version of the learner programme competency framework". Tracker
-- rows SQIE-04, SQIE-07 and SQIE-08 (docs/programme/SQIE-CLOSE-2026-11-TRACKER.md, rank 3 WS-D).
--
-- WHY. Migration 950 lets an understanding check answer be kept WITHOUT a mark (individual_scholar_attempt.marking
-- unmarked), but the 791 snapshot CHECK knows only deterministic, self_graded and ai_evaluation, so such an attempt
-- could keep no snapshot. And a snapshot names the competency ids a question practised but not WHICH VERSION of the
-- framework they belonged to: framework_competencies rows are edited in place (751), so an id alone does not pin what
-- the competency said when the attempt was marked.
--
-- WHAT IT CHANGES. Additive only. No row is changed, nothing is backfilled (an existing snapshot stays as it was).
--   1. The 791 shape CHECK is recreated with ONE difference: marking also allows unmarked, and an unmarked snapshot
--      carries no score and the outcome incorrect (the 950 rule on the attempt: never correct, no score). A reader
--      that shows an outcome reads marking first: an unmarked attempt is shown as kept without a mark, never as wrong.
--      ai_evaluation was already allowed by 791 and stays.
--   2. individual_scholar_attempt_snapshot.competency_provenance, nullable jsonb: for each competency the question
--      practised, the framework it belongs to and that framework version at the time, and the competency content hash
--      (395/761 competency_content_hash). An array of at most 20 objects, each with a uuid competency_id, at most 4000
--      bytes. Null means not recorded (every snapshot before 990, and any where the framework could not be read).
--
-- UNCHANGED. The 791 guard (immutable, cascade-removable), the correction table, RLS read-own, no table grants. The
-- snapshot stays one row per attempt, written only by the server through the Scholar store.
--
-- FAIL CLOSED WITHOUT IT. The store sends competency_provenance only where it has one, and an insert refused for the
-- column is retried without it. An unmarked check attempt whose snapshot 791 refuses is kept exactly as before, with
-- no snapshot and no error to the learner.
--
-- FORMATIVE. A snapshot is a record of a private practice attempt. A framework version on it says what the question
-- practised, never that a competency was met, staged or verified.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Depends on 791 (and 950 for the
-- attempts it describes). Re-running it is a no-op. Rollback: docs/evidence/SQIE-RECORDS/ROLLBACK-990.sql (refuses
-- while any unmarked snapshot or any recorded provenance exists).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. notify pgrst last.
-- ====================================================================================================

-- ---- 1. THE MARKING RULE GAINS unmarked --------------------------------------------------------------

alter table individual_scholar_attempt_snapshot drop constraint if exists individual_scholar_attempt_snapshot_shape_check;
alter table individual_scholar_attempt_snapshot add constraint individual_scholar_attempt_snapshot_shape_check
  check (question_version ~ '^(lib:[0-9a-f-]{36}|own:[0-9]{1,6})$'
     and content_hash ~ '^[0-9a-f]{16}$'
     and (rubric_hash is null or rubric_hash ~ '^[0-9a-f]{16}$')
     and jsonb_typeof(presented) = 'object'
     and jsonb_typeof(response) = 'object'
     and jsonb_typeof(answer_key) = 'object'
     and (rubric is null or jsonb_typeof(rubric) = 'object')
     and (feedback is null or jsonb_typeof(feedback) = 'object')
     and octet_length(presented::text) + octet_length(response::text) + octet_length(answer_key::text)
         + coalesce(octet_length(rubric::text), 0) + coalesce(octet_length(feedback::text), 0) <= 16384
     and (score is null or (score >= 0 and score <= 1))
     and outcome in ('correct', 'partial', 'incorrect')
     and marking in ('deterministic', 'self_graded', 'ai_evaluation', 'unmarked')
     and (marking <> 'unmarked' or (score is null and outcome = 'incorrect'))
     and cardinality(competency_ids) <= 20);

-- ---- 2. THE FRAMEWORK VERSION EACH COMPETENCY BELONGED TO -------------------------------------------------

alter table individual_scholar_attempt_snapshot add column if not exists competency_provenance jsonb;

alter table individual_scholar_attempt_snapshot drop constraint if exists individual_scholar_attempt_snapshot_provenance_check;
alter table individual_scholar_attempt_snapshot add constraint individual_scholar_attempt_snapshot_provenance_check
  check (competency_provenance is null
      or (jsonb_typeof(competency_provenance) = 'array'
          and jsonb_array_length(competency_provenance) <= 20
          and octet_length(competency_provenance::text) <= 4000
          and not jsonb_path_exists(competency_provenance,
                '$[*] ? (@.type() != "object" || !exists(@.competency_id) || @.competency_id.type() != "string" || !(@.competency_id like_regex "^[0-9a-f-]{36}$"))')));

comment on column individual_scholar_attempt_snapshot.competency_provenance is
  'SQIE-CLOSE-2026-11 WS-D (990). For each competency the question practised: competency_id, framework_id, framework_code, framework_version (major.minor.revision at the time), content_hash (competency_content_hash at the time). Null = not recorded. Formative: what was practised, never competence.';

comment on table individual_scholar_attempt_snapshot is
  'SCHOLAR-CONTINUITY-01 (791), SQIE-CLOSE-2026-11 (990). What one attempt was assessed against, at the time: the question as presented (order and original indexes), the answer, the key, the rubric and its hash, the result, and (990) the framework version of each competency practised. An understanding check kept without a mark is marking unmarked. Immutable. Formative, never competence.';

notify pgrst, 'reload schema';
