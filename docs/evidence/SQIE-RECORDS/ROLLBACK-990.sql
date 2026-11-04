-- ROLLBACK-990: restore the 791 snapshot shape CHECK and remove competency_provenance (SQIE-CLOSE-2026-11 WS-D).
-- APPLY THIS FILE WHOLE (it holds a DO block).
-- Refuses while any unmarked snapshot or any recorded provenance exists: the first would violate the restored 791 rule,
-- the second would be lost. Removing them is an owner decision made by hand, never here (a snapshot is immutable and is
-- removed only with its attempt).
do $$
begin
  if exists (select 1 from individual_scholar_attempt_snapshot where marking = 'unmarked') then
    raise exception 'ROLLBACK-990 refused: unmarked snapshots exist';
  end if;
  if exists (select 1 from individual_scholar_attempt_snapshot where competency_provenance is not null) then
    raise exception 'ROLLBACK-990 refused: snapshots with recorded competency provenance exist';
  end if;
end $$;
alter table individual_scholar_attempt_snapshot drop constraint if exists individual_scholar_attempt_snapshot_provenance_check;
alter table individual_scholar_attempt_snapshot drop column if exists competency_provenance;
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
     and marking in ('deterministic', 'self_graded', 'ai_evaluation')
     and cardinality(competency_ids) <= 20);
notify pgrst, 'reload schema';
