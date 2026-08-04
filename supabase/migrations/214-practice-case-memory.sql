-- ============================================================
-- MIGRATION 214: CASE MEMORY (CPR-220)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- SIMILARITY IS A LIST OF SHARED FACTS, NEVER A SCORE. THERE IS NO SIMILARITY COLUMN IN THIS FILE.
--
-- The comp draws "95% relevance", "92% similarity", with a progress bar beside each case. That is not
-- merely a percentage in a product that computes no percentages -- it is the most dangerous invented
-- figure in the whole specification set, because a clinician reading "92% similar" beside a treatment
-- and an outcome may reasonably let it inform what they do next. There is no formula that could earn
-- that number, and a wrong one would be indistinguishable from a right one.
--
-- So this module retrieves cases by facts that were actually recorded -- the same diagnosis label, the
-- same procedure, an overlapping age band, the same laterality -- and returns WHICH FACTS MATCHED. A
-- clinician can weigh "matches on: diagnosis, procedure, age within five years". They cannot weigh 92%.
-- Ordering is by the NUMBER of matched facts, then recency: a count, not a score.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- NO CASE TABLE, AND NO SIMILARITY INDEX. A "case" is an encounter that already exists, with the
-- diagnoses, procedures and outcomes already hanging off it. Copying those into a case-memory table
-- would be a second record of the same consultation, and the two would disagree the first time somebody
-- amended one. What this migration adds is only what does NOT exist: the practitioner's own learning,
-- and a way to group cases.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. Learning points ---------------------------------------------------------------------------------
--
-- What a clinician took away from a case. The one thing in Case Memory that is genuinely new information
-- rather than a rearrangement of the record.
--
-- IT BELONGS TO THE PERSON WHO LEARNED IT. Two clinicians can take different lessons from the same
-- consultation, and both are real; a single shared note per case would make one of them overwrite the
-- other. Scoped to (encounter, author) with no unique constraint on encounter alone.

create table if not exists practice_case_learning (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  encounter_id uuid not null references practice_encounter(id) on delete cascade,
  -- Denormalised so a learning point survives a patient merge pointing elsewhere, and so the privacy
  -- filter has a patient to check without a join it might forget.
  patient_id uuid references practice_patient(id) on delete set null,
  author_id uuid not null,
  kind text not null default 'observation'
    check (kind in ('what_worked', 'what_to_avoid', 'complication', 'technique', 'diagnosis_pitfall', 'observation')),
  -- Substantive by construction: "good case" is not a learning point, and a one-word note in a lifelong
  -- memory is a row somebody has to read and discard later.
  body text not null check (char_length(body) between 20 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_practice_case_learning_author
  on practice_case_learning(workspace_id, author_id, created_at desc);
create index if not exists idx_practice_case_learning_encounter
  on practice_case_learning(encounter_id);

-- ---- 2. Collections -------------------------------------------------------------------------------------
--
-- Named groups of cases: "Spine surgery -- lumbar", "Post-operative complications". owner_id null means
-- the whole practice keeps it; set means it is one person's own shelf.
--
-- A BOOKMARK IS NOT A SECOND MECHANISM. Marking a case to come back to is membership of a personal
-- collection, so there is one way to group cases rather than two that drift apart.

create table if not exists practice_case_collection (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  owner_id uuid,
  name text not null check (char_length(name) between 1 and 80),
  description text,
  created_at timestamptz not null default now(),
  created_by uuid
);

-- One name per shelf. Two partial indexes, because NULL is distinct from NULL in Postgres and a single
-- index would let the practice hold the same collection name twice -- the trap migration 195 recorded
-- for platform templates, arriving again.
create unique index if not exists idx_practice_collection_shared
  on practice_case_collection(workspace_id, lower(name)) where owner_id is null;
create unique index if not exists idx_practice_collection_personal
  on practice_case_collection(workspace_id, owner_id, lower(name)) where owner_id is not null;

create table if not exists practice_case_collection_member (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  collection_id uuid not null references practice_case_collection(id) on delete cascade,
  encounter_id uuid not null references practice_encounter(id) on delete cascade,
  note text,
  added_at timestamptz not null default now(),
  added_by uuid
);

-- A case is in a collection once. Adding it twice is a click, not an intention.
create unique index if not exists idx_practice_collection_member
  on practice_case_collection_member(collection_id, encounter_id);

-- ---- 3. Capabilities --------------------------------------------------------------------------------------
--
-- Case Memory reads across the whole practice's clinical history, so it takes encounter.list -- the
-- capability that already means "may see consultations". It deliberately does NOT require patient.view:
-- learning from a case does not require knowing whose it was, and the engine de-identifies for callers
-- who lack it. Capturing a learning point takes encounter.edit, because it is writing against a
-- consultation.

-- ---- 4. RLS: deny-by-default --------------------------------------------------------------------------------

alter table practice_case_learning enable row level security;
alter table practice_case_collection enable row level security;
alter table practice_case_collection_member enable row level security;

notify pgrst, 'reload schema';
