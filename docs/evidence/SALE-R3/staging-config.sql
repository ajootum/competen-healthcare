-- SALE-2026-11 R3 STAGING configuration for the walk (ezhvpgtcqcdsgylrxgdb only). Never applied by an agent to production:
-- in production both keys stay at their code default (off) until the owner publishes them in HQ.
insert into workspace_config_overrides (scope_type, scope_ref, config_path, draft, published)
select 'platform', 'individual', k.path, '{"value":"on"}'::jsonb, '{"value":"on"}'::jsonb
  from (values ('individual.policy.scholar_next_best_action'), ('individual.policy.scholar_active_notebook')) as k(path)
 where not exists (select 1 from workspace_config_overrides w where w.scope_type = 'platform' and w.scope_ref = 'individual' and w.config_path = k.path);
update workspace_config_overrides set published = '{"value":"on"}'::jsonb, draft = '{"value":"on"}'::jsonb, updated_at = now()
 where scope_type = 'platform' and scope_ref = 'individual' and config_path in ('individual.policy.scholar_next_best_action', 'individual.policy.scholar_active_notebook');
select config_path, published from workspace_config_overrides where scope_type = 'platform' and scope_ref = 'individual' and config_path in ('individual.policy.scholar_next_best_action', 'individual.policy.scholar_active_notebook', 'individual.policy.scholar_my_plan', 'individual.policy.scholar_learning_library', 'individual.policy.scholar_study_calendar');
