-- ============================================================
-- MIGRATION 204: REPORTS, DOCUMENTS AND CORRESPONDENCE (CPR-330, rebuilt)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- CPR-330 WAS BUILT AS ANALYTICS. IT IS DOCUMENT GENERATION.
--
-- The first attempt read the title "Reports" and built activity counts, diagnosis frequency and an aged
-- backlog. The specification is clinical reports, referral and consultation letters, discharge
-- summaries, medical certificates, a template designer with dynamic field merging, batch generation,
-- practice branding, approval workflow and archive. Counting is CPR-270's subject. See
-- CPR-AUDIT-001-spec-conformance.md.
--
-- The analytics engine is kept and re-labelled rather than deleted -- it is real, it is harnessed, and
-- CPR-270 will want it.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- NO FOURTH DOCUMENT MODEL. CPR-130 already owns the issued document (practice_clinical_document, with
-- signing, versioning, supersession and a release register) and the template library
-- (practice_note_template). CPR-320 added the incoming register. A generation module that created its
-- own document table would give this product three places a referral letter can live and no answer to
-- which one is the record. So this migration ADDS TO the existing tables: templates gain a merge body,
-- configuration gains branding, and generation gains a batch record.
--
-- THE LETTERHEAD REFUSAL IS NOW RESOLVABLE, and this is the honest arc worth recording. CPR-130 refused
-- to render a letterhead because "a header carrying a practice's name, registration and address is a
-- document this product has not been given, and inventing one would put unverified details on a
-- clinical certificate". That was correct THEN. CPR-360 built configuration; the practice can now
-- supply those details itself. The refusal was never about letterheads being wrong -- it was about
-- having no source for the facts. There is one now, and every field is optional: a practice that
-- supplies nothing still gets no letterhead rather than a placeholder.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. Practice branding (CPR-330 "practice branding") ---------------------------------------------
--
-- On practice_configuration, because it is configuration and CPR-360 already owns that surface. All
-- nullable: an unsupplied field prints nothing, never a placeholder. A certificate that says
-- "[PRACTICE ADDRESS]" is worse than one with no address.

alter table practice_configuration add column if not exists letterhead_name text;
alter table practice_configuration add column if not exists letterhead_registration text;
alter table practice_configuration add column if not exists letterhead_address text;
alter table practice_configuration add column if not exists letterhead_contact text;
alter table practice_configuration add column if not exists letterhead_footer text;

-- ---- 2. Templates gain a merge body ------------------------------------------------------------------
--
-- practice_note_template's sections model suits an ENCOUNTER note -- five SOAP boxes, one per segment.
-- A referral letter is one flowing body with fields merged into it, which sections cannot express. So a
-- document template carries `body_template`, and the section rows stay what they were for.
--
-- The two are not alternatives per template: `kind` already decides which applies (encounter_note uses
-- sections, everything else uses the body).

alter table practice_note_template add column if not exists body_template text;
alter table practice_note_template add column if not exists include_letterhead boolean not null default true;

-- ---- 3. Batch generation -----------------------------------------------------------------------------
--
-- One row per RUN, not per document produced -- the documents are ordinary practice_clinical_document
-- rows and point back here. "Who generated forty certificates on Tuesday and why" is then answerable
-- without inferring it from timestamps.

create table if not exists practice_document_batch (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  template_id uuid references practice_note_template(id) on delete set null,
  doc_type text not null,
  title_pattern text not null,
  -- What the batch was aimed at, as the operator described it. Free text rather than a stored query:
  -- a saved query would go stale against the data it selected, and the count below is the fact that
  -- matters afterwards.
  selection_note text,
  requested integer not null default 0,
  generated integer not null default 0,
  failed integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_doc_batch on practice_document_batch(workspace_id, created_at desc);

alter table practice_clinical_document add column if not exists batch_id uuid references practice_document_batch(id) on delete set null;
create index if not exists idx_practice_doc_batch_member on practice_clinical_document(batch_id) where batch_id is not null;

-- ---- 4. Scheduled reports ----------------------------------------------------------------------------
--
-- THE DEFINITION IS BUILT; THE FIRING IS NOT, and the difference is stated rather than blurred. A
-- schedule needs a scheduler, and this product's cron surface belongs to the platform rather than to a
-- practice tenant -- wiring a tenant-triggered job is an infrastructure decision with its own
-- specification. `next_run_at` is therefore advisory, `last_run_at` is only ever set by somebody
-- pressing Run now, and the UI says so.
--
-- Recorded this way rather than omitted because a practice that has written down "monthly activity
-- summary, first of the month" has recorded a real intention, and a run-now button against it is
-- genuinely useful today.

create table if not exists practice_scheduled_report (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  report_kind text not null default 'activity'
    check (report_kind in ('activity', 'diagnosis', 'backlog', 'patient_list')),
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),
  active boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_run_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_scheduled_report on practice_scheduled_report(workspace_id, active, next_run_at);

-- ---- 5. Capabilities ---------------------------------------------------------------------------------
--
-- document.author and report.view already exist and are the right two: generating a letter IS authoring
-- a document, and it must not be a weaker permission just because a template did the typing.
-- No new capability is minted.

-- ---- 6. RLS: deny-by-default -------------------------------------------------------------------------

alter table practice_document_batch enable row level security;
alter table practice_scheduled_report enable row level security;

notify pgrst, 'reload schema';
