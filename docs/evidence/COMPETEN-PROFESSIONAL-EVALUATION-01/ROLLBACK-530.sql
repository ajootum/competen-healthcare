-- ROLLBACK 530 (STAGING ONLY). COMPETEN-PROFESSIONAL-EVALUATION-01, Professional Stage 6.
-- Removes what 530 added: the Passport evaluation selection, the recommendation decisions, the annotations
-- and the evaluation snapshots (and every row in them), and the append-only function. The 453 index
-- ux_individual_professional_share_token_user belongs to 453 and is left in place. No Stage 1 to 5,
-- Learning or C5 table is touched. Plain statements only.

drop table if exists individual_professional_share_evaluation;
drop table if exists individual_professional_evaluation_decision;
drop table if exists individual_professional_evaluation_annotation;
drop table if exists individual_professional_evaluation;
drop function if exists public.individual_professional_stage6_append_only();

notify pgrst, 'reload schema';
