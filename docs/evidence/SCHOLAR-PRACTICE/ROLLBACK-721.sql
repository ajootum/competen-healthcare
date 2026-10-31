-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains a plpgsql block and a function between dollar quotes.
-- ====================================================================================================
-- ROLLBACK 721 (staging, or production only with an owner GO). Restores the 720 checklist, source and marking
-- CHECKs byte for byte, the 442 kind CHECK and the 442 ckri_knowledge_content_ok function byte for byte, and drops
-- the 721 trigger, function, CHECKs, indexes and columns. 720 itself stays.
--
-- IT REFUSES while any row uses what 721 added (dropping the columns would lose it):
--   a CKRI knowledge resource of kind osce_station, a governed station copy (source library),
--   a station with a checklist outside 6 to 14 items, a version other than 1, or any 721 definition field set,
--   an attempt with a snapshot, a station version, autosave time, gaps, revision suggestions, or status abandoned.
-- To roll back anyway, the owner first decides to remove them, then runs, in one transaction, before this file:
--   delete from individual_scholar_osce_station where source = 'library' or jsonb_array_length(checklist) not between 6 and 14
--   update individual_scholar_osce_station set profession = null, programme_code = null, programme_label = null, topic = null,
--     body_system = null, difficulty = null, learning_outcomes = null, objectives = null, expected_activities = null,
--     guidance = null, source_references = null, version = 1
--   update individual_scholar_osce_attempt set station_version = null, station_snapshot = null, last_saved_at = null,
--     gaps = null, revision_suggestions = null, status = case when finished_at is null then 'in_progress' else 'finished' end
--   and retires and removes any osce_station knowledge resource through the CKRI process.
-- ====================================================================================================

do $$
declare
  n_kind int;
  n_copy int;
  n_list int;
  n_def int;
  n_att int;
begin
  select count(*) into n_kind from ckri_knowledge_resource where kind = 'osce_station';
  select count(*) into n_copy from individual_scholar_osce_station where library_version_id is not null or source = 'library';
  select count(*) into n_list from individual_scholar_osce_station where jsonb_array_length(checklist) not between 6 and 14;
  select count(*) into n_def from individual_scholar_osce_station
   where version <> 1 or profession is not null or programme_code is not null or programme_label is not null or topic is not null
      or body_system is not null or difficulty is not null or learning_outcomes is not null or objectives is not null
      or expected_activities is not null or guidance is not null or source_references is not null;
  select count(*) into n_att from individual_scholar_osce_attempt
   where station_version is not null or station_snapshot is not null or last_saved_at is not null or gaps is not null
      or revision_suggestions is not null or status = 'abandoned';
  if n_kind + n_copy + n_list + n_def + n_att > 0 then
    raise exception 'ROLLBACK 721 refused: % osce_station resource(s), % governed copy(ies), % station(s) outside 6 to 14 items, % station(s) with 721 definition fields, % attempt(s) with 721 fields depend on 721. See the header of this file.', n_kind, n_copy, n_list, n_def, n_att;
  end if;
end;
$$;

drop trigger if exists individual_scholar_osce_station_library_guard on individual_scholar_osce_station;
drop function if exists public.individual_scholar_osce_station_library_guard();

create or replace function public.ckri_knowledge_content_ok(p_kind text, p jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case p_kind
    when 'explanation' then jsonb_typeof(p -> 'body') = 'string' and char_length(p ->> 'body') between 20 and 20000
    when 'targeted_resource' then jsonb_typeof(p -> 'body') = 'string' and char_length(p ->> 'body') between 20 and 20000
      and (p -> 'links' is null or (jsonb_typeof(p -> 'links') = 'array' and jsonb_array_length(p -> 'links') <= 20))
    when 'revision_question' then jsonb_typeof(p -> 'stem') = 'string' and char_length(p ->> 'stem') between 10 and 2000
      and jsonb_typeof(p -> 'options') = 'array' and jsonb_array_length(p -> 'options') = 4
      and jsonb_typeof(p -> 'correct_index') = 'number' and (p ->> 'correct_index')::int between 0 and 3
      and jsonb_typeof(p -> 'rationale') = 'string' and char_length(p ->> 'rationale') between 10 and 4000
    else false end
$$;

alter table ckri_knowledge_resource drop constraint if exists ckri_knowledge_resource_check;
alter table ckri_knowledge_resource add constraint ckri_knowledge_resource_check
  check (code ~ '^[a-z][a-z0-9_-]{2,60}$' and kind in ('explanation', 'revision_question', 'targeted_resource')
     and char_length(btrim(title)) between 2 and 200 and status in ('active', 'retired'));

alter table individual_scholar_osce_station drop constraint if exists individual_scholar_osce_station_definition_check;
alter table individual_scholar_osce_attempt drop constraint if exists individual_scholar_osce_attempt_progress_check;

alter table individual_scholar_osce_station drop constraint if exists individual_scholar_osce_station_checklist_check;
alter table individual_scholar_osce_station add constraint individual_scholar_osce_station_checklist_check
  check (jsonb_typeof(checklist) = 'array'
     and jsonb_array_length(checklist) between 6 and 14
     and octet_length(checklist::text) <= 16000
     and not jsonb_path_exists(checklist, '$[*] ? (!(@.type() == "object") || !(@.id.type() == "string") || @.id == "" || !(@.text.type() == "string") || @.text == "" || !(@.critical.type() == "boolean") || (exists(@.outcome) && !(@.outcome.type() == "string")))'));

alter table individual_scholar_osce_station drop constraint if exists individual_scholar_osce_station_source_check;
alter table individual_scholar_osce_station add constraint individual_scholar_osce_station_source_check
  check (source in ('template', 'competency', 'ai', 'own')
     and review_status = 'private_formative'
     and ((source = 'template') = (template_key is not null))
     and (template_key is null or template_key ~ '^[a-z0-9][a-z0-9-]{0,59}$')
     and (source <> 'ai' or material_id is not null)
     and (chunk_id is null or material_id is not null)
     and ((source = 'ai') = (model is not null))
     and ((model is null) = (prompt_version is null))
     and (model is null or char_length(model) between 1 and 200)
     and (prompt_version is null or char_length(prompt_version) between 1 and 200));

alter table individual_scholar_osce_attempt drop constraint if exists individual_scholar_osce_attempt_marking_check;
alter table individual_scholar_osce_attempt add constraint individual_scholar_osce_attempt_marking_check
  check ((ticks is null) = (marking is null)
     and (ticks is null) = (score is null)
     and (ticks is null) = (critical_missed is null)
     and (ticks is null or finished_at is not null)
     and (ticks is null or (jsonb_typeof(ticks) = 'array'
          and jsonb_array_length(ticks) between 1 and 14
          and not jsonb_path_exists(ticks, '$[*] ? (!(@.type() == "object") || !(@.itemId.type() == "string") || !(@.mark.type() == "string") || !(@.mark == "done" || @.mark == "partly" || @.mark == "missed"))')))
     and (score is null or (score >= 0 and score <= 1))
     and (critical_missed is null or critical_missed between 0 and 14)
     and (marking is null or marking in ('self_graded', 'ai_evaluation'))
     and ((coalesce(marking, '') = 'ai_evaluation') = (evaluator_model is not null))
     and ((evaluator_model is null) = (evaluator_prompt_version is null))
     and (evaluator_model is null or char_length(evaluator_model) between 1 and 200)
     and (evaluator_prompt_version is null or char_length(evaluator_prompt_version) between 1 and 200)
     and (feedback is null or (jsonb_typeof(feedback) = 'object' and octet_length(feedback::text) <= 16000)));

drop index if exists ux_individual_scholar_osce_station_library;
drop index if exists idx_individual_scholar_osce_station_library_version;
drop index if exists idx_individual_scholar_osce_attempt_open;

alter table individual_scholar_osce_station
  drop column if exists profession, drop column if exists programme_code, drop column if exists programme_label,
  drop column if exists topic, drop column if exists body_system, drop column if exists difficulty,
  drop column if exists learning_outcomes, drop column if exists objectives, drop column if exists expected_activities,
  drop column if exists guidance, drop column if exists source_references, drop column if exists version,
  drop column if exists library_resource_id, drop column if exists library_version_id;

alter table individual_scholar_osce_attempt
  drop column if exists station_version, drop column if exists station_snapshot, drop column if exists status,
  drop column if exists last_saved_at, drop column if exists gaps, drop column if exists revision_suggestions;

notify pgrst, 'reload schema';
