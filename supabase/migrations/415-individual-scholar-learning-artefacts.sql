-- ====================================================================================================
-- MIGRATION 415: COMPETEN SCHOLAR -- THE LEARNING ARTEFACT LIBRARY (SAVED EXPLANATIONS AND SUMMARIES)
--
-- COMPETEN-AI-FAIR-USE-01 s8, inside COMPETEN-SCHOLAR-LEARN-01 (owner GOs 2026-10-24): persist reusable learning
-- outputs with their source references, competency relationships, generation provenance and review status, and do
-- not regenerate identical content. Flashcards (372 cards), question sets and cases (372, 388 questions) and learning
-- plans (414 sessions and steps) are ALREADY stored. This file adds the one kind that was not: the explanations a
-- student is given by the Learn actions -- teach, explain, simplify, go deeper, give examples, summarise.
--
-- WHAT AN ARTEFACT IS. The part from the notes, cited [S n] to its sources in order (artefact_source), the AI
-- background shown apart (if any), the AI flags (if any), a snapshot of the governed references it named (the
-- competency, the outcome, the review state, as shown), the depth, the model and the prompt version. Conversation
-- is NOT an artefact: what a student asks and the answers to it, and their answers to a check, are not stored.
--
-- PRIVATE FORMATIVE, NEVER APPROVED. review_status can only be private_formative -- the CHECK makes an approved or
-- reviewed artefact unstorable. Nothing here is assessment, competence or Passport evidence.
--
-- NOT REGENERATED. dedupe_key (the action, the depth, the sections, the prompt version and the references, hashed by
-- the application) is unique per student: the same request returns the saved artefact instead of a new AI call,
-- unless the student asks for a new one, which replaces it.
--
-- PRIVATE AND ERASABLE. Own rows, RLS read-own. The artefact belongs to the material its sections come from
-- (composite foreign key, ON DELETE CASCADE) and each source to its chunk: deleting the material, or erasing
-- everything, removes them.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. LOW: two new tables, nothing existing is altered.
-- It depends on 372 (material, chunk) and profiles. Re-running it is a no-op.
--
-- FAIL CLOSED WITHOUT IT. Learn answers as before and saves nothing where these tables are absent, and says so.
-- Rollback: docs/evidence/COMPETEN-SCHOLAR-LEARN-01/ROLLBACK-415.sql.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No function. notify pgrst last.
-- ====================================================================================================

create table if not exists individual_scholar_artefact (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  material_id     uuid not null,
  action          text not null,
  depth           text not null,
  content         text not null,
  background      text,
  flags           jsonb not null default '[]'::jsonb,
  refs            jsonb not null default '[]'::jsonb,
  dedupe_key      text not null,
  model           text not null,
  prompt_version  text not null,
  review_status   text not null default 'private_formative',
  created_at      timestamptz not null default now(),
  constraint individual_scholar_artefact_material_fk foreign key (material_id, user_id)
    references individual_scholar_material(id, user_id) on delete cascade
);

alter table individual_scholar_artefact drop constraint if exists individual_scholar_artefact_kind_check;
alter table individual_scholar_artefact add constraint individual_scholar_artefact_kind_check
  check (action in ('teach', 'explain', 'simplify', 'deeper', 'examples', 'summary')
     and depth in ('brief', 'standard', 'detailed')
     and review_status = 'private_formative');

alter table individual_scholar_artefact drop constraint if exists individual_scholar_artefact_content_check;
alter table individual_scholar_artefact add constraint individual_scholar_artefact_content_check
  check (char_length(content) between 1 and 20000
     and (background is null or char_length(background) between 1 and 2000)
     and jsonb_typeof(flags) = 'array' and jsonb_typeof(refs) = 'array'
     and dedupe_key ~ '^[0-9a-f]{64}$'
     and char_length(model) between 1 and 200 and char_length(prompt_version) between 1 and 200);

create unique index if not exists ux_individual_scholar_artefact_id_user
  on individual_scholar_artefact(id, user_id);
create unique index if not exists ux_individual_scholar_artefact_dedupe
  on individual_scholar_artefact(user_id, dedupe_key);
create index if not exists idx_individual_scholar_artefact_material
  on individual_scholar_artefact(user_id, material_id, created_at desc);

create table if not exists individual_scholar_artefact_source (
  artefact_id  uuid not null,
  user_id      uuid not null,
  ordinal      integer not null,
  chunk_id     uuid not null,
  constraint individual_scholar_artefact_source_pk primary key (artefact_id, ordinal),
  constraint individual_scholar_artefact_source_artefact_fk foreign key (artefact_id, user_id)
    references individual_scholar_artefact(id, user_id) on delete cascade,
  constraint individual_scholar_artefact_source_chunk_fk foreign key (chunk_id, user_id)
    references individual_scholar_chunk(id, user_id) on delete cascade
);

alter table individual_scholar_artefact_source drop constraint if exists individual_scholar_artefact_source_ordinal_check;
alter table individual_scholar_artefact_source add constraint individual_scholar_artefact_source_ordinal_check check (ordinal between 1 and 10);

create index if not exists idx_individual_scholar_artefact_source_chunk on individual_scholar_artefact_source(user_id, chunk_id);

alter table individual_scholar_artefact enable row level security;
alter table individual_scholar_artefact_source enable row level security;

drop policy if exists individual_scholar_artefact_read_own on individual_scholar_artefact;
create policy individual_scholar_artefact_read_own on individual_scholar_artefact for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_artefact_source_read_own on individual_scholar_artefact_source;
create policy individual_scholar_artefact_source_read_own on individual_scholar_artefact_source for select using (auth.uid() = user_id);

comment on table individual_scholar_artefact is
  'COMPETEN-AI-FAIR-USE-01 s8 / COMPETEN-SCHOLAR-LEARN-01. A saved explanation or summary from a Learn action, with its sources, governed references, provenance and review status (private formative only, by CHECK). Deduplicated per student. Erased with its material. Never assessment or competence.';

notify pgrst, 'reload schema';
