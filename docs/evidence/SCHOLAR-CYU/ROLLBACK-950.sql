-- ROLLBACK-950: remove the check-attempt link, the question version and the 'unmarked' marking (LEARNING-CLOSE-2026-11 D01).
-- APPLY THIS FILE WHOLE (it holds a DO block).
-- Refuses while any unmarked attempt or any event that references an attempt exists: those rows would violate the
-- restored rules. Remove them first by hand if the owner decides to, never here.
do $$
begin
  if exists (select 1 from individual_scholar_attempt where marking = 'unmarked') then
    raise exception 'ROLLBACK-950 refused: unmarked attempts exist';
  end if;
  if exists (select 1 from individual_scholar_learning_event where attempt_id is not null) then
    raise exception 'ROLLBACK-950 refused: events reference attempts';
  end if;
end $$;
alter table individual_scholar_learning_event drop constraint if exists individual_scholar_learning_event_attempt_fk;
drop index if exists idx_individual_scholar_learning_event_attempt;
alter table individual_scholar_learning_event drop column if exists attempt_id;
alter table individual_scholar_attempt drop constraint if exists individual_scholar_attempt_marking_check;
alter table individual_scholar_attempt add constraint individual_scholar_attempt_marking_check
  check (marking in ('deterministic', 'self_graded', 'ai_evaluation')
     and (score is null or (score >= 0 and score <= 1))
     and ((marking = 'ai_evaluation') = (evaluator_model is not null))
     and ((evaluator_model is null) = (evaluator_prompt_version is null))
     and (evaluator_model is null or char_length(evaluator_model) between 1 and 200)
     and (evaluator_prompt_version is null or char_length(evaluator_prompt_version) between 1 and 200));
alter table individual_scholar_attempt drop constraint if exists individual_scholar_attempt_content_version_check;
alter table individual_scholar_attempt drop column if exists content_version;
drop index if exists ux_individual_scholar_attempt_id_user;
notify pgrst, 'reload schema';
