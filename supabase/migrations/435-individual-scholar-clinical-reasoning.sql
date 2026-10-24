-- ====================================================================================================
-- !! APPLY THIS FILE WHOLE. It defines a plpgsql trigger function. A runner that splits on semicolons
-- !! would cut the function body apart. Paste the whole file, or use scripts/apply-migrations.ts.
--
-- MIGRATION 435: COMPETEN SCHOLAR -- PRIVATE CLINICAL CASES, CASE SESSIONS AND THE DECISIONS MADE IN THEM
--
-- COMPETEN-SCHOLAR-CLINICAL-REASONING-01 (Stage 5A), CR1, CR3 and CR5, owner GO: development and staging
-- authorised, production activation on hold. Build record: docs/COMPETEN-SCHOLAR-CLINICAL-REASONING-01.md.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. MEDIUM: five new tables and one trigger function. No
-- existing table or row is changed. Re-running it is a no-op.
-- It depends on 372 (individual_scholar_material, individual_scholar_chunk and their (id, user_id) indexes),
-- 384 (framework_competencies), 422 (case_library_version) and profiles.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR.
--
-- A clinical case is ONE structure everywhere: the shared case blueprint, case-blueprint/1 (src/lib/cases/blueprint.ts,
-- agreed by IND-004 and IND-007). A governed library case lives in case_library_version (422) and is approved there,
-- by 395 on its exact version. This file holds the student side only.
--
--   individual_scholar_case             the PRIVATE case of a student: a blueprint (private profile) written from their own
--   individual_scholar_case_source        notes, the sections it was written from, and the competencies it serves.
--   individual_scholar_case_competency    Always private_formative -- an AI-written case can never be stored as approved.
--   individual_scholar_case_session     ONE playing of a case, private or from the library: the version played, the
--                                         stages reached, the facts revealed (asked for, or consequences), the mode,
--                                         where the student is, and the debrief once finished. A student leaves and
--                                         resumes without losing anything (CR5).
--   individual_scholar_case_answer      every decision made in a session: the options chosen or the reasoning written,
--                                         how it was marked, the safety criteria it broke, and any AI reasoning
--                                         feedback with the model that wrote it. APPEND-ONLY.
--
-- GOVERNED FACTS STAY GOVERNED. A session stores ids from its blueprint (stages, facts, decision points, options),
-- never a copy of a finding or a value: what the student saw is always the facts of the version itself. The salt that makes
-- the per-view tokens opaque (blueprint.ts viewToken) is kept here and never sent to a browser.
--
-- A LIBRARY CASE IS PLAYED, NEVER COPIED. A session on a library case names its exact version. The version is never
-- deleted from under a session (ON DELETE RESTRICT): retiring or superseding it is a state, and a student who started
-- it can still finish it.
--
-- OWNERSHIP IS IN THE SCHEMA. Composite (id, user_id) foreign keys throughout. A private case goes with the material
-- it was written from and with its person. A session goes with its private case or its person. Answers go with their
-- session -- and with nothing else: they refuse UPDATE and DELETE except as part of a cascade (pg_trigger_depth() > 1),
-- so the record of what a student decided cannot be rewritten, and a session or a person can still be erased.
--
-- WHAT A STUDENT WRITES (their reasoning on a free-text decision) is their own text in their own private record,
-- screened for patient identifiers before it is written (application), bounded here, readable only by its owner, and
-- erased with the session, the material or the person. Nothing here is assessment, competence or Passport evidence.
--
-- RLS ON, own-row SELECT policy only (owner ruling D6). The server writes through the service role.
--
-- FAIL CLOSED WITHOUT IT. Until it is applied, clinical reasoning is not offered, and the existing practice cases (388)
-- work as they do today.
-- Rollback: docs/evidence/COMPETEN-SCHOLAR-CLINICAL-REASONING-01/ROLLBACK-435.sql.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. APPLY WHOLE banner above.
-- notify pgrst last.
-- ====================================================================================================


-- ---- 1. THE PRIVATE CASE OF A STUDENT ----------------------------------------------------------------

create table if not exists individual_scholar_case (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  material_id     uuid not null,
  title           text not null,
  origin          text not null,
  context         text not null default 'general',
  blueprint       jsonb not null,
  blueprint_hash  text generated always as (md5(blueprint::text)) stored,
  review_status   text not null default 'private_formative',
  model           text not null,
  prompt_version  text not null,
  created_at      timestamptz not null default now(),
  constraint individual_scholar_case_material_fk foreign key (material_id, user_id)
    references individual_scholar_material(id, user_id) on delete cascade
);

alter table individual_scholar_case drop constraint if exists individual_scholar_case_check;
alter table individual_scholar_case add constraint individual_scholar_case_check
  check (char_length(btrim(title)) between 1 and 200
     and origin in ('notes', 'topic', 'competency', 'teach', 'revision', 'surprise')
     and context ~ '^[a-z][a-z_]{1,40}$'
     and jsonb_typeof(blueprint) = 'object' and blueprint ->> 'schema' = 'case-blueprint/1'
     and octet_length(blueprint::text) <= 200000
     and review_status = 'private_formative'
     and char_length(model) between 1 and 200 and char_length(prompt_version) between 1 and 200);

create unique index if not exists ux_individual_scholar_case_id_user
  on individual_scholar_case(id, user_id);
create index if not exists idx_individual_scholar_case_user
  on individual_scholar_case(user_id, created_at desc);

create table if not exists individual_scholar_case_source (
  case_id   uuid not null,
  user_id   uuid not null,
  ordinal   smallint not null,
  chunk_id  uuid not null,
  constraint individual_scholar_case_source_pk primary key (case_id, ordinal),
  constraint individual_scholar_case_source_case_fk foreign key (case_id, user_id)
    references individual_scholar_case(id, user_id) on delete cascade,
  constraint individual_scholar_case_source_chunk_fk foreign key (chunk_id, user_id)
    references individual_scholar_chunk(id, user_id) on delete cascade
);
alter table individual_scholar_case_source drop constraint if exists individual_scholar_case_source_check;
alter table individual_scholar_case_source add constraint individual_scholar_case_source_check check (ordinal between 1 and 20);
create unique index if not exists ux_individual_scholar_case_source_chunk
  on individual_scholar_case_source(case_id, chunk_id);
create index if not exists idx_individual_scholar_case_source_chunk
  on individual_scholar_case_source(chunk_id);

create table if not exists individual_scholar_case_competency (
  case_id        uuid not null,
  user_id        uuid not null,
  competency_id  uuid not null references framework_competencies(id) on delete cascade,
  constraint individual_scholar_case_competency_pk primary key (case_id, competency_id),
  constraint individual_scholar_case_competency_case_fk foreign key (case_id, user_id)
    references individual_scholar_case(id, user_id) on delete cascade
);
create index if not exists idx_individual_scholar_case_competency_user
  on individual_scholar_case_competency(user_id, competency_id);


-- ---- 2. ONE PLAYING OF A CASE: PRIVATE OR FROM THE LIBRARY -------------------------------------------

create table if not exists individual_scholar_case_session (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles(id) on delete cascade,
  private_case_id     uuid,
  library_version_id  uuid references case_library_version(id) on delete restrict,
  mode                text not null default 'guided',
  status              text not null default 'active',
  view_salt           text not null,
  current_stage_id    text,
  reached_stage_ids   jsonb not null default '[]'::jsonb,
  revealed_fact_ids   jsonb not null default '[]'::jsonb,
  variation           jsonb not null default '{}'::jsonb,
  debrief             jsonb,
  created_at          timestamptz not null default now(),
  last_active_at      timestamptz not null default now(),
  completed_at        timestamptz,
  constraint individual_scholar_case_session_case_fk foreign key (private_case_id, user_id)
    references individual_scholar_case(id, user_id) on delete cascade
);

alter table individual_scholar_case_session drop constraint if exists individual_scholar_case_session_check;
alter table individual_scholar_case_session add constraint individual_scholar_case_session_check
  check (((private_case_id is null) <> (library_version_id is null))
     and mode in ('guided', 'independent')
     and status in ('active', 'completed')
     and ((status = 'completed') = (completed_at is not null))
     and view_salt ~ '^[A-Za-z0-9_-]{22,64}$'
     and (current_stage_id is null or current_stage_id ~ '^[a-z][a-z0-9_-]{0,30}$')
     and jsonb_typeof(reached_stage_ids) = 'array' and jsonb_array_length(reached_stage_ids) <= 50
     and jsonb_typeof(revealed_fact_ids) = 'array' and jsonb_array_length(revealed_fact_ids) <= 200
     and jsonb_typeof(variation) = 'object' and octet_length(variation::text) <= 4000
     and (debrief is null or (jsonb_typeof(debrief) = 'object' and octet_length(debrief::text) <= 20000)));

create unique index if not exists ux_individual_scholar_case_session_id_user
  on individual_scholar_case_session(id, user_id);
create index if not exists idx_individual_scholar_case_session_user
  on individual_scholar_case_session(user_id, status, last_active_at desc);
create index if not exists idx_individual_scholar_case_session_library
  on individual_scholar_case_session(library_version_id);


-- ---- 3. EVERY DECISION MADE IN A SESSION -- APPEND-ONLY ------------------------------------------------

create table if not exists individual_scholar_case_answer (
  id                         uuid primary key default gen_random_uuid(),
  session_id                 uuid not null,
  user_id                    uuid not null,
  decision_point_id          text not null,
  chosen_option_ids          jsonb,
  reasoning                  text,
  marking                    text not null,
  correct                    boolean,
  score                      numeric,
  safety_criterion_ids       jsonb not null default '[]'::jsonb,
  ai_feedback                text,
  evaluator_model            text,
  evaluator_prompt_version   text,
  created_at                 timestamptz not null default now(),
  constraint individual_scholar_case_answer_session_fk foreign key (session_id, user_id)
    references individual_scholar_case_session(id, user_id) on delete cascade
);

alter table individual_scholar_case_answer drop constraint if exists individual_scholar_case_answer_check;
alter table individual_scholar_case_answer add constraint individual_scholar_case_answer_check
  check (decision_point_id ~ '^[a-z][a-z0-9_-]{0,30}$'
     and ((chosen_option_ids is null) <> (reasoning is null))
     and (chosen_option_ids is null or (jsonb_typeof(chosen_option_ids) = 'array' and jsonb_array_length(chosen_option_ids) between 1 and 20))
     and (reasoning is null or char_length(btrim(reasoning)) between 1 and 4000)
     and marking in ('deterministic', 'self_graded', 'ai_evaluation')
     and (score is null or (score >= 0 and score <= 1))
     and jsonb_typeof(safety_criterion_ids) = 'array'
     and (ai_feedback is null or char_length(ai_feedback) between 1 and 4000)
     and ((marking = 'ai_evaluation') = (evaluator_model is not null))
     and ((evaluator_model is null) = (evaluator_prompt_version is null))
     and (ai_feedback is null or evaluator_model is not null)
     and (evaluator_model is null or char_length(evaluator_model) between 1 and 200)
     and (evaluator_prompt_version is null or char_length(evaluator_prompt_version) between 1 and 200));

create unique index if not exists ux_individual_scholar_case_answer_decision
  on individual_scholar_case_answer(session_id, decision_point_id);
create index if not exists idx_individual_scholar_case_answer_user
  on individual_scholar_case_answer(user_id, created_at desc);

create or replace function public.individual_scholar_case_answer_append_only()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'individual_scholar_case_answer is append-only: a decision made is kept as it was made';
end;
$$;

drop trigger if exists individual_scholar_case_answer_append_only on individual_scholar_case_answer;
create trigger individual_scholar_case_answer_append_only
  before update or delete on individual_scholar_case_answer
  for each row execute function public.individual_scholar_case_answer_append_only();


-- ---- 4. OWN ROWS ONLY ---------------------------------------------------------------------------------

alter table individual_scholar_case enable row level security;
alter table individual_scholar_case_source enable row level security;
alter table individual_scholar_case_competency enable row level security;
alter table individual_scholar_case_session enable row level security;
alter table individual_scholar_case_answer enable row level security;

drop policy if exists individual_scholar_case_read_own on individual_scholar_case;
create policy individual_scholar_case_read_own on individual_scholar_case for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_case_source_read_own on individual_scholar_case_source;
create policy individual_scholar_case_source_read_own on individual_scholar_case_source for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_case_competency_read_own on individual_scholar_case_competency;
create policy individual_scholar_case_competency_read_own on individual_scholar_case_competency for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_case_session_read_own on individual_scholar_case_session;
create policy individual_scholar_case_session_read_own on individual_scholar_case_session for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_case_answer_read_own on individual_scholar_case_answer;
create policy individual_scholar_case_answer_read_own on individual_scholar_case_answer for select using (auth.uid() = user_id);

comment on table individual_scholar_case is
  'COMPETEN-SCHOLAR-CLINICAL-REASONING-01 (435). A student''s private clinical case: a case-blueprint/1 written from their own notes. Always private_formative: never clinically approved, never shown as approved.';
comment on table individual_scholar_case_session is
  'COMPETEN-SCHOLAR-CLINICAL-REASONING-01 (435). One playing of a private or library case: ids of what was reached and revealed, never copies of governed facts. view_salt is server-only.';
comment on table individual_scholar_case_answer is
  'COMPETEN-SCHOLAR-CLINICAL-REASONING-01 (435). Every decision made in a case session, how it was marked, the safety criteria it broke. Append-only. Formative, never assessment or competence.';

notify pgrst, 'reload schema';
