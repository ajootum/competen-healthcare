-- ====================================================================================================
-- ROLLBACK 431 (staging): restore the four original provider CHECK constraints from 410, 411 and 419, byte for byte.
--
-- It REFUSES while any row names a provider outside anthropic, openai and gemini (the CHECK cannot be re-added), which is
-- the safe behaviour. Each table is ONE statement (drop and add together), so a refusal leaves that table exactly as
-- 431 left it, never without a constraint. A person removes such rows first, knowingly, or the rollback is not run.
-- ====================================================================================================

alter table ai_price drop constraint if exists ai_price_check,
  add constraint ai_price_check
  check (provider in ('anthropic', 'openai', 'gemini') and btrim(model_prefix) <> ''
     and input_per_mtok_usd >= 0 and output_per_mtok_usd >= 0 and extra_per_request_usd >= 0
     and (effective_to is null or effective_to > effective_from)
     and (note is null or char_length(note) <= 500));

alter table ai_model_eligibility drop constraint if exists ai_model_eligibility_check,
  add constraint ai_model_eligibility_check
  check (product in ('scholar', 'professional') and activity ~ '^[a-z][a-z0-9_]{1,40}$'
     and provider in ('anthropic', 'openai', 'gemini') and btrim(model_prefix) <> ''
     and (not eligible or (evidence_ref is not null and char_length(btrim(evidence_ref)) >= 5))
     and (evidence_ref is null or char_length(evidence_ref) <= 500) and (note is null or char_length(note) <= 500)
     and (effective_to is null or effective_to > effective_from));

alter table ai_model_evaluation_result drop constraint if exists ai_model_evaluation_result_check,
  add constraint ai_model_evaluation_result_check
  check (item_code ~ '^[a-z0-9][a-z0-9_.-]{1,60}$' and task ~ '^[a-z][a-z0-9_]{1,40}$'
     and risk_tier in ('standard_educational', 'clinical_educational', 'high_risk_clinical')
     and provider in ('anthropic', 'openai', 'gemini') and btrim(model_requested) <> ''
     and status in ('ok', 'refusal', 'error')
     and (input_tokens is null or input_tokens >= 0) and (output_tokens is null or output_tokens >= 0)
     and (cost_usd is null or cost_usd >= 0) and (latency_ms is null or latency_ms >= 0)
     and (output is null or char_length(output) <= 40000) and (score is null or (score >= 0 and score <= 1)));

alter table ai_model_evaluation_proposal drop constraint if exists ai_model_evaluation_proposal_check,
  add constraint ai_model_evaluation_proposal_check
  check (product in ('scholar', 'professional') and activity ~ '^[a-z][a-z0-9_]{1,40}$'
     and provider in ('anthropic', 'openai', 'gemini') and btrim(model_prefix) <> ''
     and (proposed_max_risk_tier is null or proposed_max_risk_tier in ('standard_educational', 'clinical_educational', 'high_risk_clinical'))
     and char_length(btrim(rationale)) between 5 and 2000);

notify pgrst, 'reload schema';
