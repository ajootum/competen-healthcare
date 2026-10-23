-- ====================================================================================================
-- !! APPLY THIS FILE WHOLE. It defines a plpgsql trigger function. A runner that splits on semicolons
-- !! would cut the function body apart. Paste the whole file, or use scripts/apply-migrations.ts.
--
-- MIGRATION 388: COMPETEN SCHOLAR -- CONCEPTS, PROPOSED COMPETENCY MAPPINGS, AND THE CORRECTIONS TRAIL
--
-- COMPETEN-SCHOLAR-01, S2 and S4 (owner GO 2026-10-23): "auto-identify concepts and PROPOSE competency
-- mappings, multiple per upload/chunk ... preserve provenance, privacy and corrections (student or reviewer
-- corrections recorded, not overwritten) ... do NOT require choosing a competency before upload ...
-- questions, revision activities and interactive clinical cases ... mapped to competencies."
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. MEDIUM: it adds four nullable columns and two
-- checks to individual_scholar_question (372), and an append-only trigger. It depends on 372 (the Scholar
-- tables and their (id, user_id) unique indexes), 387 (programmes) and 003 (framework_competencies).
-- Re-running it is a no-op. Rollback: docs/evidence/COMPETEN-SCHOLAR-01/ROLLBACK-387-388.sql.
--
-- ----------------------------------------------------------------------------------------------------
-- THE SHAPE.
--
--   individual_scholar_chunk_analysis       The concepts the AI found in one section of the notes of a student,
--                                           with the model, prompt version and programme. One per chunk.
--   individual_scholar_competency_map       A PROPOSED link from one section to one competency
--                                           (framework_competencies.id, never copied). Several per
--                                           section. Its source is ai, student or reviewer, and an AI
--                                           proposal carries its model, prompt version and confidence.
--   individual_scholar_competency_decision  APPEND-ONLY. Accepting or rejecting a mapping is a new row,
--                                           never an edit, so every correction stays on the record. The
--                                           current state of a mapping is its latest decision (none means
--                                           still proposed).
--   individual_scholar_question (372) +     competency_id: the competency a question practises.
--                                           case_id, case_step: the steps of one multi-step clinical case.
--                                           case_title: the scenario name, on step 1.
--
-- OWNERSHIP IS IN THE SCHEMA. Every new row carries user_id and a composite foreign key to the
-- (id, user_id) of its parent, so a row of one person pointing at the material of another is unstorable. Deleting a
-- material cascades through all of it. A competency removed from the catalogue removes its mappings and
-- leaves questions in place (their competency_id goes null).
--
-- THE TRAIL CANNOT BE EDITED, AND CAN STILL BE ERASED. The decision trigger refuses UPDATE and DELETE,
-- except a DELETE that arrives by CASCADE from a parent (pg_trigger_depth() > 1) -- so a person erasing
-- their material still erases its trail, the known fix for "the trail can never be removed by anybody".
--
-- RLS: on for every new table, own-row SELECT only (owner ruling D6). No insert, update or delete policy.
-- No estate table is written or referenced except framework_competencies, read as a foreign key target.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
-- ====================================================================================================


-- ---- 1. individual_scholar_chunk_analysis -- THE CONCEPTS IN ONE SECTION ---------------------------------

create table if not exists individual_scholar_chunk_analysis (
  chunk_id        uuid primary key,
  user_id         uuid not null,
  material_id     uuid not null,
  concepts        text[] not null default '{}',
  programme_code  text references individual_scholar_programme(code) on delete set null,
  model           text not null,
  prompt_version  text not null,
  created_at      timestamptz not null default now(),
  constraint individual_scholar_chunk_analysis_chunk_fk foreign key (chunk_id, user_id)
    references individual_scholar_chunk(id, user_id) on delete cascade,
  constraint individual_scholar_chunk_analysis_material_fk foreign key (material_id, user_id)
    references individual_scholar_material(id, user_id) on delete cascade
);

alter table individual_scholar_chunk_analysis drop constraint if exists individual_scholar_chunk_analysis_concepts_check;
alter table individual_scholar_chunk_analysis add constraint individual_scholar_chunk_analysis_concepts_check
  check (cardinality(concepts) <= 20);

create index if not exists idx_individual_scholar_chunk_analysis_material
  on individual_scholar_chunk_analysis(user_id, material_id);

alter table individual_scholar_chunk_analysis enable row level security;

drop policy if exists individual_scholar_chunk_analysis_read_own on individual_scholar_chunk_analysis;
create policy individual_scholar_chunk_analysis_read_own on individual_scholar_chunk_analysis
  for select using (auth.uid() = user_id);


-- ---- 2. individual_scholar_competency_map -- A PROPOSED LINK, SECTION TO COMPETENCY ------------------------

create table if not exists individual_scholar_competency_map (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  material_id     uuid not null,
  chunk_id        uuid not null,
  competency_id   uuid not null references framework_competencies(id) on delete cascade,
  layer           text not null,
  source          text not null,
  confidence      numeric(3, 2),
  rationale       text,
  model           text,
  prompt_version  text,
  programme_code  text references individual_scholar_programme(code) on delete set null,
  created_at      timestamptz not null default now(),
  constraint individual_scholar_competency_map_chunk_fk foreign key (chunk_id, user_id)
    references individual_scholar_chunk(id, user_id) on delete cascade,
  constraint individual_scholar_competency_map_material_fk foreign key (material_id, user_id)
    references individual_scholar_material(id, user_id) on delete cascade
);

alter table individual_scholar_competency_map drop constraint if exists individual_scholar_competency_map_layer_check;
alter table individual_scholar_competency_map add constraint individual_scholar_competency_map_layer_check
  check (layer in ('foundational', 'profession', 'specialty'));

alter table individual_scholar_competency_map drop constraint if exists individual_scholar_competency_map_source_check;
alter table individual_scholar_competency_map add constraint individual_scholar_competency_map_source_check
  check (source in ('ai', 'student', 'reviewer'));

-- An AI proposal says which model and prompt made it, and how sure it was. A mapping made by a person says neither.
alter table individual_scholar_competency_map drop constraint if exists individual_scholar_competency_map_provenance_check;
alter table individual_scholar_competency_map add constraint individual_scholar_competency_map_provenance_check
  check ((source = 'ai') = (model is not null and prompt_version is not null and confidence is not null)
     and (confidence is null or (confidence >= 0 and confidence <= 1))
     and (rationale is null or char_length(rationale) <= 500));

create unique index if not exists ux_individual_scholar_competency_map_id_user
  on individual_scholar_competency_map(id, user_id);
create unique index if not exists ux_individual_scholar_competency_map_chunk_competency
  on individual_scholar_competency_map(chunk_id, competency_id);
create index if not exists idx_individual_scholar_competency_map_material
  on individual_scholar_competency_map(user_id, material_id);
create index if not exists idx_individual_scholar_competency_map_competency
  on individual_scholar_competency_map(user_id, competency_id);

alter table individual_scholar_competency_map enable row level security;

drop policy if exists individual_scholar_competency_map_read_own on individual_scholar_competency_map;
create policy individual_scholar_competency_map_read_own on individual_scholar_competency_map
  for select using (auth.uid() = user_id);


-- ---- 3. individual_scholar_competency_decision -- APPEND-ONLY CORRECTIONS --------------------------------

create table if not exists individual_scholar_competency_decision (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  map_id      uuid not null,
  decision    text not null,
  decided_by  text not null,
  reason      text,
  created_at  timestamptz not null default now(),
  constraint individual_scholar_competency_decision_map_fk foreign key (map_id, user_id)
    references individual_scholar_competency_map(id, user_id) on delete cascade
);

alter table individual_scholar_competency_decision drop constraint if exists individual_scholar_competency_decision_check;
alter table individual_scholar_competency_decision add constraint individual_scholar_competency_decision_check
  check (decision in ('accepted', 'rejected')
     and decided_by in ('student', 'reviewer')
     and (reason is null or char_length(reason) <= 300));

create index if not exists idx_individual_scholar_competency_decision_map
  on individual_scholar_competency_decision(map_id, created_at desc);

alter table individual_scholar_competency_decision enable row level security;

drop policy if exists individual_scholar_competency_decision_read_own on individual_scholar_competency_decision;
create policy individual_scholar_competency_decision_read_own on individual_scholar_competency_decision
  for select using (auth.uid() = user_id);

create or replace function public.individual_scholar_decision_append_only()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'individual_scholar_competency_decision is append-only: record a new decision instead';
end;
$$;

drop trigger if exists individual_scholar_competency_decision_append_only on individual_scholar_competency_decision;
create trigger individual_scholar_competency_decision_append_only
  before update or delete on individual_scholar_competency_decision
  for each row execute function public.individual_scholar_decision_append_only();


-- ---- 4. individual_scholar_question (372) -- THE COMPETENCY IT PRACTISES, AND CASE STEPS ------------------

alter table individual_scholar_question add column if not exists competency_id uuid references framework_competencies(id) on delete set null;
alter table individual_scholar_question add column if not exists case_id uuid;
alter table individual_scholar_question add column if not exists case_step smallint;
alter table individual_scholar_question add column if not exists case_title text;

alter table individual_scholar_question drop constraint if exists individual_scholar_question_case_check;
alter table individual_scholar_question add constraint individual_scholar_question_case_check
  check ((case_id is null) = (case_step is null)
     and (case_id is null or kind = 'case')
     and (case_step is null or case_step between 1 and 5)
     and (case_title is null or (case_step = 1 and char_length(case_title) between 1 and 120)));

create index if not exists idx_individual_scholar_question_competency
  on individual_scholar_question(user_id, competency_id);
create index if not exists idx_individual_scholar_question_case
  on individual_scholar_question(case_id, case_step);

comment on table individual_scholar_competency_map is
  'COMPETEN-SCHOLAR-01 S2. A PROPOSED link from a section of a student''s own notes to a competency (framework_competencies.id). Several per section. Source ai, student or reviewer, with model, prompt version and confidence for AI. Its state is its latest decision. Own-row read, service-role write.';
comment on table individual_scholar_competency_decision is
  'COMPETEN-SCHOLAR-01 S2. Append-only accept/reject decisions on a mapping, by the student or a reviewer. Corrections are new rows, never edits. Deletable only by cascade from the mapping.';

notify pgrst, 'reload schema';
