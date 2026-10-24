-- ====================================================================================================
-- APPLY THIS FILE WHOLE.
-- ====================================================================================================
-- ROLLBACK 419 (STAGING ONLY). Drops the model-evaluation evidence tables and their guards. Evaluation results
-- recorded on staging are lost. Run it whole.
drop table if exists ai_model_evaluation_proposal;
drop table if exists ai_model_evaluation_result;
drop table if exists ai_model_evaluation_run;
drop function if exists public.ai_model_evaluation_evidence_guard();
drop function if exists public.ai_model_evaluation_run_guard();
notify pgrst, 'reload schema';
