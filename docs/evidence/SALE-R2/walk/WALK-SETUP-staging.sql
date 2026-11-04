-- SALE-R2 staging walk setup (STAGING ONLY, fixture learner only). APPLY THIS FILE WHOLE (it holds a DO block).
-- Reversed by WALK-TEARDOWN-staging.sql. The fixture learner is identified by one of their own attempts (no email in this file).
--   1. HQ policy on staging: scholar_retrieval_schedule, scholar_prerequisite_suggestions, scholar_transfer_checks = on.
--   2. The fixture chooses programme nursing-ug-diploma (Competen Foundational + Nursing: Respiratory Care, both published and allowlisted).
--   3. Two SYNTHETIC accepted section links, made for the walk and labelled so: a section of the Quality Improvement notes (the topic with
--      many different missed questions) to "Assess oxygen requirement", and an unanswered section of the critical-care notes to its
--      framework prerequisite "Performs a systematic respiratory assessment" (Holdings-scope competency_dependencies, staging).
do $$
declare
  uid uuid := (select user_id from individual_scholar_attempt where id = '36a3468f-a192-4fba-bd9f-5e1ceb6ce473');
  qi uuid := '404b9a70-143d-4384-b3e6-11b50c53a1ed';
  enc uuid := '5327bda5-add2-4dfd-86c3-b9bec6eca907';
  chunk_b uuid;
  m uuid;
begin
  if uid is null then raise exception 'fixture learner not found'; end if;
  delete from workspace_config_overrides where scope_type = 'platform' and scope_ref = 'individual'
    and config_path in ('individual.policy.scholar_retrieval_schedule', 'individual.policy.scholar_prerequisite_suggestions', 'individual.policy.scholar_transfer_checks');
  insert into workspace_config_overrides (scope_type, scope_ref, config_path, draft, published, updated_by_name)
  values ('platform', 'individual', 'individual.policy.scholar_retrieval_schedule', '{"value":"on"}', '{"value":"on"}', 'SALE-R2 staging walk'),
         ('platform', 'individual', 'individual.policy.scholar_prerequisite_suggestions', '{"value":"on"}', '{"value":"on"}', 'SALE-R2 staging walk'),
         ('platform', 'individual', 'individual.policy.scholar_transfer_checks', '{"value":"on"}', '{"value":"on"}', 'SALE-R2 staging walk');

  insert into individual_scholar_learner (user_id, programme_code) values (uid, 'nursing-ug-diploma') on conflict (user_id) do nothing;

  if not exists (select 1 from individual_scholar_competency_map where user_id = uid and rationale = 'SALE-R2 walk fixture') then
    insert into individual_scholar_competency_map (user_id, material_id, chunk_id, competency_id, layer, source, rationale)
    values (uid, qi, 'edfcf377-a425-4c5e-b67f-c78cd5f5121f', '39e76f07-a767-4939-8624-3a14c9f54cd6', 'profession', 'student', 'SALE-R2 walk fixture')
    returning id into m;
    insert into individual_scholar_competency_decision (user_id, map_id, decision, decided_by) values (uid, m, 'accepted', 'student');

    select c.id into chunk_b from individual_scholar_chunk c
     where c.user_id = uid and c.material_id = enc
       and not exists (select 1 from individual_scholar_question q where q.chunk_id = c.id)
       and not exists (select 1 from individual_scholar_learning_event_source s where s.chunk_id = c.id)
     order by c.ordinal limit 1;
    if chunk_b is null then raise exception 'no unanswered critical-care section'; end if;
    insert into individual_scholar_competency_map (user_id, material_id, chunk_id, competency_id, layer, source, rationale)
    values (uid, enc, chunk_b, 'de1e82e2-6da3-4ea8-97fe-f67f55075aa8', 'profession', 'student', 'SALE-R2 walk fixture')
    returning id into m;
    insert into individual_scholar_competency_decision (user_id, map_id, decision, decided_by) values (uid, m, 'accepted', 'student');
  end if;
end $$;
