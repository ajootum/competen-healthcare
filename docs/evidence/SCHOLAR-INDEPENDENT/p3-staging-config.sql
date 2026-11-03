-- SCHOLAR-INDEPENDENT-LEARNING-01 P3: STAGING configuration for the measurement (ezhvpgtcqcdsgylrxgdb only).
-- The same three changes are the production configuration the owner decides on (PR body): never applied by an agent to production.
-- 1. The fair-use policy defines the flashcards activity (cheap tier, standard educational floor, 1800 output tokens).
update workspace_config_overrides
   set published = jsonb_set(published::jsonb, '{activities,flashcards}',
       '{"label":"Flashcards","class":"standard","tier":"cheap","minTier":"cheap","maxOutputTokens":1800,"capPerPeriod":null,"riskFloor":"standard_educational","reserveEligible":false}'::jsonb, true),
       updated_at = now()
 where scope_type = 'platform' and scope_ref = 'ai_fair_use' and config_path = 'ai.fair_use.scholar';
-- 2. Model routing: scholar.flashcards runs on the cheap model first, then the reasoning model, then the heavy one (each only where eligible).
update workspace_config_overrides
   set published = jsonb_set(published::jsonb, '{activities,scholar.flashcards}',
       '[{"provider":"anthropic","model":"claude-haiku-4-5-20251001"},{"provider":"anthropic","model":"claude-sonnet-4-6"},{"provider":"anthropic","model":"claude-opus-4-8"}]'::jsonb, true),
       updated_at = now()
 where scope_type = 'platform' and scope_ref = 'ai_fair_use' and config_path = 'ai.model_routing';
-- 3. Eligibility for the flashcards activity: Sonnet and Opus at clinical educational (as teach, explain and summary already are), Haiku at standard educational only.
insert into ai_model_eligibility (product, activity, provider, model_prefix, eligible, max_risk_tier, note, evidence_ref, effective_from)
select 'scholar', 'flashcards', 'anthropic', m.prefix, true, m.max_risk, 'SCHOLAR-INDEPENDENT-LEARNING-01 P3 staging measurement', 'STAGING ONLY: P3 measurement rows, no model evaluation decision, never for production', now()
  from (values ('claude-haiku-4-5', 'standard_educational'), ('claude-sonnet-4-6', 'clinical_educational'), ('claude-opus-4-8', 'clinical_educational')) as m(prefix, max_risk)
 where not exists (select 1 from ai_model_eligibility e where e.product = 'scholar' and e.activity = 'flashcards' and e.provider = 'anthropic' and e.model_prefix = m.prefix);
