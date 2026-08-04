-- ============================================================
-- MIGRATION 226: REGISTRATION WORKSPACE (CPR-REG-002 v4)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- TWO THINGS THE WORKSPACE NEEDS AND THE SCHEMA DOES NOT HAVE. Everything else it asks for already
-- exists and is composed rather than rebuilt: search and duplicate detection (mig 193), multiple
-- hospital identifiers (222), guardians and next of kin (221), configurable fields (223), name parts
-- and register-and-book (225), the diary and the waiting queue (192).
-- ────────────────────────────────────────────────────────────────────────────────────────────────────

-- ---- 1. A queue entry can name the patient it is for -------------------------------------------------
--
-- practice_queue_entry has carried patient_name since 192 and no patient_id, because a queue entry was
-- only ever created by checking in an APPOINTMENT, which already knew who it was for. "Register and
-- queue" creates one for somebody who has just walked in and has no appointment at all -- and without a
-- link, the waiting queue on the right of the screen is a list of NAMES that cannot be opened.

alter table practice_queue_entry add column if not exists patient_id uuid references practice_patient(id) on delete set null;
create index if not exists idx_practice_queue_patient
  on practice_queue_entry(patient_id) where patient_id is not null;

-- ---- 2. Drafts (CPR-REG-002 s28, CPR-PRM-001 s5) -----------------------------------------------------
--
-- A half-filled registration that survives a patient walking off mid-conversation, a phone ringing, or
-- a browser being closed at a busy desk.
--
-- ⚠ A DRAFT HOLDS IDENTIFIABLE DETAILS ABOUT SOMEBODY WHO IS NOT YET A PATIENT. That is the whole point
-- and it is also the risk: this data sits OUTSIDE the patient record, so it is outside the access log,
-- outside the merge machinery and outside every retention rule that applies to a patient. So:
--   - a draft belongs to the person who started it, and nobody else can open it
--   - the page shows how old each one is, because a three-week-old draft is somebody's details nobody
--     is looking after
--   - nothing expires them automatically. A job that deletes patient-shaped data on a timer is a job
--     that silently destroys a record somebody was mid-way through, and this codebase has refused
--     stored-and-swept state everywhere else for weaker reasons.

create table if not exists practice_registration_draft (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  -- WHOSE DESK IT IS ON. Not shared: a colleague opening your half-finished form would be reading
  -- somebody's details out of a context that explains nothing about why they were being collected.
  user_id uuid not null,

  -- Whatever has been typed so far, in the shape the form uses. jsonb rather than columns, because a
  -- draft mirrors a CONFIGURABLE form (migration 223) -- columns would have to change every time a
  -- practice added a question.
  payload jsonb not null default '{}'::jsonb,

  -- Enough to recognise it in a list without opening it.
  label text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_practice_reg_draft_user
  on practice_registration_draft(workspace_id, user_id, updated_at desc);

-- ---- 3. Capabilities -------------------------------------------------------------------------------------
--
-- patient.create throughout: a draft is a registration that has not happened yet, and queueing a walk-in
-- is part of registering them.

-- ---- 4. RLS: deny-by-default ---------------------------------------------------------------------------

alter table practice_registration_draft enable row level security;

notify pgrst, 'reload schema';
