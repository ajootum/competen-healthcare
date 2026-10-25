-- ROLLBACK 443 (STAGING ONLY): CKRI K4 research and publication workspace.
-- Drops the seven tables, the extra trigger on ckri_research_project (the 440 guard itself is untouched), the
-- functions, the reviewer position, its grants and the capability. Workspace records made on staging are lost.
-- Snapshot retention dates extended by an approved dataset stay extended (they only ever move later).

drop table if exists ckri_publication_event cascade;
drop table if exists ckri_publication cascade;
drop table if exists ckri_research_review cascade;
drop table if exists ckri_research_output cascade;
drop table if exists ckri_research_dataset cascade;
drop table if exists ckri_research_document cascade;
drop table if exists ckri_research_member cascade;

drop trigger if exists ckri_research_project_k4_guard on ckri_research_project;

drop function if exists public.ckri_publication_event_guard();
drop function if exists public.ckri_publication_correct(uuid, uuid, text);
drop function if exists public.ckri_publication_record();
drop function if exists public.ckri_publication_guard();
drop function if exists public.ckri_research_review_guard();
drop function if exists public.ckri_research_output_guard();
drop function if exists public.ckri_research_dataset_guard();
drop function if exists public.ckri_research_project_k4_guard();
drop function if exists public.ckri_research_document_guard();
drop function if exists public.ckri_research_member_guard();
drop function if exists public.ckri_on_team(uuid, uuid, text[]);
drop function if exists public.ckri_keys_present(jsonb, text[]);

delete from hq_position_capability where capability_code = 'hq.quality.research.review';
delete from hq_position_capability where position_code = 'research_scientific_reviewer';
delete from hq_position where code = 'research_scientific_reviewer' and not exists (select 1 from ogs_office_appointments a where a.role = hq_position.code);
delete from hq_capability where code = 'hq.quality.research.review';

notify pgrst, 'reload schema';
