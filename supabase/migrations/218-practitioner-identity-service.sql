-- ============================================================
-- MIGRATION 218: PRACTITIONER IDENTITY SERVICE (PIS-000 v1.0, Frozen)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- THIS IS THE FIRST practice_* TABLE THAT IS NOT WORKSPACE-SCOPED, AND THAT IS THE WHOLE POINT.
--
-- PIS-000 s1: "Practitioner-first architecture independent of employers." s2: the number is "permanent,
-- never reused". s15: "Identity remains valid when changing workplaces."
--
-- Every other practice_* table hangs off practice_workspace, because a consultation belongs to a
-- practice. An IDENTITY does not. A practitioner who closes one practice and opens another is the same
-- person with the same number, the same handle and the same booking URL -- and if this row were scoped
-- to a workspace, the workspace cascade would delete the identity along with it. Keyed on user_id, and
-- the workspace it currently books into is a NULLABLE POINTER that can be moved or cleared.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- PRIVACY BY DEFAULT (s1), SO DISCOVERY DEFAULTS TO 'hidden'. s7 lists five modes and makes only
-- opted-in practitioners appear in public search. A migration that made a real clinician's name,
-- qualifications and place of work publicly searchable would be publishing a person by default, and no
-- default is worth that. The existing site already takes this position for /verify: reachable by link,
-- never by search.
--
-- NOTHING HERE VERIFIES A LICENCE. s10's lifecycle includes "Licence Verification" and s14 lists
-- "Future integration with professional councils" -- future being the operative word. The state exists,
-- and what makes it true is an operator recording that they checked, with their name against it. That is
-- the same position CPR-240 took: provenance, not a tick.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. The practitioner number allocator ---------------------------------------------------------------
--
-- A REAL SEQUENCE, because "permanent, never reused" (s2) is exactly what a sequence guarantees and
-- exactly what a max()+1 does not: two concurrent registrations both read the same maximum and both
-- claim it. A sequence also does not go backwards when a row is deleted, which is what "never reused"
-- means.
--
-- NOTE ON THE FORMAT: PIS-000 s2 specifies "CPR-000001". In this repository a bare CPR-nnn is a
-- SPECIFICATION number (CPR-240 is the portfolio spec), so a practitioner number is distinguishable
-- only by being six digits rather than three. Followed as frozen, and flagged in the review.

create sequence if not exists practice_practitioner_number_seq start with 1 increment by 1;

-- ---- 2. The identity ------------------------------------------------------------------------------------

create table if not exists practice_practitioner_identity (
  -- s2: "Internal UUID (hidden, permanent)". Never rendered publicly -- see s13.
  id uuid primary key default gen_random_uuid(),

  -- ONE IDENTITY PER PERSON, not per practice. See the header.
  user_id uuid not null unique,

  -- s2: permanent, never reused.
  practitioner_number text not null unique,

  -- s2/s3: lowercase letters and digits only, no punctuation. Stored WITHOUT the leading '@' -- the '@'
  -- is a display and routing convention, and storing it would put it in every comparison and every
  -- uniqueness check for no benefit.
  handle text unique check (handle is null or handle ~ '^[a-z][a-z0-9]{2,29}$'),

  display_name text not null check (char_length(display_name) between 2 and 120),

  -- s6: the public profile. Every field practitioner-controlled.
  qualifications text,
  specialties text,
  biography text,
  languages text,
  consultation_types text,

  -- s7: five discovery modes. HIDDEN BY DEFAULT.
  discovery text not null default 'hidden'
    check (discovery in ('public', 'hidden', 'link_only', 'existing_patients', 'referral_only')),

  -- s10: the identity lifecycle.
  status text not null default 'created'
    check (status in ('created', 'email_verified', 'licence_verified', 'active',
                      'temporarily_hidden', 'suspended', 'archived', 'deleted')),

  -- WHAT MADE THE LICENCE STATE TRUE. Not a boolean: a tick with nobody behind it is the claim CPR-240
  -- refused. Null until somebody records that they checked, and their id stays against it.
  licence_verified_at timestamptz,
  licence_verified_by uuid,
  licence_reference text,

  -- Where a booking lands. NULLABLE and ON DELETE SET NULL: the identity outlives any one practice, so
  -- closing a workspace must leave the practitioner with their number, handle and URL intact.
  primary_workspace_id uuid references practice_workspace(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_practice_identity_discovery
  on practice_practitioner_identity(discovery, status) where discovery = 'public';
create index if not exists idx_practice_identity_workspace
  on practice_practitioner_identity(primary_workspace_id);
-- s9's search resolution walks display name and surname, so both want an index that ignores case.
create index if not exists idx_practice_identity_name
  on practice_practitioner_identity(lower(display_name));

-- ---- 3. Handle history, for the redirects s8 requires ----------------------------------------------------
--
-- s3: "After activation, handle changes require availability checks and automatic legacy URL redirects."
-- s8: "Legacy URLs redirect automatically after handle changes."
--
-- A RELEASED HANDLE IS NOT FREE. It stays in this table pointing at the identity that used to hold it,
-- which is what makes the redirect possible -- and it also stops a third party claiming a handle whose
-- printed cards, QR codes and posters are still in circulation. That second effect is the important one:
-- somebody else's patients would scan a poster and reach a stranger.

create table if not exists practice_handle_history (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique check (handle ~ '^[a-z][a-z0-9]{2,29}$'),
  identity_id uuid not null references practice_practitioner_identity(id) on delete cascade,
  released_at timestamptz not null default now()
);

create index if not exists idx_practice_handle_history_identity
  on practice_handle_history(identity_id, released_at desc);

-- ---- 4. Reserved handles (s4) ----------------------------------------------------------------------------
--
-- "Reserved handles can never be assigned to practitioners." A table rather than a constant, so the list
-- can grow without a deploy -- but seeded here so it is never empty, because an empty reserved list is
-- indistinguishable from a working one until somebody registers @support.

create table if not exists practice_reserved_handle (
  handle text primary key check (handle ~ '^[a-z][a-z0-9]{2,29}$'),
  reason text not null default 'reserved'
);

insert into practice_reserved_handle (handle, reason) values
  ('admin', 'platform'), ('support', 'platform'), ('help', 'platform'), ('system', 'platform'),
  ('api', 'platform'), ('hospital', 'platform'), ('doctor', 'platform'),
  -- Beyond the seven s4 names: everything the routing layer or a plausible impersonation would want.
  ('competen', 'brand'), ('competenpractice', 'brand'), ('practice', 'brand'),
  ('root', 'platform'), ('security', 'platform'), ('billing', 'platform'), ('legal', 'platform'),
  ('privacy', 'platform'), ('info', 'platform'), ('contact', 'platform'), ('sales', 'platform'),
  ('nurse', 'profession'), ('midwife', 'profession'), ('surgeon', 'profession'),
  ('pharmacist', 'profession'), ('dentist', 'profession'), ('clinic', 'generic'),
  ('booking', 'routing'), ('book', 'routing'), ('search', 'routing'), ('login', 'routing'),
  ('signin', 'routing'), ('signup', 'routing'), ('account', 'routing'), ('settings', 'routing')
on conflict (handle) do nothing;

-- ---- 5. Capabilities -------------------------------------------------------------------------------------
--
-- NONE. An identity belongs to the person, not to a practice, so no practice capability governs it --
-- every engine call is scoped to the caller's own identity. Recording a LICENCE verification is the one
-- exception and is platform-operator work, gated outside the practice capability system.

-- ---- 6. RLS: deny-by-default ---------------------------------------------------------------------------
--
-- Including the public profile. Nothing reads these tables through an anon key: the public page resolves
-- a handle through the service role and returns only the fields s6 lists, for identities whose discovery
-- mode permits it. A policy that let anon select the row would expose primary_workspace_id and user_id,
-- which s13 forbids exposing.

alter table practice_practitioner_identity enable row level security;
alter table practice_handle_history enable row level security;
alter table practice_reserved_handle enable row level security;

notify pgrst, 'reload schema';
