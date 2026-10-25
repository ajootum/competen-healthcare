-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql and sql functions between dollar quotes. A runner that splits on the
-- statement separator would cut them in half, so paste and run the entire file at once.
-- ====================================================================================================
-- ROLLBACK OF MIGRATION 430 (the portable clinical content hash and the reviewed-copy route). STAGING ONLY.
--
-- It restores the competency_content_hash function of 395 BYTE FOR BYTE (generated from the 395 file) and drops the
-- provenance columns, their checks and the two import functions.
--
-- It REFUSES, changing nothing, once any version or decision carries provenance: removing it would erase where an
-- approval came from.
-- ====================================================================================================

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'clinical_content_version' and column_name = 'provenance') then
    if exists (select 1 from clinical_content_version where provenance is not null) or exists (select 1 from clinical_review_decision where provenance is not null) then
      raise exception 'ROLLBACK-430 refused: a version or decision carries provenance';
    end if;
  end if;
end $$;

create or replace function public.competency_content_hash(p_competency uuid)
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select md5(jsonb_build_object(
    'name', c.name,
    'description', c.description,
    'learning_outcomes', c.learning_outcomes,
    'expected_level_id', c.expected_level_id,
    'practice_id', c.practice_id,
    'cpu_id', c.cpu_id,
    'risk_category', c.risk_category,
    'skills', coalesce((select jsonb_agg(s.name order by s.name, s.id) from competency_skills s where s.competency_id = c.id), '[]'::jsonb)
  )::text)
  from framework_competencies c
  where c.id = p_competency
$$;

drop function if exists public.clinical_review_import(uuid, uuid, uuid, text, text, jsonb);
drop function if exists public.clinical_version_import(uuid, uuid, uuid[], uuid, int, text, jsonb);
alter table clinical_review_decision drop constraint if exists clinical_review_decision_provenance_check;
alter table clinical_content_version drop constraint if exists clinical_content_version_provenance_check;
alter table clinical_review_decision drop column if exists provenance;
alter table clinical_content_version drop column if exists provenance;

notify pgrst, 'reload schema';
