-- ====================================================================================================
-- MIGRATION 408: COMPETEN SCHOLAR -- A MAPPING NAMES THE CATALOGUE VERSION AND THE LEARNING OUTCOME, AND A
-- STUDENT CAN CORRECT THE TOPICS FOUND IN THEIR NOTES
--
-- COMPETEN-SCHOLAR-UPLOAD-01 (owner GO 2026-10-24), U3 and U5.
-- U3: a suggestion that a section supports a competency now records WHICH VERSION of the shared catalogue
-- the competency was read from (catalogue_version, the major.minor.revision S1 reports) and, where the AI
-- named one, WHICH of that competency learning outcomes it supports (outcome, the outcome text as the
-- catalogue held it, so the record still says what was meant after the catalogue moves on). The full path
-- Domain, CPU, Competency, Learning Outcome is then answerable for every suggestion. Both are null on rows
-- made before this file (version not recorded, no outcome named) and on rows a student added by hand
-- without an outcome.
-- U5: individual_scholar_topic_correction holds a student own list of the topics in one section, when the
-- AI list was wrong. It REPLACES what the student sees for that section and leaves the AI analysis row in
-- place (provenance). It is personal, private to its owner, erased with the section, and never written to
-- any shared catalogue.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. LOW: two nullable columns with CHECKs, one new
-- table. It depends on 372 and 388. Re-running it is a no-op.
--
-- FAIL CLOSED WITHOUT IT. The store writes catalogue_version and outcome only when they are readable, and
-- offers topic correction only when this table is readable. Rollback:
-- docs/evidence/COMPETEN-SCHOLAR-UPLOAD-01/ROLLBACK-408.sql.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No function. notify pgrst last.
-- ====================================================================================================

alter table individual_scholar_competency_map add column if not exists catalogue_version text;
alter table individual_scholar_competency_map add column if not exists outcome text;

alter table individual_scholar_competency_map drop constraint if exists individual_scholar_competency_map_version_check;
alter table individual_scholar_competency_map add constraint individual_scholar_competency_map_version_check
  check (catalogue_version is null or catalogue_version ~ '^[0-9]+[.][0-9]+[.][0-9]+$');

alter table individual_scholar_competency_map drop constraint if exists individual_scholar_competency_map_outcome_check;
alter table individual_scholar_competency_map add constraint individual_scholar_competency_map_outcome_check
  check (outcome is null or char_length(btrim(outcome)) between 1 and 500);

comment on column individual_scholar_competency_map.catalogue_version is
  'COMPETEN-SCHOLAR-UPLOAD-01 U3. The version (major.minor.revision) of the shared catalogue the competency was read from when this suggestion was made. Null: not recorded (before 408).';
comment on column individual_scholar_competency_map.outcome is
  'COMPETEN-SCHOLAR-UPLOAD-01 U3. The learning outcome of the competency this section supports, as the catalogue worded it at the time. Null: none named.';

create table if not exists individual_scholar_topic_correction (
  chunk_id    uuid primary key,
  user_id     uuid not null,
  topics      text[] not null,
  updated_at  timestamptz not null default now(),
  constraint individual_scholar_topic_correction_chunk_fk foreign key (chunk_id, user_id)
    references individual_scholar_chunk(id, user_id) on delete cascade
);

alter table individual_scholar_topic_correction drop constraint if exists individual_scholar_topic_correction_topics_check;
alter table individual_scholar_topic_correction add constraint individual_scholar_topic_correction_topics_check
  check (cardinality(topics) <= 12 and array_position(topics, null) is null);

create index if not exists idx_individual_scholar_topic_correction_user
  on individual_scholar_topic_correction(user_id);

alter table individual_scholar_topic_correction enable row level security;

drop policy if exists individual_scholar_topic_correction_read_own on individual_scholar_topic_correction;
create policy individual_scholar_topic_correction_read_own on individual_scholar_topic_correction
  for select using (auth.uid() = user_id);

comment on table individual_scholar_topic_correction is
  'COMPETEN-SCHOLAR-UPLOAD-01 U5. A Scholar student own topics for one section of their notes, replacing the AI list in what they see. The AI analysis row is kept. Personal, erased with the section, never written to a shared catalogue.';

notify pgrst, 'reload schema';
