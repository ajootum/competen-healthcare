-- ============================================================
-- MIGRATION 210: THE SHARED DOCUMENT LIBRARY, FOLDERS AND A RECYCLE BIN (CPR-320)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- MOST OF WHAT CPR-AUDIT-001 LISTED AS MISSING HERE HAS SINCE BEEN BUILT ELSEWHERE, and saying so is the
-- honest first move rather than building it twice:
--
--   templates library      CPR-330, practice_note_template with merge bodies
--   PDF generation         CPR-330, the print view
--   attachments and files  CPR-130, practice_attachment in a private bucket
--   electronic signatures  CPR-130, sign-and-lock with a supersession chain
--   approvals queue        CPR-310, practice_approval_request
--   version control        CPR-130, append-only note versions and document supersession
--
-- WHAT IS GENUINELY MISSING is a place to put a document that belongs to the PRACTICE rather than to a
-- patient: a clinic protocol, a blank consent form, a price list, a referral pathway. There is nowhere
-- for those today, and a practice with nowhere to put its protocol keeps it in somebody's email.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- A CLINICAL DOCUMENT NEVER ENTERS THE RECYCLE BIN. This is the boundary the whole migration turns on.
-- CPR-130's clinical document is marked ENTERED_IN_ERROR and kept forever, because a clinical record is
-- not deletable and a "restore" on one would imply it had been gone. The recycle bin here is for the
-- LIBRARY -- protocols and forms -- where deleting really is deleting and getting it back is an ordinary
-- convenience. Two different objects, two different rules, and the engine refuses to confuse them.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. Folders --------------------------------------------------------------------------------------
--
-- ONE LEVEL DEEP, deliberately. The comp shows five flat folders (Clinical Documents, Letters &
-- Correspondence, Reports & Results, Patient Instructions, Miscellaneous). A tree invites a hierarchy
-- nobody maintains, and the thing people actually need is to find the consent form.

create table if not exists practice_folder (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text,
  position integer not null default 100,
  created_at timestamptz not null default now(),
  created_by uuid
);

create unique index if not exists idx_practice_folder_name
  on practice_folder(workspace_id, lower(name));

-- ---- 2. The library document -------------------------------------------------------------------------
--
-- NOT practice_clinical_document, AND NOT practice_attachment. A protocol belongs to no patient and to no
-- encounter; putting it in either would give it a patient it does not have. The bytes live in the same
-- private bucket as attachments, reached the same way -- through short-lived signed URLs.

create table if not exists practice_library_document (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  folder_id uuid references practice_folder(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  byte_size integer not null check (byte_size > 0),
  -- The recycle bin. A row here is still a row: deleted_at set means it is out of the library and
  -- restorable; the bytes are removed only when it is purged.
  deleted_at timestamptz,
  deleted_by uuid,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now()
);

create index if not exists idx_practice_library_folder
  on practice_library_document(workspace_id, folder_id) where deleted_at is null;
create index if not exists idx_practice_library_bin
  on practice_library_document(workspace_id, deleted_at) where deleted_at is not null and purged_at is null;

-- ---- 3. Capabilities ---------------------------------------------------------------------------------
--
-- READING the library takes document.view -- a protocol is something everybody who reads documents
-- should be able to find. MANAGING it takes template.manage, which is already the "this is how this
-- practice does things" permission: the same people who write the note templates keep the protocols.
-- No new capability is minted.

-- ---- 4. RLS: deny-by-default -------------------------------------------------------------------------

alter table practice_folder enable row level security;
alter table practice_library_document enable row level security;

notify pgrst, 'reload schema';
