-- ============================================================
-- MIGRATION 207: AUTOSAVE, SMART TEXT AND ATTACHMENTS (CPR-130, the requirements that were designed against)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- AUTOSAVE WAS EXPLICITLY DESIGNED AGAINST BY SOMEBODY WHO HAD NOT READ THE REQUIREMENT.
--
-- CPR-130 s3 lists Autosave first among its functional requirements, and CPR-360's comp independently
-- sets "Auto-save Interval: 2 minutes". The argument used to refuse it was real but was answering a
-- different question: with an append-only version history, saving every two minutes would write a
-- version every two minutes, and a note somebody worked on for an hour would bury its thirty meaningful
-- versions under nothing. See CPR-AUDIT-001-spec-conformance.md.
--
-- THE RESOLUTION IS THAT A DRAFT IS NOT A VERSION. They are different objects answering different
-- questions:
--   a VERSION answers "what did the record say at 10:55, and who wrote it" -- deliberate, immutable,
--     append-only, part of the clinical record;
--   a DRAFT answers "what was in the box when the browser closed" -- overwritten in place, private to
--     its author, and NOT part of the record until somebody saves it.
--
-- So autosave writes to practice_note_draft, which has exactly one row per author per segment and is
-- overwritten every time. The version history stays exactly as clean as it was, and an hour of work
-- survives a closed laptop. Nothing about saveNoteSegment changes.
--
-- A DRAFT IS NEVER CLINICAL CONTENT. It is not readable by colleagues, it does not appear in the note,
-- it is not exported, and it is deleted the moment its text reaches a version. A draft that could be
-- mistaken for the record would be worse than losing the text.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. The draft ------------------------------------------------------------------------------------
--
-- ONE ROW PER (ENCOUNTER, SEGMENT, AUTHOR). Per author because two clinicians typing into the same
-- consultation must not overwrite each other's unsaved text -- which is exactly the accident autosave
-- would otherwise introduce, silently, at the moment somebody stepped away from a shared screen.

create table if not exists practice_note_draft (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  encounter_id uuid not null references practice_encounter(id) on delete cascade,
  note_type text not null,
  author_id uuid not null,
  body text not null default '',
  -- What the saved segment said when this draft was started. Lets the UI say "the note has changed since
  -- you started typing" rather than silently offering to overwrite a colleague's work.
  based_on_version integer,
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_practice_note_draft_unique
  on practice_note_draft(encounter_id, note_type, author_id);

create index if not exists idx_practice_note_draft_author
  on practice_note_draft(workspace_id, author_id, updated_at desc);

-- ---- 2. Smart text (CPR-130 s2 "Smart text"; the comp's "My Phrases") ---------------------------------
--
-- A shortcut and the text it expands to. WORKSPACE-WIDE OR PERSONAL: author_id null means the whole
-- practice uses it, which is how a practice standardises a normal-examination paragraph without
-- everybody retyping it.
--
-- NO MERGE FIELDS HERE, deliberately, even though CPR-330 has a resolver. Smart text is expanded INTO A
-- BOX THE PRACTITIONER IS TYPING IN, and they see the result before it is saved; a template letter is
-- generated and signed. Putting an unresolvable field into a sentence somebody is mid-way through
-- writing would produce [[patient.name not recorded]] in the middle of a clinical note, which is worse
-- than in a letter because nobody reads their own typing that carefully.

create table if not exists practice_smart_phrase (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  -- Null = the whole practice. Set = this person's own.
  author_id uuid,
  shortcut text not null check (char_length(shortcut) between 2 and 40),
  body text not null check (char_length(body) between 1 and 4000),
  description text,
  used_count integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now()
);

-- A shortcut is unique within its scope. Two partial indexes rather than one, because NULL author_id
-- would otherwise never collide with itself -- the trap migration 186 recorded, arriving again.
create unique index if not exists idx_practice_phrase_shared
  on practice_smart_phrase(workspace_id, shortcut) where author_id is null;
create unique index if not exists idx_practice_phrase_personal
  on practice_smart_phrase(workspace_id, author_id, shortcut) where author_id is not null;

-- ---- 3. Attachments (CPR-130 s2 "Attachments"; s3 "Images and PDFs") ----------------------------------
--
-- THE ROW IS THE RECORD; THE BYTES LIVE IN PRIVATE STORAGE. Same shape as the platform's asset files:
-- a private bucket, reached only through short-lived signed URLs issued server-side. A public URL on a
-- clinical image is a permanent, unauthenticated link to a patient's body.
--
-- ATTACHED TO AN ENCOUNTER, and the patient is denormalised alongside. Not for speed -- so that an
-- attachment can never be reachable through a patient it does not belong to, without a join that a
-- future query might forget.

create table if not exists practice_attachment (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  encounter_id uuid references practice_encounter(id) on delete set null,
  document_id uuid references practice_clinical_document(id) on delete set null,
  storage_path text not null,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null,
  byte_size integer not null check (byte_size > 0),
  kind text not null default 'other'
    check (kind in ('photograph', 'scan', 'result', 'consent', 'referral', 'other')),
  caption text,
  -- Removal is a state, not a delete: an attachment that was filed against the wrong patient must leave
  -- a trace saying so, exactly as an entered-in-error document does. The bytes go; the row stays.
  removed_at timestamptz,
  removed_by uuid,
  removed_reason text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_attachment_encounter
  on practice_attachment(workspace_id, encounter_id) where removed_at is null;
create index if not exists idx_practice_attachment_patient
  on practice_attachment(workspace_id, patient_id, created_at desc);

-- ---- 4. Capabilities ---------------------------------------------------------------------------------
--
-- No new capability. Attaching a photograph to a consultation IS writing to the clinical record, so it
-- takes encounter.edit; reading one takes encounter.view. Minting attachment.upload would let a practice
-- grant the ability to add clinical content to somebody it had not trusted with clinical content.

-- ---- 5. RLS: deny-by-default -------------------------------------------------------------------------

alter table practice_note_draft enable row level security;
alter table practice_smart_phrase enable row level security;
alter table practice_attachment enable row level security;

notify pgrst, 'reload schema';
