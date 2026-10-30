-- ====================================================================================================
-- MIGRATION 720: COMPETEN SCHOLAR -- OSCE PRACTICE STATIONS AND ATTEMPTS, AND THE ADAPTIVE REVISION MODE
--
-- SCHOLAR-PRACTICE-EXAMS-01 (owner, 30 Oct 2026): OSCE Practice and Adaptive Exams in Competen Scholar,
-- educational and formative only, never verification. Owner GO to prepare and validate on staging.
-- Production application is a separate owner act. Build record: docs/evidence/SCHOLAR-PRACTICE/720-build-record.md.
--
-- APPLY ON STAGING FIRST. ADDITIVE OR WIDENING. Two new tables. Two existing CHECKs (417) replaced by wider ones
-- that every existing row already satisfies. No row is changed. No function, no trigger. Re-running it is a no-op.
-- OPS-001 s8: proposed Low.
-- DEPENDS ON profiles, 372 (individual_scholar_material, individual_scholar_chunk), 388 (framework_competencies is
-- referenced exactly as individual_scholar_question.competency_id references it) and 417 (the two revision tables).
-- Independent of every migration after 417, including 710. The ON DELETE SET NULL (column) form needs PostgreSQL 15.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT CHANGES.
--
-- A. THE ADAPTIVE REVISION MODE. The mode CHECK on individual_scholar_revision_set and on
--    individual_scholar_revision_session gains adaptive. Every other part of both CHECKs is the 417 text unchanged.
--
-- B. OSCE PRACTICE STATIONS. individual_scholar_osce_station is a simulated station the learner practises alone:
--    a title, a scenario, candidate instructions, a duration (3 to 20 minutes), the response sections the learner
--    writes under, and a checklist of 6 to 14 items, each an object with a string id, a string text, a boolean
--    critical and an optional string outcome. Where it came from is recorded:
--      template     a Competen practice template, shipped as data, labelled not clinically reviewed
--      competency   built by code from the outcomes of a linked competency, with that content status
--      ai           written by AI from ONE of the learner own materials, grounded in its passages, with model and
--                   prompt version recorded
--      own          written by the learner
--    review_status can ONLY be private_formative. Nothing here is a clinically approved station.
--
-- C. OSCE PRACTICE ATTEMPTS. individual_scholar_osce_attempt is one timed run of a station: when it started and
--    finished, how long it took, what the learner wrote (responses, an object of section to text), and then the
--    self-check: a tick per checklist item (done, partly or missed), a practice score from 0 to 1 and the number
--    of critical items missed. marking says HOW it was checked:
--      self_graded     the learner ticked the checklist alone
--      ai_evaluation   AI read the responses against the checklist and suggested ticks and feedback, and the
--                      learner confirmed them -- then the evaluator model and prompt version are recorded
--    The ticks, score, critical count and marking are written together, and only once the run is finished.
--
-- NOT AN ASSESSMENT. A practice score is formative practice, never an observed clinical skills assessment, never a
-- pass, never verified competence and never Passport evidence. There is no reference to osce_*, assessments,
-- clinical_cases or competency_verification_* and nothing here may be copied into them.
--
-- OWNERSHIP IS IN THE SCHEMA. Every reference to another learner row is a composite (id, user_id) foreign key, so
-- an attempt cannot point at the station of another person and a station cannot point at the material or chunk of
-- another person. Deleting a person deletes both. Deleting a station deletes its attempts. Deleting a material or
-- chunk deletes the AI stations written from it (their text came from it). Deleting a competency leaves the
-- station with competency_id cleared.
--
-- RLS ON, own-row SELECT policy only (owner ruling D6, as 372 and 417). The server writes through the service role.
--
-- FAIL CLOSED WITHOUT IT. Until it is applied, OSCE Practice is shown as unavailable with a plain reason, and the
-- adaptive mode cannot be saved (the 417 CHECKs refuse it). Scholar detects that once and offers what 417 allows.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. No function. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/SCHOLAR-PRACTICE/ROLLBACK-720.sql restores the two 417 CHECKs and drops the two
--   tables. It refuses while any adaptive set or session, OSCE station or OSCE attempt exists, and says what to remove.
-- ====================================================================================================


-- ---- 1. the adaptive revision mode (417 CHECKs widened) ----------------------------------------------

alter table individual_scholar_revision_set drop constraint if exists individual_scholar_revision_set_check;
alter table individual_scholar_revision_set add constraint individual_scholar_revision_set_check
  check (char_length(title) between 1 and 120
     and mode in ('today', 'quick', 'spaced', 'weak', 'mock', 'flashcards', 'custom', 'adaptive')
     and jsonb_typeof(scope) = 'object' and octet_length(scope::text) <= 4000
     and jsonb_typeof(formats) = 'array' and jsonb_array_length(formats) between 1 and 7
     and formats <@ '["mcq", "case", "mrq", "short", "flashcard", "match", "sequence"]'::jsonb
     and quantity between 1 and 50
     and difficulty in ('any', 'easy', 'standard', 'harder')
     and feedback in ('immediate', 'end'));

alter table individual_scholar_revision_session drop constraint if exists individual_scholar_revision_session_check;
alter table individual_scholar_revision_session add constraint individual_scholar_revision_session_check
  check (mode in ('today', 'quick', 'spaced', 'weak', 'mock', 'flashcards', 'custom', 'adaptive')
     and feedback in ('immediate', 'end')
     and status in ('active', 'completed')
     and total between 1 and 50
     and position between 0 and total
     and ((status = 'completed') = (completed_at is not null)));


-- ---- 2. an OSCE practice station ----------------------------------------------------------------------

create table if not exists individual_scholar_osce_station (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references profiles(id) on delete cascade,
  title                   text not null,
  scenario                text not null,
  candidate_instructions  text not null,
  duration_minutes        smallint not null default 8,
  sections                jsonb not null,
  checklist               jsonb not null,
  competency_id           uuid references framework_competencies(id) on delete set null,
  material_id             uuid,
  chunk_id                uuid,
  source                  text not null,
  template_key            text,
  content_status          text not null,
  review_status           text not null default 'private_formative',
  model                   text,
  prompt_version          text,
  created_at              timestamptz not null default now(),
  constraint individual_scholar_osce_station_material_fk foreign key (material_id, user_id)
    references individual_scholar_material(id, user_id) on delete cascade,
  constraint individual_scholar_osce_station_chunk_fk foreign key (chunk_id, user_id)
    references individual_scholar_chunk(id, user_id) on delete cascade
);

alter table individual_scholar_osce_station drop constraint if exists individual_scholar_osce_station_text_check;
alter table individual_scholar_osce_station add constraint individual_scholar_osce_station_text_check
  check (char_length(btrim(title)) between 1 and 160
     and char_length(btrim(scenario)) between 1 and 4000
     and char_length(btrim(candidate_instructions)) between 1 and 2000
     and char_length(btrim(content_status)) between 1 and 160
     and duration_minutes between 3 and 20);

alter table individual_scholar_osce_station drop constraint if exists individual_scholar_osce_station_sections_check;
alter table individual_scholar_osce_station add constraint individual_scholar_osce_station_sections_check
  check (jsonb_typeof(sections) = 'array'
     and jsonb_array_length(sections) between 1 and 6
     and octet_length(sections::text) <= 1000
     and not jsonb_path_exists(sections, '$[*] ? (!(@.type() == "string") || @ == "")'));

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

create unique index if not exists ux_individual_scholar_osce_station_id_user
  on individual_scholar_osce_station(id, user_id);
create unique index if not exists ux_individual_scholar_osce_station_template
  on individual_scholar_osce_station(user_id, template_key);
create index if not exists idx_individual_scholar_osce_station_user
  on individual_scholar_osce_station(user_id, created_at desc);
create index if not exists idx_individual_scholar_osce_station_material
  on individual_scholar_osce_station(material_id, user_id);
create index if not exists idx_individual_scholar_osce_station_chunk
  on individual_scholar_osce_station(chunk_id, user_id);
create index if not exists idx_individual_scholar_osce_station_competency
  on individual_scholar_osce_station(competency_id);


-- ---- 3. an OSCE practice attempt --------------------------------------------------------------------

create table if not exists individual_scholar_osce_attempt (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references profiles(id) on delete cascade,
  station_id                uuid not null,
  started_at                timestamptz not null default now(),
  finished_at               timestamptz,
  duration_seconds          integer,
  time_up                   boolean not null default false,
  responses                 jsonb not null default '{}'::jsonb,
  ticks                     jsonb,
  score                     numeric(4, 3),
  critical_missed           smallint,
  marking                   text,
  evaluator_model           text,
  evaluator_prompt_version  text,
  feedback                  jsonb,
  created_at                timestamptz not null default now(),
  constraint individual_scholar_osce_attempt_station_fk foreign key (station_id, user_id)
    references individual_scholar_osce_station(id, user_id) on delete cascade
);

alter table individual_scholar_osce_attempt drop constraint if exists individual_scholar_osce_attempt_run_check;
alter table individual_scholar_osce_attempt add constraint individual_scholar_osce_attempt_run_check
  check (jsonb_typeof(responses) = 'object'
     and octet_length(responses::text) <= 24000
     and ((finished_at is null) = (duration_seconds is null))
     and (finished_at is null or finished_at >= started_at)
     and (duration_seconds is null or duration_seconds between 0 and 1200)
     and (finished_at is not null or not time_up));

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

create unique index if not exists ux_individual_scholar_osce_attempt_id_user
  on individual_scholar_osce_attempt(id, user_id);
create index if not exists idx_individual_scholar_osce_attempt_station
  on individual_scholar_osce_attempt(station_id, user_id, started_at desc);
create index if not exists idx_individual_scholar_osce_attempt_user
  on individual_scholar_osce_attempt(user_id, started_at desc);


-- ---- 4. own rows only ----------------------------------------------------------------------------------

alter table individual_scholar_osce_station enable row level security;
alter table individual_scholar_osce_attempt enable row level security;

drop policy if exists individual_scholar_osce_station_read_own on individual_scholar_osce_station;
create policy individual_scholar_osce_station_read_own on individual_scholar_osce_station
  for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_osce_attempt_read_own on individual_scholar_osce_attempt;
create policy individual_scholar_osce_attempt_read_own on individual_scholar_osce_attempt
  for select using (auth.uid() = user_id);

comment on table individual_scholar_osce_station is
  'SCHOLAR-PRACTICE-EXAMS-01 (720). A simulated OSCE practice station a learner practises alone: scenario, instructions, duration, response sections and a 6 to 14 item checklist. Always private_formative. Never an observed clinical skills assessment, never verified competence.';
comment on table individual_scholar_osce_attempt is
  'SCHOLAR-PRACTICE-EXAMS-01 (720). One timed simulated practice run of a station: what the learner wrote, and the self-check (ticks, practice score, critical items missed, self_graded or ai_evaluation). Formative practice only, never a pass, never Passport evidence.';

notify pgrst, 'reload schema';
