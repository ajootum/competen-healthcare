-- ROLLBACK 520 (STAGING ONLY). COMPETEN-PROFESSIONAL-COMPETENCY-01, Professional Stage 5.
-- Removes what 520 added: the Passport competency selection, the evidence links, the self-assessments, the
-- competency history and my competencies (and every row in them), the three trigger functions, the
-- (id, user_id) index on individual_scholar_passport_item, and the evidence type columns and CHECK on
-- individual_professional_evidence. The 393 (id, user_id) indexes on the CPD and evidence tables belong to 393
-- and are left in place. Evidence titles, documents and classes are untouched. Plain statements only.

drop table if exists individual_professional_share_competency;
drop table if exists individual_professional_competency_evidence;
drop table if exists individual_professional_self_assessment;
drop table if exists individual_professional_my_competency_history;
drop table if exists individual_professional_my_competency;
drop function if exists public.individual_professional_my_competency_history_write();
drop function if exists public.individual_professional_competency_evidence_guard();
drop function if exists public.individual_professional_stage5_append_only();
drop index if exists ux_individual_scholar_passport_item_id_user;

alter table individual_professional_evidence drop constraint if exists individual_professional_evidence_stage5_shape;
alter table individual_professional_evidence drop column if exists evidence_type_code;
alter table individual_professional_evidence drop column if exists evidence_type_label;
alter table individual_professional_evidence drop column if exists author_name;

notify pgrst, 'reload schema';
