-- ROLLBACK FOR MIGRATION 393 (Professional competency mapping). STAGING only, via run-staging-sql.mjs.
-- Drops only what 393 created. Mapping rows and decisions made on staging are lost.
drop table if exists individual_professional_competency_decision;
drop table if exists individual_professional_competency_map;
drop function if exists public.individual_professional_decision_append_only();
drop index if exists ux_individual_professional_evidence_id_user;
drop index if exists ux_individual_professional_cpd_id_user;

notify pgrst, 'reload schema';
