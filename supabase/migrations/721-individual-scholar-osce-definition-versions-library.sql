-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains two functions between dollar quotes (one sql, one plpgsql trigger
-- function). A runner that splits on the statement separator would cut a function in half, so paste and run
-- the entire file at once.
-- ====================================================================================================
-- MIGRATION 721: COMPETEN SCHOLAR -- OSCE PRACTICE STATION DEFINITION, VERSIONS, AUTOSAVE, GOVERNED STATIONS
--
-- SCHOLAR-OSCE-01 (owner, 31 Oct 2026): the gaps between OSCE Practice V1 (720) and the owner instruction.
-- Fix forward of 720, which is NOT edited. Owner GO to prepare and validate on staging. Production application
-- is a separate owner act. Build record: docs/evidence/SCHOLAR-PRACTICE/721-build-record.md.
--
-- APPLY ON STAGING FIRST, AFTER 720. ADDITIVE OR WIDENING. Nullable or defaulted columns, four 720 CHECKs replaced
-- by wider ones every existing row already satisfies, one new CHECK on each OSCE table, one 442 CHECK widened by
-- one kind, the 442 content-shape function replaced by one that answers every existing kind exactly as before
-- and adds one, and one new trigger. One backfill: an attempt already finished gets status finished (deterministic,
-- idempotent). Re-running the file is a no-op. OPS-001 s8: proposed Low-Medium (a replaced 442 function and a new
-- trigger), with rollback SQL.
-- DEPENDS ON 720 (both OSCE tables) and 442 (ckri_knowledge_resource, ckri_knowledge_version,
-- ckri_knowledge_content_ok, ckri_knowledge_approved). Application order: 720, then 721.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT CHANGES.
--
-- A. NO ARBITRARY CHECKLIST LIMIT. 720 pinned a station checklist to 6 to 14 items and a marked run to 14 ticks.
--    Eight to twelve stays the design default (policy), and a clinically justified station may differ: the
--    structural bound is now 1 to 60 items (the item shape is unchanged), 64000 bytes, and up to 60 ticks.
--
-- B. THE STATION DEFINITION. A station records, where known: the healthcare profession, the educational programme
--    (code and label), the clinical topic and body system, a difficulty, its learning outcomes, educational
--    objectives, expected candidate activities, assessment guidance and suggested responses (an object, shown to
--    the learner only after a run), its source references (an array of objects, for example the notes chunk or
--    material it was written from), and a version (1 or more). Nothing in the schema assumes one profession.
--
-- C. GOVERNED STATIONS. A clinically reviewed, PUBLISHED station is a CKRI knowledge resource (442) of the new kind
--    osce_station, through the existing educator, clinical approval (395) and publication path. Its content shape
--    is checked by ckri_knowledge_content_ok. A learner copy is a station with source library, naming
--    library_resource_id and library_version_id, review_status library_approved, version the version number. The
--    trigger refuses a copy unless, when it is written, the version is the published version of an active
--    osce_station resource, ckri_knowledge_approved says its exact content is approved, and the scenario,
--    instructions, duration, checklist, expected activities and guidance are that content exactly. So an
--    unpublished, private, unapproved or edited station cannot be stored as a governed one by any writer.
--    No student content goes into the library: 442 is unchanged in that respect.
--
-- D. THE ATTEMPT. station_version and station_snapshot (the exact checklist and guidance the run is marked
--    against), status (in_progress, finished, abandoned, finished exactly when finished_at is set),
--    last_saved_at (autosave of written work during the timed run), and on a marked run the gaps and the
--    revision suggestions recorded with it.
--
-- NOT AN ASSESSMENT. Still formative practice only. No reference to osce_*, assessments, clinical_cases or
-- competency_verification_*, and nothing here may be copied into them.
--
-- FAIL CLOSED WITHOUT IT. The app treats OSCE practice as installed only when 720 AND 721 are both present (one
-- read of a 721 column). Until then OSCE practice is shown as unavailable with a plain reason.
--
-- RLS: unchanged (the 720 read-own policies). The server writes through the service role.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/SCHOLAR-PRACTICE/ROLLBACK-721.sql restores the 720 CHECKs, the 442 kind CHECK
--   and the 442 function exactly, and drops the rest. It refuses while any row uses what 721 added.
-- ====================================================================================================


-- ---- 1. the station definition and the governed-station provenance columns ---------------------------

alter table individual_scholar_osce_station add column if not exists profession text;
alter table individual_scholar_osce_station add column if not exists programme_code text;
alter table individual_scholar_osce_station add column if not exists programme_label text;
alter table individual_scholar_osce_station add column if not exists topic text;
alter table individual_scholar_osce_station add column if not exists body_system text;
alter table individual_scholar_osce_station add column if not exists difficulty text;
alter table individual_scholar_osce_station add column if not exists learning_outcomes jsonb;
alter table individual_scholar_osce_station add column if not exists objectives jsonb;
alter table individual_scholar_osce_station add column if not exists expected_activities jsonb;
alter table individual_scholar_osce_station add column if not exists guidance jsonb;
alter table individual_scholar_osce_station add column if not exists source_references jsonb;
alter table individual_scholar_osce_station add column if not exists version integer not null default 1;
alter table individual_scholar_osce_station add column if not exists library_resource_id uuid references ckri_knowledge_resource(id) on delete cascade;
alter table individual_scholar_osce_station add column if not exists library_version_id uuid references ckri_knowledge_version(id) on delete cascade;

alter table individual_scholar_osce_station drop constraint if exists individual_scholar_osce_station_definition_check;
alter table individual_scholar_osce_station add constraint individual_scholar_osce_station_definition_check
  check (version between 1 and 100000
     and (profession is null or char_length(btrim(profession)) between 1 and 80)
     and (programme_code is null or char_length(btrim(programme_code)) between 1 and 80)
     and (programme_label is null or char_length(btrim(programme_label)) between 1 and 200)
     and (topic is null or char_length(btrim(topic)) between 1 and 160)
     and (body_system is null or char_length(btrim(body_system)) between 1 and 80)
     and (difficulty is null or difficulty in ('introductory', 'intermediate', 'advanced'))
     and (learning_outcomes is null or (jsonb_typeof(learning_outcomes) = 'array' and jsonb_array_length(learning_outcomes) <= 60
          and octet_length(learning_outcomes::text) <= 24000 and not jsonb_path_exists(learning_outcomes, '$[*] ? (!(@.type() == "string") || @ == "")')))
     and (objectives is null or (jsonb_typeof(objectives) = 'array' and jsonb_array_length(objectives) <= 30
          and octet_length(objectives::text) <= 12000 and not jsonb_path_exists(objectives, '$[*] ? (!(@.type() == "string") || @ == "")')))
     and (expected_activities is null or (jsonb_typeof(expected_activities) = 'array' and jsonb_array_length(expected_activities) <= 60
          and octet_length(expected_activities::text) <= 24000 and not jsonb_path_exists(expected_activities, '$[*] ? (!(@.type() == "string") || @ == "")')))
     and (guidance is null or (jsonb_typeof(guidance) = 'object' and octet_length(guidance::text) <= 32000))
     and (source_references is null or (jsonb_typeof(source_references) = 'array' and jsonb_array_length(source_references) <= 40
          and octet_length(source_references::text) <= 16000 and not jsonb_path_exists(source_references, '$[*] ? (!(@.type() == "object"))')))
     and ((library_version_id is null) = (library_resource_id is null)));

create unique index if not exists ux_individual_scholar_osce_station_library
  on individual_scholar_osce_station(user_id, library_version_id);
create index if not exists idx_individual_scholar_osce_station_library_version
  on individual_scholar_osce_station(library_version_id);


-- ---- 2. the checklist: 1 to 60 items, the 720 item shape unchanged ------------------------------------

alter table individual_scholar_osce_station drop constraint if exists individual_scholar_osce_station_checklist_check;
alter table individual_scholar_osce_station add constraint individual_scholar_osce_station_checklist_check
  check (jsonb_typeof(checklist) = 'array'
     and jsonb_array_length(checklist) between 1 and 60
     and octet_length(checklist::text) <= 64000
     and not jsonb_path_exists(checklist, '$[*] ? (!(@.type() == "object") || !(@.id.type() == "string") || @.id == "" || !(@.text.type() == "string") || @.text == "" || !(@.critical.type() == "boolean") || (exists(@.outcome) && !(@.outcome.type() == "string")))'));


-- ---- 3. the source: a governed station copy joins template, competency, ai and own ---------------------

alter table individual_scholar_osce_station drop constraint if exists individual_scholar_osce_station_source_check;
alter table individual_scholar_osce_station add constraint individual_scholar_osce_station_source_check
  check (source in ('template', 'competency', 'ai', 'own', 'library')
     and review_status in ('private_formative', 'library_approved')
     and ((review_status = 'library_approved') = (library_version_id is not null))
     and ((source = 'library') = (library_version_id is not null))
     and ((source = 'template') = (template_key is not null))
     and (template_key is null or template_key ~ '^[a-z0-9][a-z0-9-]{0,59}$')
     and (source <> 'ai' or material_id is not null)
     and (chunk_id is null or material_id is not null)
     and ((source = 'ai') = (model is not null))
     and ((model is null) = (prompt_version is null))
     and (model is null or char_length(model) between 1 and 200)
     and (prompt_version is null or char_length(prompt_version) between 1 and 200));


-- ---- 4. the attempt: version, snapshot, status, autosave, gaps and revision suggestions --------------

alter table individual_scholar_osce_attempt add column if not exists station_version integer;
alter table individual_scholar_osce_attempt add column if not exists station_snapshot jsonb;
alter table individual_scholar_osce_attempt add column if not exists status text not null default 'in_progress';
alter table individual_scholar_osce_attempt add column if not exists last_saved_at timestamptz;
alter table individual_scholar_osce_attempt add column if not exists gaps jsonb;
alter table individual_scholar_osce_attempt add column if not exists revision_suggestions jsonb;

update individual_scholar_osce_attempt set status = 'finished' where finished_at is not null and status <> 'finished';

alter table individual_scholar_osce_attempt drop constraint if exists individual_scholar_osce_attempt_progress_check;
alter table individual_scholar_osce_attempt add constraint individual_scholar_osce_attempt_progress_check
  check (status in ('in_progress', 'finished', 'abandoned')
     and ((status = 'finished') = (finished_at is not null))
     and (station_version is null or station_version between 1 and 100000)
     and (station_snapshot is null or (jsonb_typeof(station_snapshot) = 'object' and octet_length(station_snapshot::text) <= 120000))
     and (gaps is null or (jsonb_typeof(gaps) = 'array' and octet_length(gaps::text) <= 16000))
     and (revision_suggestions is null or (jsonb_typeof(revision_suggestions) = 'array' and octet_length(revision_suggestions::text) <= 8000))
     and ((gaps is null and revision_suggestions is null) or ticks is not null));

alter table individual_scholar_osce_attempt drop constraint if exists individual_scholar_osce_attempt_marking_check;
alter table individual_scholar_osce_attempt add constraint individual_scholar_osce_attempt_marking_check
  check ((ticks is null) = (marking is null)
     and (ticks is null) = (score is null)
     and (ticks is null) = (critical_missed is null)
     and (ticks is null or finished_at is not null)
     and (ticks is null or (jsonb_typeof(ticks) = 'array'
          and jsonb_array_length(ticks) between 1 and 60
          and not jsonb_path_exists(ticks, '$[*] ? (!(@.type() == "object") || !(@.itemId.type() == "string") || !(@.mark.type() == "string") || !(@.mark == "done" || @.mark == "partly" || @.mark == "missed"))')))
     and (score is null or (score >= 0 and score <= 1))
     and (critical_missed is null or critical_missed between 0 and 60)
     and (marking is null or marking in ('self_graded', 'ai_evaluation'))
     and ((coalesce(marking, '') = 'ai_evaluation') = (evaluator_model is not null))
     and ((evaluator_model is null) = (evaluator_prompt_version is null))
     and (evaluator_model is null or char_length(evaluator_model) between 1 and 200)
     and (evaluator_prompt_version is null or char_length(evaluator_prompt_version) between 1 and 200)
     and (feedback is null or (jsonb_typeof(feedback) = 'object' and octet_length(feedback::text) <= 16000)));

create index if not exists idx_individual_scholar_osce_attempt_open
  on individual_scholar_osce_attempt(user_id, station_id, status);


-- ---- 5. the 442 kind CHECK gains osce_station ---------------------------------------------------------

alter table ckri_knowledge_resource drop constraint if exists ckri_knowledge_resource_check;
alter table ckri_knowledge_resource add constraint ckri_knowledge_resource_check
  check (code ~ '^[a-z][a-z0-9_-]{2,60}$' and kind in ('explanation', 'revision_question', 'targeted_resource', 'osce_station')
     and char_length(btrim(title)) between 2 and 200 and status in ('active', 'retired'));


-- ---- 6. the shape of each kind: the three 442 branches unchanged, and an OSCE practice station ---------

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
    when 'osce_station' then case
      when jsonb_typeof(p -> 'scenario') = 'string' and jsonb_typeof(p -> 'candidate_instructions') = 'string' and jsonb_typeof(p -> 'checklist') = 'array' then
            char_length(btrim(p ->> 'scenario')) between 20 and 4000
        and char_length(btrim(p ->> 'candidate_instructions')) between 10 and 2000
        and jsonb_path_exists(p, '$.duration_minutes ? (@.type() == "number" && @ >= 3 && @ <= 20 && @ == @.floor())')
        and jsonb_array_length(p -> 'checklist') between 1 and 60
        and octet_length((p -> 'checklist')::text) <= 64000
        and not jsonb_path_exists(p -> 'checklist', '$[*] ? (!(@.type() == "object") || !(@.id.type() == "string") || @.id == "" || !(@.text.type() == "string") || @.text == "" || !(@.critical.type() == "boolean") || (exists(@.outcome) && !(@.outcome.type() == "string")))')
        and (case when jsonb_typeof(p -> 'sections') = 'array' then jsonb_array_length(p -> 'sections') between 1 and 6
               and not jsonb_path_exists(p -> 'sections', '$[*] ? (!(@.type() == "string") || @ == "")') else p -> 'sections' is null end)
        and (case when jsonb_typeof(p -> 'objectives') = 'array' then jsonb_array_length(p -> 'objectives') <= 30
               and not jsonb_path_exists(p -> 'objectives', '$[*] ? (!(@.type() == "string") || @ == "")') else p -> 'objectives' is null end)
        and (case when jsonb_typeof(p -> 'expected_activities') = 'array' then jsonb_array_length(p -> 'expected_activities') <= 60
               and not jsonb_path_exists(p -> 'expected_activities', '$[*] ? (!(@.type() == "string") || @ == "")') else p -> 'expected_activities' is null end)
        and (case when jsonb_typeof(p -> 'learning_outcomes') = 'array' then jsonb_array_length(p -> 'learning_outcomes') <= 60
               and not jsonb_path_exists(p -> 'learning_outcomes', '$[*] ? (!(@.type() == "string") || @ == "")') else p -> 'learning_outcomes' is null end)
        and (case when jsonb_typeof(p -> 'references') = 'array' then jsonb_array_length(p -> 'references') <= 40
               and not jsonb_path_exists(p -> 'references', '$[*] ? (!(@.type() == "object"))') else p -> 'references' is null end)
        and (p -> 'guidance' is null or jsonb_typeof(p -> 'guidance') = 'object')
        and (p -> 'difficulty' is null or (jsonb_typeof(p -> 'difficulty') = 'string' and p ->> 'difficulty' in ('introductory', 'intermediate', 'advanced')))
        and (p -> 'profession' is null or (jsonb_typeof(p -> 'profession') = 'string' and char_length(btrim(p ->> 'profession')) between 1 and 80))
        and (p -> 'programme_code' is null or (jsonb_typeof(p -> 'programme_code') = 'string' and char_length(btrim(p ->> 'programme_code')) between 1 and 80))
        and (p -> 'programme_label' is null or (jsonb_typeof(p -> 'programme_label') = 'string' and char_length(btrim(p ->> 'programme_label')) between 1 and 200))
        and (p -> 'topic' is null or (jsonb_typeof(p -> 'topic') = 'string' and char_length(btrim(p ->> 'topic')) between 1 and 160))
        and (p -> 'body_system' is null or (jsonb_typeof(p -> 'body_system') = 'string' and char_length(btrim(p ->> 'body_system')) between 1 and 80))
      else false end
    else false end
$$;


-- ---- 7. a governed station copy is only ever the published, clinically approved content, exactly ------

create or replace function public.individual_scholar_osce_station_library_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v record;
begin
  if new.library_version_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.library_version_id is not distinct from old.library_version_id
     and new.library_resource_id is not distinct from old.library_resource_id
     and new.scenario = old.scenario and new.candidate_instructions = old.candidate_instructions
     and new.duration_minutes = old.duration_minutes and new.checklist = old.checklist and new.version = old.version
     and new.expected_activities is not distinct from old.expected_activities and new.guidance is not distinct from old.guidance then
    return new;
  end if;
  select kv.state, kv.content, kv.resource_id, kv.version_no, kr.kind, kr.status into v
    from ckri_knowledge_version kv join ckri_knowledge_resource kr on kr.id = kv.resource_id
   where kv.id = new.library_version_id;
  if not found or v.resource_id is distinct from new.library_resource_id then
    raise exception 'individual_scholar_osce_station: unknown library version, or not of the named resource';
  end if;
  if v.kind <> 'osce_station' or v.status <> 'active' or v.state <> 'published' then
    raise exception 'individual_scholar_osce_station: only the published version of an active OSCE station is reused (this one is % %, %)', v.status, v.kind, v.state;
  end if;
  if not ckri_knowledge_approved(new.library_version_id) then
    raise exception 'individual_scholar_osce_station: this exact library version is not clinically approved';
  end if;
  if new.scenario is distinct from (v.content ->> 'scenario')
     or new.candidate_instructions is distinct from (v.content ->> 'candidate_instructions')
     or new.duration_minutes::numeric is distinct from (v.content ->> 'duration_minutes')::numeric
     or new.checklist is distinct from (v.content -> 'checklist')
     or new.expected_activities is distinct from (v.content -> 'expected_activities')
     or new.guidance is distinct from (v.content -> 'guidance')
     or new.version is distinct from v.version_no then
    raise exception 'individual_scholar_osce_station: a governed station is stored exactly as published';
  end if;
  return new;
end;
$$;

drop trigger if exists individual_scholar_osce_station_library_guard on individual_scholar_osce_station;
create trigger individual_scholar_osce_station_library_guard
  before insert or update on individual_scholar_osce_station
  for each row execute function public.individual_scholar_osce_station_library_guard();


-- ---- 8. what the columns mean -------------------------------------------------------------------------

comment on column individual_scholar_osce_station.version is
  'SCHOLAR-OSCE-01 (721). The station version. 1 for a station Scholar writes. For a governed copy (source library), the CKRI version number it is exactly. Each attempt records the version and a snapshot of what it was marked against.';
comment on column individual_scholar_osce_station.guidance is
  'SCHOLAR-OSCE-01 (721). Assessment guidance and suggested responses. Shown to the learner only after a run, never before or during it.';
comment on column individual_scholar_osce_station.source_references is
  'SCHOLAR-OSCE-01 (721). Where the station came from: for example the notes material and chunks it was written from, the competency, or the published references of a governed station.';
comment on column individual_scholar_osce_station.library_version_id is
  'SCHOLAR-OSCE-01 (721). The published, clinically approved CKRI knowledge version (442, kind osce_station) this learner copy is, exactly. Null for every station Scholar writes. Checked by individual_scholar_osce_station_library_guard.';
comment on column individual_scholar_osce_attempt.station_snapshot is
  'SCHOLAR-OSCE-01 (721). The exact station (checklist, guidance, sections, version) this run was marked against, taken when the run started.';
comment on column individual_scholar_osce_attempt.status is
  'SCHOLAR-OSCE-01 (721). in_progress while the timed run is open (written work autosaved, last_saved_at), finished exactly when finished_at is set, abandoned when the learner discards an open run. Formative practice only.';

notify pgrst, 'reload schema';
