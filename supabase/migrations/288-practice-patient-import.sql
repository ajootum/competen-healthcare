-- 288 - PATIENT BULK IMPORT LEDGER
-- CPR-IMP-001 (the import spec written for this build), honouring CPR-DM-001 s15 and s21 (provenance,
-- mapped validated auditable jobs, reconciliation reports), CPR-ARCH-001 (idempotent import), and
-- CPR-SEC-001 (imports are audited). CPR-PRM-001 listed bulk import as a future enhancement and
-- CPR-SET-000 named CSV import with no detail, so CPR-IMP-001 is the governing document.
--
-- ====================================================================================================
-- WHAT THIS IS FOR, IN ONE SENTENCE: RE-UPLOADING THE SAME FILE MUST NOT CREATE THE REGISTER TWICE.
--
-- A practitioner moving an existing patient list into Competen uploads a CSV. Uploads get retried,
-- files get sent twice, and a spreadsheet gets re-exported with three corrected rows and uploaded
-- whole. Without a ledger every one of those ordinary events doubles a register. With it, each import
-- is a recorded run, each row of the file has a recorded verdict, and a row that already produced a
-- patient refuses to produce another.
--
-- ====================================================================================================
-- !! THE LEDGER IS ALSO THE PROVENANCE RECORD. CPR-DM-001 s15 requires every imported record to link
-- to a provenance record naming actor, source, source identifier, method and timestamp. The built
-- practice_patient table carries no source_system column, and widening it for one feature would touch
-- every writer. Instead the row ledger carries patient_id plus the external row key, created_by lives
-- on the run, and the join answers where did this patient come from. A patient with no ledger row was
-- registered by hand.
--
-- ====================================================================================================
-- !! IDEMPOTENCY IS TWO LAYERED, AND ONLY ONE LAYER IS A CONSTRAINT.
--
-- Layer one, the constraint: claimed_external_id is filled ONLY on rows that created a patient, and
-- ux_practice_import_claim makes (workspace_id, claimed_external_id) unique. A second run of a file
-- whose rows carry external ids cannot create a second patient for the same external id, whatever the
-- code above it believes. Rows that were skipped or refused keep their external_id in the external_id
-- column and leave claimed_external_id null, so recording a skip never collides with the claim.
--
-- Layer two, in code: a file whose sha256 already has a COMPLETED run for this workspace is refused
-- whole. This layer is deliberately NOT a unique index, because a FAILED run must not block the
-- corrected retry of the same file.
--
-- Rows WITHOUT an external id fall back to the registration duplicate check (same identifier, or same
-- normalised name with the same birth date or phone), which is the same protection the registration
-- form gives a person typing.
--
-- ====================================================================================================
-- !! WHY OUTCOME IS A CLOSED LIST. The reconciliation report CPR-DM-001 s21 asks for is generated from
-- these rows, and a free text outcome cannot be counted. detail carries the sentence, outcome carries
-- the verdict.
--
-- House rules obeyed: ASCII only, plain idempotent statements, no plpgsql, no do blocks, RLS on both
-- tables, notify pgrst last, and NO SEMICOLON ANYWHERE EXCEPT ENDING A STATEMENT - INCLUDING INSIDE A
-- COMMENT, because the runner splits the file on semicolons and one inside a comment silently drops
-- the statements around it while still reporting Success. No rows returned.

create table if not exists practice_import_run (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  created_by uuid not null,
  file_name text,
  file_sha256 text not null check (btrim(file_sha256) <> ''),
  row_count integer not null check (row_count >= 0),
  registered_count integer not null default 0 check (registered_count >= 0),
  booked_count integer not null default 0 check (booked_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  status text not null default 'APPLYING' check (status in ('APPLYING', 'COMPLETED', 'FAILED')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ix_practice_import_run_ws on practice_import_run (workspace_id, created_at desc);

create index if not exists ix_practice_import_run_hash on practice_import_run (workspace_id, file_sha256);

create table if not exists practice_import_row (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references practice_import_run(id) on delete cascade,
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  row_number integer not null check (row_number >= 1),
  external_id text,
  claimed_external_id text,
  outcome text not null check (outcome in ('REGISTERED', 'REGISTERED_AND_BOOKED', 'SKIPPED_DUPLICATE', 'SKIPPED_ALREADY_IMPORTED', 'ERROR')),
  patient_id uuid references practice_patient(id) on delete set null,
  appointment_id uuid references practice_appointment(id) on delete set null,
  detail text,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_practice_import_claim on practice_import_row (workspace_id, claimed_external_id);

create index if not exists ix_practice_import_row_run on practice_import_row (run_id, row_number);

create index if not exists ix_practice_import_row_external on practice_import_row (workspace_id, external_id);

alter table practice_import_run enable row level security;

alter table practice_import_row enable row level security;

notify pgrst, 'reload schema';
