-- SALE-R2 staging walk teardown (STAGING ONLY): reverses WALK-SETUP-staging.sql. The R2 policy keys return to their code default (off),
-- the fixture's programme choice is removed, and the two synthetic section links are deleted (their decisions go with them by cascade).
-- The transfer check the walk recorded (970 rows, its revision session and answers) is the learner's own record and is kept.
delete from workspace_config_overrides where scope_type = 'platform' and scope_ref = 'individual'
  and config_path in ('individual.policy.scholar_retrieval_schedule', 'individual.policy.scholar_prerequisite_suggestions', 'individual.policy.scholar_transfer_checks');
delete from individual_scholar_competency_map where rationale = 'SALE-R2 walk fixture';
delete from individual_scholar_learner where user_id = (select user_id from individual_scholar_attempt where id = '36a3468f-a192-4fba-bd9f-5e1ceb6ce473') and programme_code = 'nursing-ug-diploma';
