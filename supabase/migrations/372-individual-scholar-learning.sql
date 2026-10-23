-- ====================================================================================================
-- MIGRATION 372: COMPETEN SCHOLAR LEARNING -- UPLOAD, UNDERSTAND, ASSESS, REVISE, APPLY, IMPROVE
--
-- COMPETEN-IND-004 (Scholar Learning MVP), COMPETEN-IND-002 sections 3.2 and 3.3, ADR-016 owner rulings
-- D1, D6 and D10. Build record: docs/COMPETEN-IND-004-scholar-learning-mvp.md.
--
-- APPLY ON STAGING FIRST. It creates six new tables and one private storage bucket. It alters no
-- existing table, row, policy or constraint, and depends only on profiles (migration 001) and on the
-- storage schema. It does NOT depend on migration 370 or on 373 (Professional), so the three may be
-- applied in any order. Re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- A Scholar student can upload their own notes, have them read back to them with page citations, be
-- questioned on them, revise what they missed on a spaced schedule and see their own progress -- and
-- none of it lands in a table the hospital learning analytics reads.
--
-- ----------------------------------------------------------------------------------------------------
-- THE SHAPE.
--
--   individual_scholar_consent    Revocable consent of the person to AI processing of their uploads.
--                                 The migration-215 per-feature switch, per person instead of per
--                                 workspace. Absent or revoked means no AI call touches their material.
--   individual_scholar_material   One uploaded PDF or DOCX. The original file sits in the private bucket
--                                 individual-scholar-materials under <user_id>/.
--   individual_scholar_chunk      The extracted text, in page-referenced chunks, with a generated
--                                 tsvector so retrieval is Postgres full-text search (no embedding key).
--   individual_scholar_question   An AI-generated question (multiple choice, or a case-style question for
--                                 Apply), with the chunk it came from, the model and the prompt version.
--   individual_scholar_attempt    One answer to one question.
--   individual_scholar_card       A spaced-review card (SM-2) for a question the person missed.
--
-- ----------------------------------------------------------------------------------------------------
-- OWNERSHIP IS IN THE SCHEMA, NOT ONLY IN THE APPLICATION.
--
-- Every child row carries user_id AND a composite foreign key (parent_id, user_id) to the
-- parent (id, user_id). A chunk, question, attempt or card that belongs to one person but points at the
-- material of another person cannot be stored, whoever writes it. Deleting a material cascades through every row
-- derived from it, so erasure by the owner is one delete plus the storage object.
--
-- ----------------------------------------------------------------------------------------------------
-- HOUSE RULES (scripts/migration-house-rules.ts), CHECKED BY RUNNING IT, NOT BY EYE.
--
--   1. ASCII only. No semicolons inside any comment or string literal.
--   2. No plpgsql, no do-blocks, no functions. So no APPLY-WHOLE banner is required.
--   3. No partial unique indexes. Every unique index is FULL, on NOT NULL columns.
--   4. RLS ON, own-row SELECT policies only (owner ruling D6). No INSERT, UPDATE or DELETE policy.
--      Writes happen with the service role, behind requireIndividualContext, or not at all.
--   5. notify pgrst LAST.
--
-- OWNER RULINGS ENFORCED HERE:
--
--   D1   Separate individual_* tables. Nothing here is written to quiz_attempts, knowledge_attempts,
--        cdp_reinforcement_cards, cpd_logs or any other table learning-analytics reads by hospital.
--   D6   RLS on every table, own-row select only.
--   D10  No conversation is stored. Explanations are not persisted. Questions are stored because they
--        are study artefacts the person answers again, each with its source chunk, model and prompt.
--
-- NOT IN THIS FILE, ON PURPOSE: any reviewed-clinical-content table. Shared clinical content
-- (clinical_cases) has no clinical-review record yet (COMPETEN-IND-002 s3.3), so Scholar serves none
-- of it, and that record is a separate governance decision.
-- ====================================================================================================


-- ---- 1. individual_scholar_consent -- AI PROCESSING OF UPLOADS, REVOCABLE ---------------------------

create table if not exists individual_scholar_consent (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  feature text not null,
  status text not null,
  notice_version text not null,
  granted_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table individual_scholar_consent drop constraint if exists individual_scholar_consent_feature_check;
alter table individual_scholar_consent add constraint individual_scholar_consent_feature_check
  check (feature in ('ai_processing_uploads'));

alter table individual_scholar_consent drop constraint if exists individual_scholar_consent_status_check;
alter table individual_scholar_consent add constraint individual_scholar_consent_status_check
  check (status in ('granted', 'revoked'));

-- A revoked consent says when, and a granted one carries no revocation time.
alter table individual_scholar_consent drop constraint if exists individual_scholar_consent_revoked_when;
alter table individual_scholar_consent add constraint individual_scholar_consent_revoked_when
  check ((status = 'revoked') = (revoked_at is not null));

create unique index if not exists ux_individual_scholar_consent_user_feature
  on individual_scholar_consent(user_id, feature);

alter table individual_scholar_consent enable row level security;

drop policy if exists individual_scholar_consent_read_own on individual_scholar_consent;
create policy individual_scholar_consent_read_own on individual_scholar_consent
  for select using (auth.uid() = user_id);

comment on table individual_scholar_consent is
  'COMPETEN-IND-004. A person''s revocable consent to AI processing of their Scholar uploads (the migration-215 per-feature consent pattern, per person). No row, or status revoked, means no AI call reads their material. Every change is also written to audit_log.';
comment on column individual_scholar_consent.notice_version is
  'Which consent notice the person was shown when they last granted it, so what was consented to can be shown, not merely that something was.';


-- ---- 2. individual_scholar_material -- ONE UPLOADED FILE -------------------------------------------

create table if not exists individual_scholar_material (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  file_name text not null,
  mime_type text not null,
  byte_size integer not null,
  sha256 text not null,
  storage_path text not null,
  page_count integer,
  chunk_count integer not null,
  char_count integer not null,
  extractor text not null,
  pii_attested_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table individual_scholar_material drop constraint if exists individual_scholar_material_mime_check;
alter table individual_scholar_material add constraint individual_scholar_material_mime_check
  check (mime_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));

-- The same 10 MB cap the bucket enforces, so a second writer cannot store a larger record.
alter table individual_scholar_material drop constraint if exists individual_scholar_material_size_check;
alter table individual_scholar_material add constraint individual_scholar_material_size_check
  check (byte_size > 0 and byte_size <= 10485760);

-- A PDF has pages. A DOCX does not have reliable ones, so its chunks cite a section number instead.
alter table individual_scholar_material drop constraint if exists individual_scholar_material_pages_check;
alter table individual_scholar_material add constraint individual_scholar_material_pages_check
  check ((mime_type = 'application/pdf') = (page_count is not null) and (page_count is null or page_count > 0));

-- A material with nothing extracted is not stored. A scanned PDF with no text layer is refused at upload.
alter table individual_scholar_material drop constraint if exists individual_scholar_material_text_check;
alter table individual_scholar_material add constraint individual_scholar_material_text_check
  check (chunk_count > 0 and char_count > 0);

-- The object lives under the own folder of the owner of the private bucket, and nowhere else.
alter table individual_scholar_material drop constraint if exists individual_scholar_material_path_check;
alter table individual_scholar_material add constraint individual_scholar_material_path_check
  check (storage_path like (user_id::text || '/%'));

create unique index if not exists ux_individual_scholar_material_id_user
  on individual_scholar_material(id, user_id);
create unique index if not exists ux_individual_scholar_material_path
  on individual_scholar_material(storage_path);
create index if not exists idx_individual_scholar_material_user
  on individual_scholar_material(user_id, created_at desc);

alter table individual_scholar_material enable row level security;

drop policy if exists individual_scholar_material_read_own on individual_scholar_material;
create policy individual_scholar_material_read_own on individual_scholar_material
  for select using (auth.uid() = user_id);

comment on table individual_scholar_material is
  'COMPETEN-IND-004. A study file a Scholar student uploaded for their own use. Private to its owner and erasable by them: deleting the row cascades through its chunks, questions, attempts and cards. Never presented as reviewed content.';
comment on column individual_scholar_material.pii_attested_at is
  'When the person confirmed the file holds no patient-identifiable information. NOT NULL: a material cannot be stored without it. The upload also runs a pattern check, which is not exhaustive.';


-- ---- 3. individual_scholar_chunk -- PAGE-REFERENCED TEXT, SEARCHABLE ---------------------------------

create table if not exists individual_scholar_chunk (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null,
  user_id uuid not null,
  ordinal integer not null,
  page_from integer,
  page_to integer,
  content text not null,
  tsv tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  constraint individual_scholar_chunk_material_fk foreign key (material_id, user_id)
    references individual_scholar_material(id, user_id) on delete cascade
);

alter table individual_scholar_chunk drop constraint if exists individual_scholar_chunk_pages_check;
alter table individual_scholar_chunk add constraint individual_scholar_chunk_pages_check
  check ((page_from is null) = (page_to is null) and (page_from is null or (page_from > 0 and page_to >= page_from)));

alter table individual_scholar_chunk drop constraint if exists individual_scholar_chunk_content_check;
alter table individual_scholar_chunk add constraint individual_scholar_chunk_content_check
  check (length(content) > 0 and ordinal > 0);

create unique index if not exists ux_individual_scholar_chunk_ordinal
  on individual_scholar_chunk(material_id, ordinal);
create unique index if not exists ux_individual_scholar_chunk_id_user
  on individual_scholar_chunk(id, user_id);
create index if not exists idx_individual_scholar_chunk_user
  on individual_scholar_chunk(user_id);
create index if not exists idx_individual_scholar_chunk_tsv
  on individual_scholar_chunk using gin(tsv);

alter table individual_scholar_chunk enable row level security;

drop policy if exists individual_scholar_chunk_read_own on individual_scholar_chunk;
create policy individual_scholar_chunk_read_own on individual_scholar_chunk
  for select using (auth.uid() = user_id);

comment on table individual_scholar_chunk is
  'COMPETEN-IND-004. Extracted text of one Scholar material, in order. page_from and page_to cite the PDF page, and are null for a DOCX (cited by section number). The composite foreign key makes a chunk pointing at another person''s material unstorable.';


-- ---- 4. individual_scholar_question -- AI-GENERATED, WITH ITS SOURCE ---------------------------------

create table if not exists individual_scholar_question (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  material_id uuid not null,
  chunk_id uuid not null,
  kind text not null,
  stem text not null,
  options jsonb not null,
  correct_index integer not null,
  rationale text not null,
  source_quote text not null,
  model text not null,
  provider text not null,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  constraint individual_scholar_question_material_fk foreign key (material_id, user_id)
    references individual_scholar_material(id, user_id) on delete cascade,
  constraint individual_scholar_question_chunk_fk foreign key (chunk_id, user_id)
    references individual_scholar_chunk(id, user_id) on delete cascade
);

alter table individual_scholar_question drop constraint if exists individual_scholar_question_kind_check;
alter table individual_scholar_question add constraint individual_scholar_question_kind_check
  check (kind in ('mcq', 'case'));

alter table individual_scholar_question drop constraint if exists individual_scholar_question_options_check;
alter table individual_scholar_question add constraint individual_scholar_question_options_check
  check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4 and correct_index between 0 and 3);

create unique index if not exists ux_individual_scholar_question_id_user
  on individual_scholar_question(id, user_id);
create index if not exists idx_individual_scholar_question_material
  on individual_scholar_question(user_id, material_id, created_at desc);

alter table individual_scholar_question enable row level security;

drop policy if exists individual_scholar_question_read_own on individual_scholar_question;
create policy individual_scholar_question_read_own on individual_scholar_question
  for select using (auth.uid() = user_id);

comment on table individual_scholar_question is
  'COMPETEN-IND-004, COMPETEN-IND-002 s3.3. A question generated from ONE chunk of the person''s own material. Stores the chunk, the quoted source, the model the provider reported and the prompt version. Only questions that passed the grounding check are stored. Not clinically reviewed.';


-- ---- 5. individual_scholar_attempt -- ONE ANSWER ------------------------------------------------------

create table if not exists individual_scholar_attempt (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  question_id uuid not null,
  chosen_index integer not null,
  correct boolean not null,
  answered_at timestamptz not null default now(),
  constraint individual_scholar_attempt_question_fk foreign key (question_id, user_id)
    references individual_scholar_question(id, user_id) on delete cascade
);

alter table individual_scholar_attempt drop constraint if exists individual_scholar_attempt_choice_check;
alter table individual_scholar_attempt add constraint individual_scholar_attempt_choice_check
  check (chosen_index between 0 and 3);

create index if not exists idx_individual_scholar_attempt_user
  on individual_scholar_attempt(user_id, answered_at desc);
create index if not exists idx_individual_scholar_attempt_question
  on individual_scholar_attempt(question_id, answered_at desc);

alter table individual_scholar_attempt enable row level security;

drop policy if exists individual_scholar_attempt_read_own on individual_scholar_attempt;
create policy individual_scholar_attempt_read_own on individual_scholar_attempt
  for select using (auth.uid() = user_id);

comment on table individual_scholar_attempt is
  'COMPETEN-IND-004. Self-directed study only. Not an assessment outcome, not verified, and never copied into quiz_attempts or knowledge_attempts (owner ruling D1).';


-- ---- 6. individual_scholar_card -- SPACED REVIEW (SM-2) ----------------------------------------------

create table if not exists individual_scholar_card (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  question_id uuid not null,
  material_id uuid not null,
  ease_factor numeric not null default 2.5,
  interval_days integer not null default 0,
  repetitions integer not null default 0,
  reviews integer not null default 0,
  next_review_at date not null,
  last_reviewed_at timestamptz,
  last_quality integer,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint individual_scholar_card_question_fk foreign key (question_id, user_id)
    references individual_scholar_question(id, user_id) on delete cascade,
  constraint individual_scholar_card_material_fk foreign key (material_id, user_id)
    references individual_scholar_material(id, user_id) on delete cascade
);

alter table individual_scholar_card drop constraint if exists individual_scholar_card_status_check;
alter table individual_scholar_card add constraint individual_scholar_card_status_check
  check (status in ('active', 'mastered'));

alter table individual_scholar_card drop constraint if exists individual_scholar_card_sm2_check;
alter table individual_scholar_card add constraint individual_scholar_card_sm2_check
  check (ease_factor >= 1.3 and interval_days >= 0 and repetitions >= 0 and reviews >= 0
     and (last_quality is null or last_quality between 0 and 5));

-- One card per question. A question missed twice reschedules its card, it does not duplicate it.
create unique index if not exists ux_individual_scholar_card_question
  on individual_scholar_card(question_id);
create index if not exists idx_individual_scholar_card_due
  on individual_scholar_card(user_id, status, next_review_at);

alter table individual_scholar_card enable row level security;

drop policy if exists individual_scholar_card_read_own on individual_scholar_card;
create policy individual_scholar_card_read_own on individual_scholar_card
  for select using (auth.uid() = user_id);

comment on table individual_scholar_card is
  'COMPETEN-IND-004. A spaced-review card for a question the person missed, scheduled by the SM-2 logic in src/lib/delivery/reinforcement.ts. Separate from cdp_reinforcement_cards, which hospitals read (owner ruling D1).';


-- ---- 7. THE PRIVATE BUCKET ---------------------------------------------------------------------------
--
-- Private, 10 MB, PDF and DOCX only. No storage policy is created, so no browser session can read or
-- write it. The service role writes under <user_id>/ after the gate-3 guard, and serves the owner a
-- short-lived signed URL. The migration-336 shape.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'individual-scholar-materials', 'individual-scholar-materials', false, 10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
