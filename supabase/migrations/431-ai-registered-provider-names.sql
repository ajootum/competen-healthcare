-- ====================================================================================================
-- MIGRATION 431: AI PROVIDER NAMES -- A REGISTERED PROVIDER CAN BE PRICED, EVALUATED AND MADE ELIGIBLE
--
-- COMPETEN HOLDINGS -- NO-CODE AI PROVIDER EXTENSIBILITY (owner, 25 October 2026). Coordinator range 430-434.
-- Depends on 410 (ai_price), 411 (ai_model_eligibility) and 419 (ai_model_evaluation_result, ai_model_evaluation_proposal).
--
-- APPLY ON STAGING FIRST. Changes four CHECK constraints on existing tables and nothing else: no row, column,
-- index, policy, grant, trigger or function changes. Re-running it is a no-op. OPS-001 s8: proposed Medium (a
-- constraint change on existing tables), so it carries a staging rollback rehearsal.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- Pricing, model eligibility and evaluation evidence named only the three built-in providers in a CHECK, so a provider
-- registered from HQ (src/lib/ai/provider-registry.ts) could never be priced -- every metered request on it would
-- fail closed as model_not_priced -- nor evaluated, nor made eligible for any clinical tier. This widens exactly that
-- one clause, from the fixed list to the provider-id shape the registry enforces: a lowercase letter, then lowercase
-- letters or digits, 2 to 31 characters. anthropic, openai and gemini still match it.
--
-- WHAT DOES NOT CHANGE. Every other clause of each constraint is restated exactly as it was. Eligibility still needs
-- evidence and a highest tier (411, 412). ai_reserve still refuses a clinical request on a model with no eligibility
-- row (412). Which providers may actually be called is still decided in the application by the published registry and
-- the host allowlist of the deployment. A name passing this CHECK sends nothing anywhere.
--
-- ai_usage_ledger.provider already has no list, so metered history is unaffected.
--
-- ATOMIC PER TABLE. Each constraint is dropped and re-added in ONE alter table statement, so a failure (or a
-- runner that splits on the statement separator) can never leave a table without its constraint.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No functions, so no APPLY WHOLE banner is required. No
-- partial unique index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/AI-FAIR-USE/ROLLBACK-431.sql restores the four original constraints. It refuses
-- (the CHECK cannot be re-added) while any row names a provider outside the original three, which is the safe
-- behaviour: such rows are removed first, by a person, or the rollback is not run.
-- ====================================================================================================

alter table ai_price drop constraint if exists ai_price_check,
  add constraint ai_price_check
  check (provider ~ '^[a-z][a-z0-9]{1,30}$' and btrim(model_prefix) <> ''
     and input_per_mtok_usd >= 0 and output_per_mtok_usd >= 0 and extra_per_request_usd >= 0
     and (effective_to is null or effective_to > effective_from)
     and (note is null or char_length(note) <= 500));

alter table ai_model_eligibility drop constraint if exists ai_model_eligibility_check,
  add constraint ai_model_eligibility_check
  check (product in ('scholar', 'professional') and activity ~ '^[a-z][a-z0-9_]{1,40}$'
     and provider ~ '^[a-z][a-z0-9]{1,30}$' and btrim(model_prefix) <> ''
     and (not eligible or (evidence_ref is not null and char_length(btrim(evidence_ref)) >= 5))
     and (evidence_ref is null or char_length(evidence_ref) <= 500) and (note is null or char_length(note) <= 500)
     and (effective_to is null or effective_to > effective_from));

alter table ai_model_evaluation_result drop constraint if exists ai_model_evaluation_result_check,
  add constraint ai_model_evaluation_result_check
  check (item_code ~ '^[a-z0-9][a-z0-9_.-]{1,60}$' and task ~ '^[a-z][a-z0-9_]{1,40}$'
     and risk_tier in ('standard_educational', 'clinical_educational', 'high_risk_clinical')
     and provider ~ '^[a-z][a-z0-9]{1,30}$' and btrim(model_requested) <> ''
     and status in ('ok', 'refusal', 'error')
     and (input_tokens is null or input_tokens >= 0) and (output_tokens is null or output_tokens >= 0)
     and (cost_usd is null or cost_usd >= 0) and (latency_ms is null or latency_ms >= 0)
     and (output is null or char_length(output) <= 40000) and (score is null or (score >= 0 and score <= 1)));

alter table ai_model_evaluation_proposal drop constraint if exists ai_model_evaluation_proposal_check,
  add constraint ai_model_evaluation_proposal_check
  check (product in ('scholar', 'professional') and activity ~ '^[a-z][a-z0-9_]{1,40}$'
     and provider ~ '^[a-z][a-z0-9]{1,30}$' and btrim(model_prefix) <> ''
     and (proposed_max_risk_tier is null or proposed_max_risk_tier in ('standard_educational', 'clinical_educational', 'high_risk_clinical'))
     and char_length(btrim(rationale)) between 5 and 2000);


-- Verification: the four constraints, now naming the provider-id shape and no fixed list.
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) like '%provider ~%' as widened
  from pg_constraint
 where conname in ('ai_price_check', 'ai_model_eligibility_check', 'ai_model_evaluation_result_check', 'ai_model_evaluation_proposal_check')
 order by conname;

notify pgrst, 'reload schema';
