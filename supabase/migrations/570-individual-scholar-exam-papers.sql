-- ====================================================================================================
-- MIGRATION 570: COMPETEN SCHOLAR -- STUDYING UPLOADED EXAMINATION PAPERS
--
-- COMPETEN-SCHOLAR-EXAM-PAPERS-01, owner directive 2026-10-26 ("Scholar exam paper learning and evidence
-- research"). Build record: docs/COMPETEN-SCHOLAR-EXAM-PAPERS-01.md.
--
-- APPLY ON STAGING FIRST. Production only under its own owner GO. LOW: four new tables, no trigger, no function.
-- No existing table or row is changed. It depends on profiles, 372 (individual_scholar_material, _chunk and
-- _question with their (id, user_id) keys). Re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR.
--
-- A student may study a past or practice examination paper they uploaded as an ordinary Scholar material (372).
-- What did not exist is the STRUCTURE of the paper and what the student did with it:
--
--   individual_scholar_exam_paper      one material the student chose to study as an examination paper, with
--                                      the practice-paper attestation they gave (not a live examination, and
--                                      they may use it), the printed instructions of the paper and what could not
--                                      be read (flags). One row per material.
--   individual_scholar_exam_question   each question as printed: its number, section, instructions, stem,
--                                      answer options, marks and pages, the section of the material it was read
--                                      from, and flags for anything not read (a figure, an unreadable page). A
--                                      question transcribed from a scanned page names that source.
--   individual_scholar_exam_answer     a saved suggested answer (or a revision guide for the paper): the
--                                      attempt of the student when they made one first, the answer and its
--                                      explanation, the evidence it cites with dates and provenance, conflicts,
--                                      uncertainty and the model that wrote it. Private formative, by CHECK.
--   individual_scholar_research_cache  PUBLIC web research results, reusable across students: sources only
--                                      (address, title, publisher, dates, a short excerpt), keyed by a hash.
--                                      It holds no user id, no uploaded text, no notes and no answer.
--
-- NOT COMPETENCE. A suggested answer is AI-written study material, never an answer key, a mark or verified
-- competence. review_status can only be private_formative.
--
-- PRIVACY. The three student tables are own-row read under RLS, written only by the service role, and go with
-- the material (cascade) and the person (profiles cascade). The research cache has RLS on and no policy:
-- service role only, and nothing in it identifies anyone.
-- ====================================================================================================

-- ---- 1. the paper -----------------------------------------------------------------------------------

create table if not exists individual_scholar_exam_paper (
  material_id          uuid not null,
  user_id              uuid not null references profiles(id) on delete cascade,
  attestation_version  text not null,
  attested_at          timestamptz not null,
  extractor            text not null,
  question_count       integer not null,
  instructions         text,
  flags                jsonb not null default '[]'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint individual_scholar_exam_paper_pkey primary key (material_id),
  constraint individual_scholar_exam_paper_material_fk foreign key (material_id, user_id)
    references individual_scholar_material(id, user_id) on delete cascade
);

create unique index if not exists ux_individual_scholar_exam_paper_material_user
  on individual_scholar_exam_paper(material_id, user_id);

alter table individual_scholar_exam_paper drop constraint if exists individual_scholar_exam_paper_check;
alter table individual_scholar_exam_paper add constraint individual_scholar_exam_paper_check
  check (char_length(attestation_version) between 1 and 40
     and char_length(extractor) between 1 and 80
     and question_count between 0 and 300
     and (instructions is null or char_length(instructions) between 1 and 4000)
     and jsonb_typeof(flags) = 'array' and octet_length(flags::text) <= 20000);

create index if not exists idx_individual_scholar_exam_paper_user
  on individual_scholar_exam_paper(user_id, created_at desc);

alter table individual_scholar_exam_paper enable row level security;
drop policy if exists individual_scholar_exam_paper_read_own on individual_scholar_exam_paper;
create policy individual_scholar_exam_paper_read_own on individual_scholar_exam_paper
  for select using (auth.uid() = user_id);

comment on table individual_scholar_exam_paper is
  'COMPETEN-SCHOLAR-EXAM-PAPERS-01 (570). A Scholar material the student studies as a past or practice examination paper: the practice-paper attestation they gave, the printed instructions, and what could not be read (flags). Private, own-row. Erased with its material.';

-- ---- 2. the questions as printed --------------------------------------------------------------------

create table if not exists individual_scholar_exam_question (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  material_id   uuid not null,
  ordinal       integer not null,
  number        text not null,
  section       text,
  instructions  text,
  stem          text not null,
  options       jsonb not null default '[]'::jsonb,
  marks         numeric,
  page_from     integer,
  page_to       integer,
  chunk_id      uuid,
  source        text not null,
  flags         jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  constraint individual_scholar_exam_question_paper_fk foreign key (material_id, user_id)
    references individual_scholar_exam_paper(material_id, user_id) on delete cascade,
  constraint individual_scholar_exam_question_chunk_fk foreign key (chunk_id, user_id)
    references individual_scholar_chunk(id, user_id) on delete set null (chunk_id)
);

create unique index if not exists ux_individual_scholar_exam_question_id_user
  on individual_scholar_exam_question(id, user_id);
create unique index if not exists ux_individual_scholar_exam_question_ordinal
  on individual_scholar_exam_question(material_id, ordinal);

alter table individual_scholar_exam_question drop constraint if exists individual_scholar_exam_question_check;
alter table individual_scholar_exam_question add constraint individual_scholar_exam_question_check
  check (ordinal between 1 and 300
     and char_length(number) between 1 and 40
     and (section is null or char_length(section) between 1 and 200)
     and (instructions is null or char_length(instructions) between 1 and 2000)
     and char_length(stem) between 1 and 8000
     and jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 10 and octet_length(options::text) <= 20000
     and (marks is null or marks between 0 and 1000)
     and (page_from is null or page_from > 0) and (page_to is null or page_to >= coalesce(page_from, 1))
     and source in ('text_layer', 'ai_transcription')
     and jsonb_typeof(flags) = 'array' and octet_length(flags::text) <= 4000);

alter table individual_scholar_exam_question enable row level security;
drop policy if exists individual_scholar_exam_question_read_own on individual_scholar_exam_question;
create policy individual_scholar_exam_question_read_own on individual_scholar_exam_question
  for select using (auth.uid() = user_id);

comment on table individual_scholar_exam_question is
  'COMPETEN-SCHOLAR-EXAM-PAPERS-01 (570). One examination question as printed in a paper the student uploaded: number, section, instructions, stem, options, marks, pages, the section it was read from (or ai_transcription when transcribed from a scanned page), and flags for anything not read. Never an answer key. Private, own-row.';

-- ---- 3. saved suggested answers and revision guides -------------------------------------------------

create table if not exists individual_scholar_exam_answer (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references profiles(id) on delete cascade,
  material_id            uuid not null,
  question_id            uuid,
  kind                   text not null,
  attempt                jsonb,
  content                jsonb not null,
  evidence               jsonb not null default '[]'::jsonb,
  research               jsonb not null default '{}'::jsonb,
  model                  text not null,
  provider               text not null,
  prompt_version         text not null,
  review_status          text not null default 'private_formative',
  revision_question_id   uuid,
  created_at             timestamptz not null default now(),
  constraint individual_scholar_exam_answer_paper_fk foreign key (material_id, user_id)
    references individual_scholar_exam_paper(material_id, user_id) on delete cascade,
  constraint individual_scholar_exam_answer_question_fk foreign key (question_id, user_id)
    references individual_scholar_exam_question(id, user_id) on delete cascade,
  constraint individual_scholar_exam_answer_revision_fk foreign key (revision_question_id, user_id)
    references individual_scholar_question(id, user_id) on delete set null (revision_question_id)
);

create unique index if not exists ux_individual_scholar_exam_answer_id_user
  on individual_scholar_exam_answer(id, user_id);

alter table individual_scholar_exam_answer drop constraint if exists individual_scholar_exam_answer_check;
alter table individual_scholar_exam_answer add constraint individual_scholar_exam_answer_check
  check (kind in ('answer', 'guide')
     and ((kind = 'answer') = (question_id is not null))
     and (attempt is null or (jsonb_typeof(attempt) = 'object' and octet_length(attempt::text) <= 10000))
     and jsonb_typeof(content) = 'object' and octet_length(content::text) <= 60000
     and jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 30 and octet_length(evidence::text) <= 60000
     and jsonb_typeof(research) = 'object' and octet_length(research::text) <= 4000
     and char_length(model) between 1 and 200 and char_length(provider) between 1 and 100
     and char_length(prompt_version) between 1 and 100
     and review_status = 'private_formative');

create index if not exists idx_individual_scholar_exam_answer_question
  on individual_scholar_exam_answer(user_id, question_id, created_at desc);
create index if not exists idx_individual_scholar_exam_answer_material
  on individual_scholar_exam_answer(user_id, material_id, created_at desc);

alter table individual_scholar_exam_answer enable row level security;
drop policy if exists individual_scholar_exam_answer_read_own on individual_scholar_exam_answer;
create policy individual_scholar_exam_answer_read_own on individual_scholar_exam_answer
  for select using (auth.uid() = user_id);

comment on table individual_scholar_exam_answer is
  'COMPETEN-SCHOLAR-EXAM-PAPERS-01 (570). A saved AI-suggested answer to one examination question (kind answer), or a revision guide for a paper (kind guide): the student attempt when made first, the answer and explanation, the cited evidence with dates and provenance, conflicts and uncertainty, and the model. Private formative only (CHECK). Never an answer key, a mark or verified competence. Erased with its paper.';

-- ---- 4. the shared PUBLIC research cache --------------------------------------------------------------

create table if not exists individual_scholar_research_cache (
  query_hash      text primary key,
  provider        text not null,
  policy_version  text not null,
  sources         jsonb not null,
  searches        integer not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);

alter table individual_scholar_research_cache drop constraint if exists individual_scholar_research_cache_check;
alter table individual_scholar_research_cache add constraint individual_scholar_research_cache_check
  check (query_hash ~ '^[0-9a-f]{64}$'
     and char_length(provider) between 1 and 100 and char_length(policy_version) between 1 and 200
     and jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 20 and octet_length(sources::text) <= 40000
     and searches between 0 and 20
     and expires_at > created_at);

create index if not exists idx_individual_scholar_research_cache_expiry
  on individual_scholar_research_cache(expires_at);

alter table individual_scholar_research_cache enable row level security;

comment on table individual_scholar_research_cache is
  'COMPETEN-SCHOLAR-EXAM-PAPERS-01 (570). Public web research results reused across students: sources only (address, title, publisher, dates, short excerpt), keyed by the sha256 of the research request. No user id, no uploaded text, no notes and no answers. Service role only (RLS on, no policy).';

notify pgrst, 'reload schema';
