-- ====================================================================================================
-- MIGRATION 991: COMPETEN SCHOLAR -- A SNAPSHOT SAYS WHETHER ITS COMPETENCY MAPPING IS PUBLISHED, AND ITS OBJECTIVE
-- (SQIE-CLOSE-2026-11 workstream WS-D, owner decisions 4 Nov 2026 item 3, SQIE-07)
--
-- Owner decision 3 (4 Nov 2026): map questions to the published nursing framework version, competency and learning
-- objective, store that provenance with learner attempts, permit draft mappings where publication is pending, and
-- never represent a draft mapping as validated competency evidence.
--
-- WHY. 990 keeps, per competency a snapshot names, its content hash, its framework and that framework version. It does
-- not say whether that framework version was PUBLISHED when the answer was given (frameworks.pub_status, 127), so a
-- mapping to a draft framework could not be told apart from a mapping to a published one, and it does not keep the
-- learning objective the question tested. The 990 CHECK names exactly four keys per element, so neither can be kept.
--
-- WHAT IT CHANGES. Only the 990 provenance CHECK, recreated with two more OPTIONAL keys per element:
--   mapping_status  published (the framework was published at answer time) or draft (publication pending: never
--                   validated competency evidence), or null where it could not be read.
--   objective       the learning objective the question tested (its rubric objective), a string or null.
-- Every 990 rule is kept: an array as long as competency_ids with the same ids in order, the four 990 keys in their
-- forms, at most 4096 bytes. No other key is allowed. No row is written or rewritten (a snapshot is immutable).
--
-- FAIL CLOSED WITHOUT IT. Where 991 is absent the 990 CHECK refuses an element with the new keys. The store then keeps
-- the snapshot with the four 990 keys only and remembers it. Where 990 is absent too, the 990 fallback applies.
--
-- FORMATIVE. A mapping status says whether the framework version a practice question was mapped to was published. A
-- published mapping is still learning evidence only: never verified competence, a stage or a Passport record.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Depends on 990. Re-running it is a
-- no-op. Rollback: docs/evidence/SQIE-RECORDS/ROLLBACK-991.sql (refuses while any element carries a 991 key).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. notify pgrst last.
-- ====================================================================================================

alter table individual_scholar_attempt_snapshot drop constraint if exists individual_scholar_attempt_snapshot_provenance_check;
alter table individual_scholar_attempt_snapshot add constraint individual_scholar_attempt_snapshot_provenance_check
  check (competency_provenance is null
      or (jsonb_typeof(competency_provenance) = 'array'
      and octet_length(competency_provenance::text) <= 4096
      and jsonb_array_length(competency_provenance) = cardinality(competency_ids)
      and jsonb_path_query_array(competency_provenance, '$[*].id') = array_to_json(competency_ids)::jsonb
      and jsonb_array_length(competency_provenance) = jsonb_array_length(jsonb_path_query_array(competency_provenance,
            '$[*] ? (@.type() == "object"
                     && !exists(@.keyvalue() ? (!(@.key == "id" || @.key == "content_hash" || @.key == "framework_id" || @.key == "framework_version" || @.key == "mapping_status" || @.key == "objective")))
                     && @.id like_regex "^[0-9a-f-]{36}$"
                     && (@.content_hash == null || @.content_hash like_regex "^[0-9a-f]{32}$")
                     && (@.framework_id == null || @.framework_id like_regex "^[0-9a-f-]{36}$")
                     && (@.framework_version == null || @.framework_version like_regex "^[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,4}$")
                     && (!exists(@.mapping_status) || @.mapping_status == null || @.mapping_status == "published" || @.mapping_status == "draft")
                     && (!exists(@.objective) || @.objective == null || @.objective.type() == "string"))'))));

comment on column individual_scholar_attempt_snapshot.competency_provenance is
  'SQIE WS-D (990, 991). Per competency_ids entry, in order: {id, content_hash (competency_content_hash at answer time), framework_id, framework_version (major.minor.revision), mapping_status (991: published, or draft = publication pending, never validated evidence), objective (991: the learning objective tested)}. A part not readable at the time is null. Null on snapshots kept before 990. Formative, never competence.';

notify pgrst, 'reload schema';
