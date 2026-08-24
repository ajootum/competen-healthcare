-- 357 PRACTICE DOCUMENT STYLE PROFILES, AND WHAT EACH DOCUMENT WAS RENDERED WITH
--
-- CPR-DOC-CONFIG-001 sections 2, 11 and 14, Phase 1.
--
-- WHAT EXISTS TODAY. Five plain-text letterhead fields on practice_configuration
-- and a print view that centres them above the body. There is no colour, no
-- typography choice, no section treatment and no notion of a house style. A
-- practitioner who wants their referral letters to look like their practice has
-- no control at all, which is what this specification is answering.
--
-- STRUCTURED TOKENS, NOT A STYLESHEET. Section 14: "Implement configuration as
-- structured, versioned design tokens rather than stored HTML/CSS blobs", and
-- "No arbitrary script, CSS, HTML or remote font injection." The tokens column is
-- validated against a schema in the application before it is written, and the
-- renderer maps tokens to a fixed set of classes. Nothing a practitioner types
-- becomes markup. A jsonb column would happily hold a stylesheet, so the guard
-- is the writer and the schema, and both are tested.
--
-- ONE PUBLISHED STYLE PER PRACTICE, MADE UNREPRESENTABLE RATHER THAN POLICED.
-- The obvious spelling is a partial unique index on status = 'published', which
-- this repository's migration house rules ban. The generated published_slot
-- column gets the same guarantee from a plain unique index: it holds the
-- workspace id only while the row is published, and NULL otherwise, and NULLs do
-- not collide. A second published style for one practice cannot be inserted.
--
-- WHY THE VERSION PIN IS ON THE DOCUMENT. Section 11: "Existing signed/issued
-- documents must never be visually rewritten when a style changes." A document
-- that merely pointed at "the practice style" would be re-rendered by the next
-- publish, silently changing the appearance of a letter somebody has already
-- signed and sent. Pinning the version the document was rendered with makes that
-- impossible, and section 11 also asks for it directly: "Issued document
-- provenance should include the style/template version used to render it."
--
-- WHY content_model IS SEPARATE FROM body, AND WHY body DOES NOT CHANGE.
-- Migration 195 chose plain text on purpose and said why: "this is a clinical
-- record that must be readable in fifty years and diffable today, and a rich-text
-- blob is neither." That decision stands. body remains exactly the text that is
-- composed, signed and diffed. content_model is the SAME content expressed as
-- structure, so the renderer can put a diagnosis section in the diagnosis colour
-- instead of guessing from a string. It is a rendering aid, never a source of
-- truth: the application derives body FROM the blocks with one function, and a
-- test asserts the two cannot disagree. A document with no content_model -- every
-- document that already exists -- renders exactly as it does today.

-- ---- 1. The style profile ---------------------------------------------------------

create table if not exists practice_document_style (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  -- Human-facing name, so a practice can keep "Winter 2026" beside "Professional".
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- Monotonic per practice. Section 11: "Every published configuration receives a
  -- version ID and timestamp."
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  -- The design tokens. Validated against the application schema before write.
  tokens jsonb not null default '{}'::jsonb,
  -- Which preset it started from, for "restore this preset" and for telling a
  -- practitioner what they are looking at. Not a constraint on the tokens.
  preset text check (preset is null or preset in ('professional', 'classic', 'modern', 'minimal', 'practice_brand')),
  published_at timestamptz,
  published_by uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  -- See the header. The workspace id while published, NULL otherwise, so a plain
  -- unique index enforces one-published-per-practice without a partial index.
  published_slot uuid generated always as
    (case when status = 'published' then workspace_id else null end) stored
);

alter table practice_document_style enable row level security;

create unique index if not exists practice_document_style_one_published
  on practice_document_style (published_slot);

create unique index if not exists practice_document_style_version
  on practice_document_style (workspace_id, version);

create index if not exists practice_document_style_workspace
  on practice_document_style (workspace_id, status, version desc);

-- ---- 2. What a document was rendered with -----------------------------------------

alter table practice_clinical_document
  add column if not exists style_id uuid
  references practice_document_style(id) on delete set null;

-- The structure behind the body. Null for every document that predates this, and
-- the renderer falls back to plain text for those -- which is what it does now.
alter table practice_clinical_document
  add column if not exists content_model jsonb;

create index if not exists practice_clinical_document_style_idx
  on practice_clinical_document (workspace_id, style_id);

notify pgrst, 'reload schema';
