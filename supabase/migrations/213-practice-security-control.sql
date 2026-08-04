-- ============================================================
-- MIGRATION 213: SESSIONS, DEVICES, CONSENT, BREAK-GLASS AND THE MFA POLICY (CPR-370)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- THE LAST OF THE ELEVEN. Unlike the other ten this is not a correction: CPR-370's access log was built
-- (migration 202) and these five capabilities were never started at all.
--
-- Every one of them is a security feature, so the rule for the whole file is that NOTHING HERE MAY
-- OVERSTATE WHAT IT DOES. A security control that claims more than it enforces is worse than an absent
-- one, because somebody stops worrying on the strength of it.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- THE SESSION REGISTER IS THE PRACTICE'S, NOT THE AUTH PROVIDER'S -- AND THIS IS THE MOST IMPORTANT
-- SENTENCE IN THE MIGRATION.
--
-- Revoking a row here does NOT revoke the platform's auth token. What it does is real and enforceable:
-- the Practice shell checks this register on every request and refuses a revoked session, so the person
-- is locked out of the practice immediately. It does not sign them out of Competen.
--
-- The alternative -- a "sign out this device" button that quietly did nothing -- is the single most
-- dangerous thing this module could ship, because somebody would press it after losing a laptop and
-- believe the problem was solved. So the distinction is in the column comments, in the engine, in the
-- API payload and on the page.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. Sessions and devices ---------------------------------------------------------------------------
--
-- One row per (person, device) in a practice, refreshed as they use it. A DEVICE IS A COOKIE, and that
-- is stated rather than dressed up: the identifier is a random value this product set in the browser, so
-- clearing cookies makes a new device appear. It is honest as "which browsers are signed in", and it is
-- not a hardware attestation.

create table if not exists practice_session (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  user_id uuid not null,
  -- The cookie value. Not a fingerprint: this product does not fingerprint browsers, which would be
  -- tracking a person rather than identifying a device they chose to register.
  device_id text not null,
  device_label text,
  user_agent text,
  -- Set by the practice, not detected. "Trusted" means somebody said so.
  trusted boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Revocation locks this device out of the PRACTICE. It does not end the platform session.
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_reason text
);

create unique index if not exists idx_practice_session_device
  on practice_session(workspace_id, user_id, device_id);
create index if not exists idx_practice_session_live
  on practice_session(workspace_id, user_id, last_seen_at desc) where revoked_at is null;

-- ---- 2. The security policy ------------------------------------------------------------------------------
--
-- One row per practice. MFA REQUIRED IS A POLICY, AND THE ENFORCEMENT IS THE PLATFORM'S: this product
-- does not issue tokens. What it can do -- and does -- is refuse to open the practice when the policy
-- demands a second factor and the session does not carry one. Defaulted OFF so no existing practice is
-- locked out by a migration.

create table if not exists practice_security_policy (
  workspace_id uuid primary key references practice_workspace(id) on delete cascade,
  mfa_required boolean not null default false,
  -- Break-glass may be turned off entirely for a practice that would rather refuse than log.
  break_glass_enabled boolean not null default true,
  break_glass_minutes integer not null default 60 check (break_glass_minutes between 5 and 1440),
  -- How long a session may sit unused before the shell stops accepting it. NULL = no limit, which is
  -- the honest default: inventing a number would be a security claim nobody asked for.
  session_idle_minutes integer check (session_idle_minutes is null or session_idle_minutes between 5 and 43200),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ---- 3. Patient consent ----------------------------------------------------------------------------------
--
-- STANDING CONSENT, WHICH IS NOT CPR-150'S PROCEDURE CONSENT. That column records consent for one
-- operation, at one moment, by the person performing it. This records the durable permissions a patient
-- gives a practice: to hold their record, to share it with a named party, to be contacted, to be
-- photographed. Merging them would make "did they consent" a question with two answers.
--
-- WITHDRAWAL IS NEVER A DELETE. A withdrawn consent is the most important consent row in the table --
-- it is the one that says a practice may no longer do something it previously could, and erasing it
-- would erase the instruction along with the permission.

create table if not exists practice_consent (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  consent_type text not null
    check (consent_type in ('treatment', 'data_holding', 'data_sharing', 'contact', 'photography', 'research', 'other')),
  -- Who it was given to, where that is narrower than the practice -- a named hospital, a named insurer.
  scope text,
  granted_on date not null default current_date,
  -- NULL means it does not expire. Recorded as null rather than a far-future date, so "does this
  -- expire" is answerable without comparing against a sentinel.
  expires_on date,
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  withdrawal_reason text,
  -- How it was obtained. A consent with no evidence is a claim; naming the form or the conversation is
  -- the difference between a record and an assertion.
  evidence text,
  recorded_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_practice_consent_patient
  on practice_consent(workspace_id, patient_id, consent_type);
create index if not exists idx_practice_consent_expiry
  on practice_consent(workspace_id, expires_on) where withdrawn_at is null;

-- ---- 4. Break-glass --------------------------------------------------------------------------------------
--
-- EMERGENCY ACCESS TO A RECORD SOMEBODY WOULD NOT NORMALLY OPEN. A real clinical concept, not a
-- checkbox: the unconscious patient whose notes are held by a colleague who is off duty.
--
-- FOUR PROPERTIES, AND IT IS WORTHLESS WITHOUT ALL FOUR:
--   SELF-GRANTED   nobody is available to approve it -- that is the situation it exists for. CPR-310's
--                  delegation rule (you cannot grant yourself) is deliberately NOT applied here, and
--                  this is the one place in the product where that is right.
--   REASON GIVEN   free text, required, and stored. "Why did you open this" must be answerable.
--   TIME-BOXED     it expires on its own. An emergency that lasts a fortnight is not an emergency.
--   LOUD           it is never silent: an audit event, an access-log entry, and a standing item on the
--                  security page until somebody reviews it.
--
-- The review is a person saying they looked, with a note. Nothing auto-reviews.

create table if not exists practice_break_glass (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  user_id uuid not null,
  patient_id uuid references practice_patient(id) on delete set null,
  reason text not null check (char_length(reason) between 10 and 1000),
  capabilities jsonb not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text
);

create index if not exists idx_practice_break_glass_open
  on practice_break_glass(workspace_id, reviewed_at, started_at desc);
create index if not exists idx_practice_break_glass_live
  on practice_break_glass(workspace_id, user_id, expires_at) where ended_at is null;

-- ---- 5. Break-glass grants are visible as their own kind -------------------------------------------------
--
-- practice_role_assignment.source has allowed role_default / explicit_grant / delegation since 191.
-- Break-glass adds a fourth, so an emergency grant can never be mistaken for a delegation on the team
-- page -- which is the whole point of it being loud.

alter table practice_role_assignment drop constraint if exists practice_role_assignment_source_check;
alter table practice_role_assignment add constraint practice_role_assignment_source_check
  check (source in ('role_default', 'explicit_grant', 'delegation', 'break_glass'));

alter table practice_role_assignment add column if not exists break_glass_id uuid references practice_break_glass(id) on delete set null;
create index if not exists idx_practice_role_assignment_break_glass
  on practice_role_assignment(break_glass_id) where break_glass_id is not null;

-- ---- 6. Capabilities ---------------------------------------------------------------------------------------
--
-- Sessions, devices and the policy are practice.settings.manage -- practice administration. Consent is
-- patient.edit, because recording what a patient agreed to is part of keeping their record. Break-glass
-- needs NO capability by design: the person invoking it is by definition somebody who lacks the access.
-- Reviewing one takes access.review, which is CPR-370's existing audit permission.

-- ---- 7. RLS: deny-by-default -------------------------------------------------------------------------------

alter table practice_session enable row level security;
alter table practice_security_policy enable row level security;
alter table practice_consent enable row level security;
alter table practice_break_glass enable row level security;

notify pgrst, 'reload schema';
