-- COMPETEN-NOTEBOOK-001 STAGING configuration for the walk (ezhvpgtcqcdsgylrxgdb only). Never applied by an agent to production:
-- in production the key stays at its code default (off) until the owner publishes it in HQ.
insert into workspace_config_overrides (scope_type, scope_ref, config_path, draft, published)
select 'platform', 'individual', 'individual.policy.scholar_personal_notebook', '{"value":"on"}'::jsonb, '{"value":"on"}'::jsonb
 where not exists (select 1 from workspace_config_overrides w where w.scope_type = 'platform' and w.scope_ref = 'individual' and w.config_path = 'individual.policy.scholar_personal_notebook');
update workspace_config_overrides set published = '{"value":"on"}'::jsonb, draft = '{"value":"on"}'::jsonb, updated_at = now()
 where scope_type = 'platform' and scope_ref = 'individual' and config_path = 'individual.policy.scholar_personal_notebook';
