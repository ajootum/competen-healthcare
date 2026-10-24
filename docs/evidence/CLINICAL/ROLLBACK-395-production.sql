-- ROLLBACK 395 (PRODUCTION). The same statements rehearsed on staging (ROLLBACK-395.sql, b8503d33).
-- Use only if the 395 runbook step 4 verification fails. Removes the clinical-content approval tables,
-- functions, triggers, frameworks.specialty_term_id, the two capabilities, the reviewer position and
-- their grants. Run it whole in the production SQL editor, by the owner.
drop trigger if exists clinical_review_decision_guard on clinical_review_decision;
drop trigger if exists clinical_content_version_guard on clinical_content_version;
drop trigger if exists clinical_reviewer_scope_guard on clinical_reviewer_scope;
drop table if exists clinical_review_decision;
drop table if exists clinical_reviewer_scope;
drop table if exists clinical_content_version;
drop function if exists public.clinical_review_decision_guard();
drop function if exists public.clinical_content_version_guard();
drop function if exists public.clinical_reviewer_scope_guard();
drop function if exists public.clinical_scope_covers(uuid, uuid);
drop function if exists public.competency_content_hashes(uuid[]);
drop function if exists public.competency_content_hash(uuid);
delete from hq_position_capability where capability_code in ('hq.quality.clinical.approve', 'hq.quality.clinical.govern')
   or (position_code = 'clinical_content_reviewer' and capability_code = 'hq.platform.home.view');
delete from hq_position where code = 'clinical_content_reviewer' and not exists (select 1 from ogs_office_appointments a where a.role = 'clinical_content_reviewer');
delete from hq_capability where code in ('hq.quality.clinical.approve', 'hq.quality.clinical.govern');
alter table frameworks drop column if exists specialty_term_id;
notify pgrst, 'reload schema';
