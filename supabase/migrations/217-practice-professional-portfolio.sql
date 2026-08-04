-- ============================================================
-- MIGRATION 217: PROFESSIONAL PORTFOLIO (CPR-240)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- A PORTFOLIO IS A DOCUMENT SOMEBODY SUBMITS FOR APPRAISAL, LICENSING AND REVALIDATION.
-- IF IT OVERSTATES, IT IS THE CLINICIAN WHO SIGNED IT.
--
-- That single fact decides everything below, because it makes this the one module where an invented
-- figure does not merely mislead a user -- it travels, under their name, to a body that will act on it.
--
-- The comp promises "Your complete professional story, automatically built from your practice" and
-- prints "Total Experience 8.6 yrs -- Since 2016" and "Patients Managed 2,348 -- All time". This
-- product holds only what was recorded IN it. "All time" means "since you started using this software",
-- and a portfolio claiming 8.6 years from a workspace created three months ago is a fabrication with a
-- clinician's name at the bottom of it.
--
-- SO EVERY FIGURE IS WHAT THIS PRODUCT RECORDED, AND THE PORTFOLIO SAYS SO ON ITS FACE -- a coverage
-- window in the header of the page and of the export, not a footnote. It is an extract, not a career.
--
-- AND NOTHING HERE IS "VERIFIED". The comp's principles panel reads "Verified and trustworthy --
-- Source-linked and auditable"; the footer says "Comprehensive & Verified". A credentialing body
-- reading "verified" treats the document differently, and nothing in this product verifies anything: a
-- registration number is a string somebody typed. What IS true is PROVENANCE, and every item carries it:
--   source_linked  it arose from clinical work recorded here -- a consultation, a procedure, an activity
--   self_declared  a practitioner typed it in
-- That distinction is more useful to an appraiser than the word "verified", and it is true.
--
-- THERE IS NO PORTFOLIO SCORE COLUMN. "Portfolio Score 842/1000 -- Excellent", the donut it sits inside
-- and the "Portfolio Growth" line charting it over time are one invented number drawn three ways.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- MOST OF THIS MODULE ALREADY EXISTS. The specification's data model lists Portfolio, Evidence Item,
-- Achievement, Procedure Log, Teaching Activity, Publication, Leadership Activity and Attachment:
--   PROCEDURE LOG      practice_procedure (CPR-150), already carrying cpd_minutes and portfolio flags
--   TEACHING ACTIVITY  practice_clinical_activity (CPR-150) already has 'teaching' and 'training' kinds
--   EVIDENCE ITEM      encounters, procedures, activities, reflections, case learning -- all recorded
--   ATTACHMENT         there is NO FILE STORAGE in this product (CPR-320 declined it and named why), so
--                      the comp's "Documents 286 / Certificates 34 / Photos & Media 62" cannot be honoured
-- What is missing is the practitioner themselves, and the things a portfolio holds that clinical work
-- never produces: a publication, an award, a fellowship, a certificate with an expiry date.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. The practitioner ------------------------------------------------------------------------------
--
-- One row per person per workspace. PRACTITIONER-OWNED (section 5) and self-declared throughout: a
-- registration number in a text box is a claim, not a credential, and the portfolio labels it as one.

create table if not exists practice_practitioner_profile (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  user_id uuid not null,

  full_name text,
  profession text,
  specialty text,
  sub_specialty text,

  -- SELF-DECLARED, ALWAYS. Nothing here contacts a regulator, and a product that displayed this beside
  -- a tick would be manufacturing an assurance nobody performed.
  registration_number text,
  registration_body text,
  registration_expires_on date,

  -- WHEN THEY STARTED PRACTISING, WHICH IS NOT WHEN THIS PRODUCT STARTED RECORDING. Kept so a portfolio
  -- can say "you have practised since 2016; this covers the part recorded here" instead of quietly
  -- passing one off as the other.
  practising_since date,

  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_practice_practitioner_profile
  on practice_practitioner_profile(workspace_id, user_id);

-- ---- 2. What clinical work never produces ---------------------------------------------------------------
--
-- A publication, an award, a fellowship, a committee, a certificate. None of these can be derived from a
-- consultation, so they are typed -- and every one is therefore self_declared.

create table if not exists practice_portfolio_entry (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  -- WHOSE IT IS. A portfolio is one person's; there is no practice-wide portfolio and no reassignment.
  user_id uuid not null,

  kind text not null
    check (kind in ('qualification', 'certification', 'publication', 'achievement',
                    'teaching', 'leadership', 'research', 'other')),
  title text not null check (char_length(title) between 3 and 300),
  detail text,
  organisation text,

  occurred_on date,
  -- A CERTIFICATE THAT HAS LAPSED IS THE ONE AN APPRAISER ASKS ABOUT. Stored as a date; whether it has
  -- expired is DERIVED at read time, never a stored flag -- the rule CPR-140 set for overdue and for the
  -- same reason: a stored flag needs something to run, and nothing runs in a practice nobody opens.
  expires_on date,

  -- A reference somebody can follow: a DOI, a journal citation, a certificate number. TEXT, not a file --
  -- see the header.
  reference text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_practice_portfolio_entry_user
  on practice_portfolio_entry(workspace_id, user_id, kind, occurred_on desc);
create index if not exists idx_practice_portfolio_entry_expiry
  on practice_portfolio_entry(workspace_id, user_id, expires_on) where expires_on is not null;

-- NO evidence_source COLUMN, deliberately. Every row in this table is self-declared by construction, and
-- a column that is always the same value invites somebody to set it to the other one.

-- ---- 3. Capabilities -------------------------------------------------------------------------------------
--
-- NONE. A portfolio is an account of your own work; nobody grants you permission to keep one. What the
-- portfolio COMPOSES is already gated where it lives -- procedures by procedure.record, consultations by
-- encounter.list -- and the composer counts only the caller's own work either way.

-- ---- 4. RLS: deny-by-default ---------------------------------------------------------------------------

alter table practice_practitioner_profile enable row level security;
alter table practice_portfolio_entry enable row level security;

notify pgrst, 'reload schema';
