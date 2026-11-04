-- ====================================================================================================
-- MIGRATION 990: COMPETEN SCHOLAR -- EVERY KEPT ANSWER HAS ITS SNAPSHOT, AND A SNAPSHOT PINS ITS COMPETENCY
-- (SALE-2026-11 / SQIE-CLOSE-2026-11 workstream WS-D, SQIE-04, SQIE-07, SQIE-08)
--
-- Owner directive SALE-2026-11 (4 Nov 2026) approved the SQIE workstreams. WS-D closes two gaps in the 791 snapshot.
--
-- 1. AN UNMARKED CHECK ANSWER. 950 lets an understanding check be kept without a judgement (416 marking unmarked, no
--    score, never correct). 791 allows only deterministic, self_graded and ai_evaluation, and only the outcomes
--    correct, partial and incorrect, so such an answer could keep no snapshot. The 791 shape rule is re-added with
--    marking unmarked and outcome unmarked, bound together: an unmarked snapshot has the unmarked outcome and no
--    score, and no other marking may carry that outcome. Every other part of the 791 rule is unchanged.
--
-- 2. FRAMEWORK PROVENANCE. A snapshot keeps competency_ids only, and framework_competencies rows are edited in place
--    (751), so an id does not pin what the competency said when the answer was given. competency_provenance (jsonb,
--    null on every snapshot kept before this migration) holds, per competency id and in the same order, the id, the
--    competency_content_hash (395, 670, 761 -- 32 hex) at answer time, the framework id and its version label
--    (frameworks.version_major.minor.revision, 012). A part the server could not read is null, never guessed. The CHECK
--    makes any other shape unrepresentable: an array as long as competency_ids, its ids equal to competency_ids in
--    order, each element carrying exactly these four keys in these forms, at most 4096 bytes.
--
-- NO BACKFILL. A 791 snapshot is immutable, and nothing here writes or rewrites a row. Snapshots kept before 990 keep
-- a null competency_provenance, which reads as not recorded.
--
-- FAIL CLOSED WITHOUT IT. The server sends competency_provenance only while the column exists. A missing column is
-- answered by keeping a revision snapshot exactly as before (without provenance), and by keeping NO snapshot of an
-- understanding check (what happens today). The answer is recorded either way and nothing is said to the learner.
--
-- FORMATIVE. A snapshot is a record of a private practice attempt, never competence, a stage, an assessment outcome
-- for a regulator, or a Passport record. The provenance says which competency text a practice question was mapped
-- to, nothing more.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Depends on 791 (the snapshot
-- table), 950 (unmarked attempts), 395 and 761 (competency_content_hash), 012 (framework version columns).
-- Re-running it is a no-op. Rollback: docs/evidence/SQIE-WS-D/ROLLBACK-990.sql (refuses while any unmarked snapshot
-- or any snapshot with provenance exists).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. notify pgrst last.
-- ====================================================================================================

-- ---- 1. THE PROVENANCE COLUMN -----------------------------------------------------------------------
alter table individual_scholar_attempt_snapshot add column if not exists competency_provenance jsonb;

-- ---- 2. THE 791 SHAPE RULE, WITH THE UNMARKED CHECK ANSWER ------------------------------------------
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
     and outcome in ('correct', 'partial', 'incorrect', 'unmarked')
     and marking in ('deterministic', 'self_graded', 'ai_evaluation', 'unmarked')
     and ((marking = 'unmarked') = (outcome = 'unmarked'))
     and (marking <> 'unmarked' or score is null)
     and cardinality(competency_ids) <= 20);

-- ---- 3. THE PROVENANCE SHAPE --------------------------------------------------------------------------
alter table individual_scholar_attempt_snapshot drop constraint if exists individual_scholar_attempt_snapshot_provenance_check;
alter table individual_scholar_attempt_snapshot add constraint individual_scholar_attempt_snapshot_provenance_check
  check (competency_provenance is null
      or (jsonb_typeof(competency_provenance) = 'array'
      and octet_length(competency_provenance::text) <= 4096
      and jsonb_array_length(competency_provenance) = cardinality(competency_ids)
      and jsonb_path_query_array(competency_provenance, '$[*].id') = array_to_json(competency_ids)::jsonb
      and jsonb_array_length(competency_provenance) = jsonb_array_length(jsonb_path_query_array(competency_provenance,
            '$[*] ? (@.type() == "object"
                     && !exists(@.keyvalue() ? (!(@.key == "id" || @.key == "content_hash" || @.key == "framework_id" || @.key == "framework_version")))
                     && @.id like_regex "^[0-9a-f-]{36}$"
                     && (@.content_hash == null || @.content_hash like_regex "^[0-9a-f]{32}$")
                     && (@.framework_id == null || @.framework_id like_regex "^[0-9a-f-]{36}$")
                     && (@.framework_version == null || @.framework_version like_regex "^[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,4}$"))'))));

comment on column individual_scholar_attempt_snapshot.competency_provenance is
  'SQIE WS-D (990). Per competency_ids entry, in order: {id, content_hash (competency_content_hash at answer time), framework_id, framework_version (major.minor.revision)}. A part not readable at the time is null. Null on snapshots kept before 990. Formative: which competency text a practice question was mapped to, never competence.';
comment on column individual_scholar_attempt_snapshot.outcome is
  'SCHOLAR-CONTINUITY-01 (791), SQIE WS-D (990). correct, partial, incorrect, or unmarked (an understanding check kept without a judgement, marking unmarked, no score).';

notify pgrst, 'reload schema';
