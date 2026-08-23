-- 353 THE FACTS A DOCUMENT DISCLOSED
--
-- APPLY THIS FILE WHOLE. It defines a trigger function whose body contains
-- semicolons, and a runner that splits on the semicolon would cut it in half.
--
-- CPR-DOC-AUTO-001 sections 9 (Include From Record), 15 (Patient Timeline and
-- Provenance) and 17 (Acceptance Tests), Phase 1.
--
-- WHY A TABLE AND NOT A COLUMN. Generation today merges a template and stores
-- prose. Prose cannot answer the three questions the spec asks of every issued
-- document: which recorded facts went into this, were any of them outside what
-- the practitioner selected, and did regenerating it broaden what was disclosed.
-- Section 17 makes all three PASS conditions, so they have to be answerable by
-- something other than reading the letter back and trusting it.
--
-- ONE ROW PER FACT DISCLOSED. Each row names the source table and row id that
-- justified one statement in the document -- section 15's "machine-readable
-- provenance references to source CP records used for generation".
--
-- THE LABEL IS A SNAPSHOT, AND THAT IS THE POINT. label and detail hold what the
-- practitioner actually saw and approved at the moment of generation. If a
-- diagnosis is later relabelled, this row must keep saying what the signed letter
-- said. Joining live to the source row instead would silently rewrite the history
-- of what was disclosed, which is the precise failure the table exists to prevent.
-- Do not "normalise" these two columns away.
--
-- WHAT THIS IS NOT. Not a second clinical source of truth (section 19). Nothing
-- reads a diagnosis FROM here. It records that a diagnosis was disclosed, in the
-- words it was disclosed in, and points at the row it came from.

-- ---- 1. The disclosure record ---------------------------------------------------

create table if not exists practice_document_fact (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  document_id uuid not null references practice_clinical_document(id) on delete cascade,
  -- The Phase 1 vocabulary. Later phases that source new kinds of fact extend
  -- this check -- a category nothing can write is a category that misreports
  -- what is implemented.
  category text not null check (category in
    ('encounter', 'diagnosis', 'treatment', 'procedure', 'investigation',
     'medication', 'follow_up')),
  -- Section 15's provenance pair. Text rather than a typed FK on purpose: the
  -- referent is a different table per category, and seven nullable FK columns of
  -- which exactly one is ever set would be worse in every way.
  source_table text not null check (char_length(btrim(source_table)) between 1 and 63),
  source_id uuid not null,
  -- What the practitioner saw. See the header: this is deliberately a copy.
  label text not null check (char_length(btrim(label)) between 1 and 500),
  detail text check (detail is null or char_length(detail) <= 2000),
  -- Section 9's disclosure default turns on this. Current-encounter facts are
  -- offered pre-selected, historical facts are offered unselected, and recording
  -- which was which is how a widened disclosure is detectable afterwards.
  scope text not null check (scope in ('current_encounter', 'historical')),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

alter table practice_document_fact enable row level security;

-- The same source row cannot be disclosed twice in one document. Not tidiness:
-- a duplicate would make any count of what was disclosed wrong.
create unique index if not exists practice_document_fact_unique
  on practice_document_fact (document_id, source_table, source_id);

create index if not exists practice_document_fact_document_idx
  on practice_document_fact (document_id, position);

-- Answers "where has this diagnosis been sent" without scanning documents.
create index if not exists practice_document_fact_source_idx
  on practice_document_fact (workspace_id, source_table, source_id);

-- ---- 2. A signed document's disclosure cannot change ----------------------------
--
-- Section 17: "signed artifact cannot be silently overwritten", and "regeneration
-- does not broaden disclosure scope". Enforced here rather than in the service
-- layer because a rule enforced in one writer dies with the second writer who
-- does not know it exists.
--
-- THE CASCADE ALLOWANCE IS LOAD-BEARING. Deleting a signed document must still
-- work -- its facts go with it. A cascaded delete runs at trigger depth above 1,
-- so the guard stands aside for it and blocks only a direct write. Without this
-- clause a signed document becomes undeletable by anybody, which this codebase
-- has shipped before.

create or replace function practice_document_fact_guard()
returns trigger
language plpgsql
as $$
declare
  target_document uuid;
  document_status text;
begin
  if tg_op = 'DELETE' then
    target_document := old.document_id;
  else
    target_document := new.document_id;
  end if;

  select status into document_status
  from practice_clinical_document
  where id = target_document;

  if document_status in ('SIGNED', 'AMENDED', 'ENTERED_IN_ERROR')
     and pg_trigger_depth() < 2
  then
    raise exception 'document % is signed, so the facts it disclosed cannot be changed', target_document;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_practice_document_fact_guard on practice_document_fact;
create trigger trg_practice_document_fact_guard
  before insert or update or delete on practice_document_fact
  for each row execute function practice_document_fact_guard();

notify pgrst, 'reload schema';
