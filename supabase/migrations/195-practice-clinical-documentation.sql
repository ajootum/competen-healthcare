-- ============================================================
-- MIGRATION 195: CLINICAL DOCUMENTATION (CPR-130, DM-001 s8/s16)
--
-- CPR-BUILD-001 s3 records CPR-130 as PARTIAL: "SOAP segments exist inside the encounter. No template
-- library, versioning, dictation or sign-and-lock document object." This migration closes three of those
-- four. The fourth, dictation, has NO SERVER COMPONENT AT ALL -- it is the browser's speech recognition
-- writing into a textarea the practitioner then saves like any other text. Nothing is transcribed on a
-- server, no audio is stored, and there is no table here for it. Stated plainly so that nobody goes
-- looking for the transcription service that does not exist.
--
-- WHAT A DOCUMENT IS, AND WHY IT IS NOT THE ENCOUNTER. DM-001 s2 is explicit that the encounter "is
-- never replaced by a note document", and migration 194 built it that way. So a clinical document here is
-- a DERIVED, ISSUABLE artefact: a referral letter, a sick note, a consultation summary -- the thing that
-- leaves the practice and goes to a patient, an employer or another clinician. It composes from the
-- encounter; it does not become it. Deleting every document would lose no clinical record.
--
-- THAT DISTINCTION IS WHY THE DOCUMENT NEEDS ITS OWN SIGNATURE. An encounter signature says "this is what
-- I recorded". A document signature says "this is what I issued, to someone, who now holds a copy I
-- cannot retrieve". The second is the stronger claim, and it is the reason amendment produces a NEW
-- VERSION rather than an edit: the recipient's copy of version 1 still exists in the world, so version 1
-- must still exist in the record for the amendment to be an amendment of anything.
--
-- THREE VERSIONING MODELS, DELIBERATELY DIFFERENT, because the three objects fail differently:
--
--   NOTE SEGMENTS  append-only snapshots (practice_encounter_note_version). Every committed save is
--                  kept. The question these answer is "what did the note say when I signed it", which is
--                  unanswerable today: 194 upserts the segment in place and the previous text is gone.
--   DOCUMENTS      a supersession CHAIN. Amending a signed document creates a successor row linked by
--                  supersedes_document_id and moves the original to AMENDED. Both rows are real, both
--                  are readable, and the chain is walkable in either direction.
--   TEMPLATES      a plain integer bumped on publish. A template is configuration, not a record; nobody
--                  needs to reconstruct the third draft of a heading list.
--
-- SIGNED DOCUMENTS ARE IMMUTABLE, ENFORCED BY THE DATABASE (section 7), for the same reason 194 s6 gives:
-- an application check can be bypassed by a future route, a background job or a console session, and
-- "an issued document cannot be rewritten" must not depend on remembering.
--
-- >>> APPLY THIS FILE AS A WHOLE (Supabase SQL editor), NOT THROUGH A SEMICOLON SPLITTER. <<<
-- Section 7's trigger function is plpgsql with internal semicolons inside $$ ... $$, exactly like 194 s6;
-- a naive splitter cuts it into fragments. Everything else here is a plain statement and survives either
-- way. If section 7 fails to apply, the tables are still correct and the engine still refuses
-- post-signature edits -- what is lost is the guarantee that holds when the engine is bypassed, and
-- scripts/practice-documentation-harness.ts asserts that guarantee by name so its absence is visible.
--
-- Plain idempotent statements, ASCII only, no do-blocks.
-- ============================================================

-- ---- 1. practice_note_template -- the template library --------------------------------------------
--
-- workspace_id IS NULLABLE, and null means a PLATFORM template available to every workspace. The
-- alternative was copying a starter set into each workspace at provisioning, which makes an improvement
-- to a template reach only practices provisioned after it. practice_role_capabilities is the existing
-- precedent for a platform-level row in this schema.
--
-- A workspace can never write a platform template: the engine refuses, and every workspace-scoped read
-- filters `workspace_id is null or workspace_id = $me`.

create table if not exists practice_note_template (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references practice_workspace(id) on delete cascade,
  code text not null,
  title text not null check (char_length(title) between 1 and 160),
  description text,
  -- What this template is FOR. 'encounter_note' fills SOAP segments; the rest compose a document.
  kind text not null default 'encounter_note'
    check (kind in ('encounter_note', 'referral_letter', 'sick_note', 'consultation_summary',
                    'procedure_note', 'discharge_summary', 'general')),
  specialty text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'retired')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Codes are unique per owner. Two partial indexes rather than one on (workspace_id, code), because in
-- Postgres NULL is distinct from NULL and a single index would let the platform library hold the same
-- code twice. This is the partial-index trap that has bitten this codebase before: an upsert whose
-- conflict target does not match a real unique index fails silently rather than loudly.
create unique index if not exists ux_practice_note_template_ws_code
  on practice_note_template(workspace_id, code) where workspace_id is not null;
create unique index if not exists ux_practice_note_template_platform_code
  on practice_note_template(code) where workspace_id is null;

create index if not exists idx_practice_note_template_lookup
  on practice_note_template(workspace_id, kind, status);

-- ---- 2. practice_note_template_section -------------------------------------------------------------
--
-- note_type is CONSTRAINED TO THE SAME FIVE VALUES as practice_encounter_note (194 s2), because an
-- encounter_note template whose section names a sixth type would apply to nothing and fail silently.

create table if not exists practice_note_template_section (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references practice_note_template(id) on delete cascade,
  note_type text not null default 'narrative'
    check (note_type in ('subjective', 'objective', 'assessment', 'plan', 'narrative')),
  heading text not null check (char_length(heading) between 1 and 160),
  -- Guidance shown BESIDE the box, never written into the record. The distinction matters: prompt text
  -- that lands in the note becomes clinical content nobody wrote.
  prompt text,
  -- Starting text that IS written into the record when the template is applied.
  default_body text not null default '',
  position integer not null default 0,
  required boolean not null default false
);

create index if not exists idx_practice_template_section on practice_note_template_section(template_id, position);

-- ---- 3. practice_encounter_note_version -- append-only note history --------------------------------

create table if not exists practice_encounter_note_version (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  note_id uuid not null references practice_encounter_note(id) on delete cascade,
  encounter_id uuid not null references practice_encounter(id) on delete cascade,
  note_type text not null,
  body text not null,
  version integer not null,
  -- How this text came to exist. 'dictation' is recorded because a note assembled by speech recognition
  -- carries a different error profile from one that was typed, and a reader of the record is entitled to
  -- know which they are looking at.
  source text not null default 'typed'
    check (source in ('typed', 'template', 'dictation', 'import')),
  authored_by uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_practice_note_version
  on practice_encounter_note_version(note_id, version);
create index if not exists idx_practice_note_version_enc
  on practice_encounter_note_version(encounter_id, created_at);

-- The head pointer on the note itself, so "current version" needs no aggregate.
alter table practice_encounter_note add column if not exists version integer not null default 0;
alter table practice_encounter_note add column if not exists template_id uuid references practice_note_template(id) on delete set null;
alter table practice_encounter_note add column if not exists last_source text not null default 'typed';

-- ---- 4. practice_clinical_document -----------------------------------------------------------------

create table if not exists practice_clinical_document (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  -- Nullable: a document may be issued outside a consultation (a letter written the next morning).
  encounter_id uuid references practice_encounter(id) on delete set null,
  template_id uuid references practice_note_template(id) on delete set null,
  doc_type text not null default 'consultation_summary'
    check (doc_type in ('consultation_summary', 'referral_letter', 'sick_note', 'procedure_note',
                        'discharge_summary', 'general')),
  title text not null check (char_length(title) between 1 and 200),
  -- The composed content. Plain text, not HTML: this is a clinical record that must be readable in fifty
  -- years and diffable today, and a rich-text blob is neither.
  body text not null default '',
  -- Who it is FOR. Free text, because "Dr Okello, Mulago paediatric OPD" is not in any directory we hold.
  addressed_to text,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'FINAL', 'SIGNED', 'AMENDED', 'ENTERED_IN_ERROR')),
  version integer not null default 1,
  supersedes_document_id uuid references practice_clinical_document(id) on delete set null,
  amendment_reason text,
  signed_at timestamptz,
  signed_by uuid,
  record_version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists idx_practice_doc_patient on practice_clinical_document(patient_id, created_at desc);
create index if not exists idx_practice_doc_encounter on practice_clinical_document(encounter_id);
create index if not exists idx_practice_doc_ws_status on practice_clinical_document(workspace_id, status, created_at desc);
create index if not exists idx_practice_doc_supersedes on practice_clinical_document(supersedes_document_id);

-- ONE LIVE SUCCESSOR PER DOCUMENT. Without this, two people amending the same signed document at once
-- produce two version-2s, and the chain forks into a record with no single current version.
create unique index if not exists ux_practice_doc_successor
  on practice_clinical_document(supersedes_document_id) where supersedes_document_id is not null;

-- ---- 5. practice_clinical_document_release ---------------------------------------------------------
--
-- WHO WAS GIVEN A COPY. This is the reason a document version can never be edited: once a row exists
-- here, a copy of that exact text is outside the practice. Recorded rather than assumed -- "we printed it
-- for the patient" is otherwise a fact that lives only in somebody's memory.
--
-- NOT a delivery mechanism. Nothing here sends anything; it records that a release happened.

create table if not exists practice_clinical_document_release (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  document_id uuid not null references practice_clinical_document(id) on delete cascade,
  channel text not null default 'printed'
    check (channel in ('printed', 'handed_over', 'emailed', 'collected_by_relative', 'other')),
  recipient text,
  note text,
  released_at timestamptz not null default now(),
  released_by uuid
);

create index if not exists idx_practice_doc_release on practice_clinical_document_release(document_id, released_at);

-- ---- 6. The starter template library (platform-level) ----------------------------------------------
--
-- REAL CONTENT, not sample data: these are headings and prompts, which is what a template IS. No clinical
-- assertion is made by any of them, and none of them is dressed as a practice's own work -- they are
-- offered as a starting point and are editable into a workspace template.
--
-- Deliberately FEW. A library of forty specialty templates nobody wrote for this product would be the
-- comps' invented dashboards in another costume.

insert into practice_note_template (code, title, description, kind, status, workspace_id) values
  ('general_consultation', 'General consultation', 'The four SOAP segments with prompts. A starting point for a routine consultation.', 'encounter_note', 'published', null),
  ('followup_review', 'Follow-up review', 'Structured around what changed since the last visit.', 'encounter_note', 'published', null),
  ('referral_letter', 'Referral letter', 'A letter to a colleague: reason, findings, what is being asked for.', 'referral_letter', 'published', null),
  ('sick_note', 'Sick note', 'A certificate of unfitness for work or school. States dates, not diagnoses, unless the patient asks otherwise.', 'sick_note', 'published', null)
on conflict (code) where workspace_id is null do nothing;

-- The alias column is `pos`, not `position`: POSITION is a col_name_keyword in Postgres and an alias
-- list is not the place to find out how it is parsed.
insert into practice_note_template_section (template_id, note_type, heading, prompt, position, required)
select t.id, s.note_type, s.heading, s.prompt, s.pos, s.required
from practice_note_template t
join (values
  ('general_consultation', 'subjective', 'Presenting complaint and history', 'What the patient reports, in their words where it matters. Onset, duration, what changed.', 1, true),
  ('general_consultation', 'objective', 'Examination and findings', 'Observations, vital signs, examination findings. What you measured or saw.', 2, true),
  ('general_consultation', 'assessment', 'Clinical impression', 'What you think is going on, and what you have ruled out.', 3, true),
  ('general_consultation', 'plan', 'Plan', 'Treatment, investigations, advice given, and when you expect to see them again.', 4, true),
  ('followup_review', 'subjective', 'Since the last visit', 'What has changed. Adherence, side effects, new symptoms.', 1, true),
  ('followup_review', 'objective', 'Review findings', 'Repeat measurements and what they show against last time.', 2, false),
  ('followup_review', 'assessment', 'Response to treatment', 'Better, worse, unchanged -- and against what expectation.', 3, true),
  ('followup_review', 'plan', 'Revised plan', 'Continue, adjust or stop, and why.', 4, true),
  ('referral_letter', 'narrative', 'Letter', 'Reason for referral, relevant history and findings, what you are asking the colleague to do, and what you have already done.', 1, true),
  ('sick_note', 'narrative', 'Certificate', 'Dates of unfitness and any restrictions on return. Name a diagnosis only with the patient''s agreement.', 1, true)
) as s(code, note_type, heading, prompt, pos, required) on s.code = t.code
where t.workspace_id is null
  and not exists (
    select 1 from practice_note_template_section x
    where x.template_id = t.id and x.heading = s.heading
  );

-- ---- 7. Immutability after signature (DM-001 s16, the document's own version of 194 s6) ------------

create or replace function practice_clinical_document_signed_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('SIGNED', 'AMENDED', 'ENTERED_IN_ERROR')
     and (new.status not in ('AMENDED', 'ENTERED_IN_ERROR')
          or new.body is distinct from old.body
          or new.title is distinct from old.title
          or new.patient_id is distinct from old.patient_id
          or new.encounter_id is distinct from old.encounter_id
          or new.doc_type is distinct from old.doc_type
          or new.addressed_to is distinct from old.addressed_to
          or new.version is distinct from old.version
          or new.signed_at is distinct from old.signed_at
          or new.signed_by is distinct from old.signed_by)
  then
    raise exception 'clinical document % is signed; it can only be amended into a new version or marked entered in error', old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_practice_clinical_document_signed_guard on practice_clinical_document;
create trigger trg_practice_clinical_document_signed_guard
  before update on practice_clinical_document
  for each row execute function practice_clinical_document_signed_guard();

-- A note VERSION is a historical fact. Nothing may rewrite one, at any status, ever.
create or replace function practice_note_version_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'note version % is part of the clinical record and cannot be changed', old.id;
end;
$$;

drop trigger if exists trg_practice_note_version_immutable on practice_encounter_note_version;
create trigger trg_practice_note_version_immutable
  before update on practice_encounter_note_version
  for each row execute function practice_note_version_immutable();

-- ---- 8. Capabilities + backfill (the pattern from 192/193/194, applied again) -----------------------
--
-- practice_owner gets template.manage AND NOTHING ELSE HERE. The 191 seed deliberately withholds
-- patient.list and encounter.list from the owner role -- the owner of a practice is a business role, not
-- a clinical one, and a business role does not read clinical documents. Templates are configuration, so
-- they are the owner's business. Extending that boundary is a decision, not a default.

insert into practice_role_capabilities (role_code, capability_code) values
  ('practitioner', 'document.view'),
  ('practitioner', 'document.author'),
  ('practitioner', 'document.sign'),
  ('practitioner', 'template.manage'),
  ('practice_owner', 'template.manage')
on conflict (role_code, capability_code) do nothing;

insert into practice_role_assignment (membership_id, capability_code, source)
select m.id, c.capability_code, 'role_default'
from practice_membership m
join practice_role_capabilities c on c.role_code = m.role_code
where m.status = 'active'
  and not exists (
    select 1 from practice_role_assignment a
    where a.membership_id = m.id and a.capability_code = c.capability_code and a.effective_to is null
  );

-- ---- 9. RLS: deny-by-default ------------------------------------------------------------------------
--
-- practice_note_template carries platform rows readable by every workspace, and it is STILL deny-by-
-- default here: the engine reads it with the service role and applies the workspace filter itself. A
-- policy that let any authenticated user read the platform library would be harmless today and would be
-- the thing somebody points at the next time a table needs "just a small read policy".

alter table practice_note_template enable row level security;
alter table practice_note_template_section enable row level security;
alter table practice_encounter_note_version enable row level security;
alter table practice_clinical_document enable row level security;
alter table practice_clinical_document_release enable row level security;

notify pgrst, 'reload schema';
