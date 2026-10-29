-- ROLLBACK 660 (STAGING REHEARSAL ONLY). APPLY THIS FILE WHOLE.
-- Removes everything 660 added. Programme overlays, component requirements, stage mappings and NUR-FOUND
-- entries made after 660 are lost. No pre-660 row is touched.
drop trigger if exists competency_stage_mapping_guard on competency_stage_mapping;
drop trigger if exists competency_stage_mapping_band_guard on competency_stage_mapping_band;
drop trigger if exists competency_catalogue_entry_component_guard on competency_catalogue_entry_component;
drop trigger if exists individual_scholar_programme_qualification_guard on individual_scholar_programme;
drop table if exists competency_stage_mapping_band;
drop table if exists competency_stage_mapping;
drop table if exists competency_stage;
drop table if exists competency_catalogue_entry_component;
drop table if exists competency_assessment_component;
drop function if exists public.competency_stage_mapping_guard();
drop function if exists public.competency_stage_mapping_band_guard();
drop function if exists public.competency_catalogue_entry_component_guard();
drop function if exists public.individual_scholar_programme_qualification_guard();
-- NUR-FOUND is a draft, so the 394 trigger allows its entries to go (they cascade with the framework).
delete from frameworks where code = 'NUR-FOUND' and hospital_id is null and pub_status = 'draft';
alter table competency_catalogue_entry drop constraint if exists competency_catalogue_entry_requirement_check;
alter table competency_catalogue_entry drop column if exists expected_level_id;
alter table competency_catalogue_entry drop column if exists requirement;
drop index if exists idx_individual_scholar_programme_qualification;
alter table individual_scholar_programme drop column if exists qualification_term_id;
delete from scoring_levels where scale_id in (select id from scoring_scales where name = 'DACUM 0-6');
delete from scoring_scales where name = 'DACUM 0-6';
delete from taxonomy_terms where taxonomy_id in (select id from taxonomies where kind = 'qualification_level');
delete from taxonomies where kind = 'qualification_level';
notify pgrst, 'reload schema';
