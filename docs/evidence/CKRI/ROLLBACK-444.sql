-- ROLLBACK 444 (STAGING ONLY): CKRI governance enforcement.
-- Drops the six triggers, their functions, ckri_partner_agreement and the six added columns. 440 and 443, and their
-- own guards, are untouched. Agreements, exemptions and lawful bases recorded on staging are lost.
-- External appointments ended by an agreement ending stay ended.

drop trigger if exists ckri_research_dataset_ethics_guard on ckri_research_dataset;
drop trigger if exists ckri_research_project_ethics_guard on ckri_research_project;
drop trigger if exists ckri_research_member_agreement_guard on ckri_research_member;
drop trigger if exists ckri_purpose_basis_guard on ckri_purpose;
drop table if exists ckri_partner_agreement cascade;

drop function if exists public.ckri_research_dataset_ethics_guard();
drop function if exists public.ckri_research_project_ethics_guard();
drop function if exists public.ckri_research_member_agreement_guard();
drop function if exists public.ckri_expire_agreements();
drop function if exists public.ckri_partner_agreement_end();
drop function if exists public.ckri_partner_agreement_guard();
drop function if exists public.ckri_agreement_covers(text, uuid);
drop function if exists public.ckri_purpose_basis_guard();

alter table ckri_research_project drop constraint if exists ckri_research_project_exemption_check;
alter table ckri_research_project drop column if exists ethics_exemption_at;
alter table ckri_research_project drop column if exists ethics_exemption_by;
alter table ckri_research_project drop column if exists ethics_exemption_basis;
alter table ckri_research_project drop column if exists ethics_exemption_ref;
alter table ckri_purpose drop constraint if exists ckri_purpose_basis_check;
alter table ckri_purpose drop column if exists basis_decision_ref;
alter table ckri_purpose drop column if exists lawful_basis;

notify pgrst, 'reload schema';
