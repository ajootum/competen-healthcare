-- ====================================================================================================
-- MIGRATION 373: THE COMPETEN PROFESSIONAL RECORD -- PROFILE, NEEDS, PLAN, CPD AND EVIDENCE
--
-- COMPETEN-IND-007 (Professional MVP). COMPETEN-IND-002 sections 4.1, 4.2 and 5.1. ADR-016 and the owner
-- rulings D1, D3, D5, D6 and D10.
--
-- APPLY ON STAGING FIRST. It creates six new tables and one private storage bucket. It alters no
-- existing table, row, policy or constraint. Nothing reads it until the Professional code ships, and
-- re-running it is a no-op.
--
-- INDEPENDENT OF 372 (Scholar). It depends only on profiles, frameworks and framework_competencies
-- (migration 003), passport_share_tokens (migration 122) and storage.buckets. It does not depend on 370
-- either: the gate decides who may write here, and the gate lives in the application guards.
--
-- ----------------------------------------------------------------------------------------------------
-- WHY THESE ARE NEW TABLES AND NOT cpd_logs OR professional_credentials (owner ruling D1).
--
-- Institutional analytics find the staff of a hospital by profiles.hospital_id and read ALL of their
-- person-keyed rows with no origin filter (src/lib/operations/pd-cpd.ts reads cpd_logs, the reminder
-- console reads cdp_reminders by hospital, hospital verifiers read evidence by hospital_id). A CPD entry
-- or a licence a person keeps in Competen Professional, written into those tables, would be visible to
-- their next employer the day profiles.hospital_id is set. So the Professional record lives HERE, in
-- tables no institutional reader queries, with NO hospital_id or organisation column to scope by. The
-- leak is unrepresentable rather than filtered by every reader.
--
-- ----------------------------------------------------------------------------------------------------
-- EVIDENCE CLASSES (COMPETEN-IND-002 section 4.2), AND WHY "VERIFIED" CANNOT BE STORED HERE.
--
--   self_declared   the person typed it, with no document attached
--   source_linked   the person typed it AND attached a document (a certificate, a letter)
--
-- Individual creates only these two. institution_issued records stay in the estate tables that issued
-- them and are shown read-only (D3). independently_verified needs a checker with authority that does not
-- exist yet. So there is no verified column, no verified_by and no status that means verified, on any
-- table in this file. And evidence_class is a GENERATED column: it is computed from whether a document
-- is attached, so no writer can store a class the row does not support. Attaching a document makes an
-- item source_linked. It never makes it verified.
--
-- THE PROFILE FOLLOWS MIGRATION 270 (D5). The provenance travels in the column NAME --
-- self_declared_profession, self_declared_registration_number -- so no select, export, log line or
-- payload key can render a registration number without the word that says nobody checked it. This is
-- the own identity record of Competen Individual. It is NOT practice_practitioner_identity, and no foreign
-- key joins the two. A future link to Practice needs governed consent.
--
-- ----------------------------------------------------------------------------------------------------
-- HOUSE RULES (scripts/migration-house-rules.ts), CHECKED BY RUNNING IT, NOT BY EYE.
--
--   1. ASCII only. No semicolons inside any comment or string literal.
--   2. No plpgsql, no do-blocks, no functions. So no APPLY-WHOLE banner is required.
--   3. No partial unique indexes. Every unique index is FULL.
--   4. experience_code (the experience a record was made in) is NOT NULL with NO DEFAULT. A writer that
--      does not say where a record came from FAILS.
--   5. RLS ON, own-row SELECT policies only (D6). No INSERT, UPDATE or DELETE policy. Writes go through
--      the service role behind requireIndividualContext, or not at all.
--   6. Cross-person links are unrepresentable. A goal may point only at its own person need, and a CPD
--      entry only at its own person goal, by COMPOSITE foreign keys on (id, user_id). A document path must
--      begin with its own person id.
--   7. notify pgrst LAST.
-- ====================================================================================================


-- ---- 1. individual_professional_profile -- THE PROFESSIONAL IDENTITY RECORD (D5) -------------------

create table if not exists individual_professional_profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  self_declared_profession text,
  self_declared_registration_body text,
  self_declared_registration_number text,
  self_declared_registration_country text,
  self_declared_registration_expires_on date,
  registration_reminded_for date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_individual_professional_profile_user
  on individual_professional_profile(user_id);

alter table individual_professional_profile drop constraint if exists individual_professional_profile_experience_check;
alter table individual_professional_profile add constraint individual_professional_profile_experience_check
  check (experience_code in ('scholar', 'professional'));

alter table individual_professional_profile drop constraint if exists individual_professional_profile_lengths;
alter table individual_professional_profile add constraint individual_professional_profile_lengths
  check (char_length(coalesce(self_declared_profession, '')) <= 120
     and char_length(coalesce(self_declared_registration_body, '')) <= 160
     and char_length(coalesce(self_declared_registration_number, '')) <= 60
     and char_length(coalesce(self_declared_registration_country, '')) <= 80);

-- A reminder is recorded only for the expiry date it was about. If the person changes the date, the
-- recorded value no longer matches and the new date is reminded once.
alter table individual_professional_profile drop constraint if exists individual_professional_profile_reminder_matches;
alter table individual_professional_profile add constraint individual_professional_profile_reminder_matches
  check (registration_reminded_for is null or registration_reminded_for = self_declared_registration_expires_on);

alter table individual_professional_profile enable row level security;
drop policy if exists individual_professional_profile_read_own on individual_professional_profile;
create policy individual_professional_profile_read_own on individual_professional_profile
  for select using (auth.uid() = user_id);

comment on table individual_professional_profile is
  'COMPETEN-IND-007, owner ruling D5. The person-owned professional identity in Competen Individual. Every fact is self-declared and says so in its column name (migration 270 vocabulary). Not practice_practitioner_identity. No hospital or organisation column, so no institutional reader can scope to it.';


-- ---- 2. individual_professional_need -- DEVELOPMENT NEEDS --------------------------------------------

create table if not exists individual_professional_need (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  title text not null,
  detail text,
  origin text not null,
  framework_id uuid references frameworks(id) on delete set null,
  framework_competency_id uuid references framework_competencies(id) on delete set null,
  status text not null default 'open',
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_individual_professional_need_id_user
  on individual_professional_need(id, user_id);
create index if not exists idx_individual_professional_need_user
  on individual_professional_need(user_id, status, created_at desc);

alter table individual_professional_need drop constraint if exists individual_professional_need_experience_check;
alter table individual_professional_need add constraint individual_professional_need_experience_check
  check (experience_code in ('scholar', 'professional'));

-- self_identified: the person named it. passport_gap: the person raised it from an assessed competency in
-- their Passport that is not current. Either way it is the person who records it.
alter table individual_professional_need drop constraint if exists individual_professional_need_origin_check;
alter table individual_professional_need add constraint individual_professional_need_origin_check
  check (origin in ('self_identified', 'passport_gap'));

alter table individual_professional_need drop constraint if exists individual_professional_need_status_check;
alter table individual_professional_need add constraint individual_professional_need_status_check
  check (status in ('open', 'met', 'closed'));

alter table individual_professional_need drop constraint if exists individual_professional_need_closed_when;
alter table individual_professional_need add constraint individual_professional_need_closed_when
  check ((status = 'open') = (closed_at is null));

alter table individual_professional_need drop constraint if exists individual_professional_need_lengths;
alter table individual_professional_need add constraint individual_professional_need_lengths
  check (char_length(btrim(title)) between 3 and 200 and char_length(coalesce(detail, '')) <= 2000);

alter table individual_professional_need enable row level security;
drop policy if exists individual_professional_need_read_own on individual_professional_need;
create policy individual_professional_need_read_own on individual_professional_need
  for select using (auth.uid() = user_id);

comment on column individual_professional_need.framework_id is
  'Optional. A SHARED framework only (frameworks.hospital_id is null), enforced by the application and pinned by scripts/individual-professional-harness.ts. A hospital framework is that organisation content.';


-- ---- 3. individual_professional_goal -- THE LEARNING PLAN ---------------------------------------------

create table if not exists individual_professional_goal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  need_id uuid,
  title text not null,
  detail text,
  target_date date not null,
  status text not null default 'planned',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Composite: a goal can only point at a need of the SAME person. Deleting the need keeps the goal and
-- clears only the link (the column list on set null leaves user_id alone).
alter table individual_professional_goal drop constraint if exists individual_professional_goal_need_fk;
alter table individual_professional_goal add constraint individual_professional_goal_need_fk
  foreign key (need_id, user_id) references individual_professional_need(id, user_id) on delete set null (need_id);

create unique index if not exists ux_individual_professional_goal_id_user
  on individual_professional_goal(id, user_id);
create index if not exists idx_individual_professional_goal_user
  on individual_professional_goal(user_id, status, target_date);

alter table individual_professional_goal drop constraint if exists individual_professional_goal_experience_check;
alter table individual_professional_goal add constraint individual_professional_goal_experience_check
  check (experience_code in ('scholar', 'professional'));

alter table individual_professional_goal drop constraint if exists individual_professional_goal_status_check;
alter table individual_professional_goal add constraint individual_professional_goal_status_check
  check (status in ('planned', 'in_progress', 'done', 'dropped'));

-- Done says when. A done goal with no completion time is a claim with nothing behind it.
alter table individual_professional_goal drop constraint if exists individual_professional_goal_done_when;
alter table individual_professional_goal add constraint individual_professional_goal_done_when
  check ((status = 'done') = (completed_at is not null));

alter table individual_professional_goal drop constraint if exists individual_professional_goal_lengths;
alter table individual_professional_goal add constraint individual_professional_goal_lengths
  check (char_length(btrim(title)) between 3 and 200 and char_length(coalesce(detail, '')) <= 2000);

alter table individual_professional_goal enable row level security;
drop policy if exists individual_professional_goal_read_own on individual_professional_goal;
create policy individual_professional_goal_read_own on individual_professional_goal
  for select using (auth.uid() = user_id);


-- ---- 4. individual_professional_cpd -- THE PRIVATE CPD LOG --------------------------------------------
--
-- The fields of cpd_logs (activity_type, title, hours, cpd_points, activity_date, certificate) WITHOUT
-- its verified column, plus a reflection and an optional link to a goal in the plan.

create table if not exists individual_professional_cpd (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  goal_id uuid,
  activity_type text not null,
  title text not null,
  provider text,
  hours numeric(5,1) not null,
  cpd_points integer,
  activity_date date not null,
  reflection text,
  document_path text,
  document_name text,
  document_mime text,
  document_bytes integer,
  evidence_class text generated always as
    (case when document_path is null then 'self_declared' else 'source_linked' end) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table individual_professional_cpd drop constraint if exists individual_professional_cpd_goal_fk;
alter table individual_professional_cpd add constraint individual_professional_cpd_goal_fk
  foreign key (goal_id, user_id) references individual_professional_goal(id, user_id) on delete set null (goal_id);

create index if not exists idx_individual_professional_cpd_user
  on individual_professional_cpd(user_id, activity_date desc);

alter table individual_professional_cpd drop constraint if exists individual_professional_cpd_experience_check;
alter table individual_professional_cpd add constraint individual_professional_cpd_experience_check
  check (experience_code in ('scholar', 'professional'));

alter table individual_professional_cpd drop constraint if exists individual_professional_cpd_type_check;
alter table individual_professional_cpd add constraint individual_professional_cpd_type_check
  check (activity_type in ('course', 'workshop', 'conference', 'self_study', 'simulation', 'osce', 'teaching', 'research', 'other'));

alter table individual_professional_cpd drop constraint if exists individual_professional_cpd_hours_check;
alter table individual_professional_cpd add constraint individual_professional_cpd_hours_check
  check (hours > 0 and hours <= 1000 and (cpd_points is null or cpd_points between 0 and 1000));

alter table individual_professional_cpd drop constraint if exists individual_professional_cpd_lengths;
alter table individual_professional_cpd add constraint individual_professional_cpd_lengths
  check (char_length(btrim(title)) between 3 and 200
     and char_length(coalesce(provider, '')) <= 160
     and char_length(coalesce(reflection, '')) <= 5000);

-- A document is all four columns or none, and its path begins with the owner id, so a row can never
-- point at another person document in the bucket.
alter table individual_professional_cpd drop constraint if exists individual_professional_cpd_document_whole;
alter table individual_professional_cpd add constraint individual_professional_cpd_document_whole
  check ((document_path is null) = (document_name is null)
     and (document_path is null) = (document_mime is null)
     and (document_path is null) = (document_bytes is null)
     and (document_path is null or document_path like user_id::text || '/%'));

alter table individual_professional_cpd enable row level security;
drop policy if exists individual_professional_cpd_read_own on individual_professional_cpd;
create policy individual_professional_cpd_read_own on individual_professional_cpd
  for select using (auth.uid() = user_id);

comment on table individual_professional_cpd is
  'COMPETEN-IND-007, owner ruling D1. The person private CPD log. Not cpd_logs, which hospital analytics read by hospital. No verified column: evidence_class is generated from whether a document is attached.';


-- ---- 5. individual_professional_evidence -- CREDENTIALS AND COMPETENCY EVIDENCE ----------------------

create table if not exists individual_professional_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  kind text not null,
  need_id uuid,
  title text not null,
  detail text,
  issuing_body text,
  issued_on date,
  expires_on date,
  framework_id uuid references frameworks(id) on delete set null,
  framework_competency_id uuid references framework_competencies(id) on delete set null,
  expiry_reminded_for date,
  document_path text,
  document_name text,
  document_mime text,
  document_bytes integer,
  evidence_class text generated always as
    (case when document_path is null then 'self_declared' else 'source_linked' end) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table individual_professional_evidence drop constraint if exists individual_professional_evidence_need_fk;
alter table individual_professional_evidence add constraint individual_professional_evidence_need_fk
  foreign key (need_id, user_id) references individual_professional_need(id, user_id) on delete set null (need_id);

create index if not exists idx_individual_professional_evidence_user
  on individual_professional_evidence(user_id, kind, created_at desc);
create index if not exists idx_individual_professional_evidence_expiry
  on individual_professional_evidence(expires_on);

alter table individual_professional_evidence drop constraint if exists individual_professional_evidence_experience_check;
alter table individual_professional_evidence add constraint individual_professional_evidence_experience_check
  check (experience_code in ('scholar', 'professional'));

-- credential: a qualification, licence or certificate the person holds. competency: something the
-- person documents about their own practice, optionally against a shared framework competency.
alter table individual_professional_evidence drop constraint if exists individual_professional_evidence_kind_check;
alter table individual_professional_evidence add constraint individual_professional_evidence_kind_check
  check (kind in ('credential', 'competency'));

-- Expiry belongs to credentials. And it can only be reminded for the date it now holds.
alter table individual_professional_evidence drop constraint if exists individual_professional_evidence_dates;
alter table individual_professional_evidence add constraint individual_professional_evidence_dates
  check ((kind = 'credential' or expires_on is null)
     and (issued_on is null or expires_on is null or expires_on >= issued_on)
     and (expiry_reminded_for is null or expiry_reminded_for = expires_on));

alter table individual_professional_evidence drop constraint if exists individual_professional_evidence_lengths;
alter table individual_professional_evidence add constraint individual_professional_evidence_lengths
  check (char_length(btrim(title)) between 3 and 200
     and char_length(coalesce(detail, '')) <= 5000
     and char_length(coalesce(issuing_body, '')) <= 160);

alter table individual_professional_evidence drop constraint if exists individual_professional_evidence_document_whole;
alter table individual_professional_evidence add constraint individual_professional_evidence_document_whole
  check ((document_path is null) = (document_name is null)
     and (document_path is null) = (document_mime is null)
     and (document_path is null) = (document_bytes is null)
     and (document_path is null or document_path like user_id::text || '/%'));

alter table individual_professional_evidence enable row level security;
drop policy if exists individual_professional_evidence_read_own on individual_professional_evidence;
create policy individual_professional_evidence_read_own on individual_professional_evidence
  for select using (auth.uid() = user_id);

comment on table individual_professional_evidence is
  'COMPETEN-IND-007, owner ruling D1. Credentials and competency evidence the person keeps themselves. Not professional_credentials or evidence, which hospital staff read by hospital. No verified column: evidence_class is generated from whether a document is attached.';


-- ---- 6. individual_professional_share -- WHICH PASSPORT LINKS CARRY THE PERSON OWN RECORDS -----------
--
-- Sharing reuses passport_share_tokens and /verify (migration 122). A link minted from Competen
-- Professional ALSO gets a row here, and /verify shows the person own records ONLY when that row
-- exists. So a link minted anywhere else can never disclose them: the companion row is the consent.
-- The share token row itself carries no Professional content.

create table if not exists individual_professional_share (
  share_token_id uuid primary key references passport_share_tokens(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_individual_professional_share_user
  on individual_professional_share(user_id);

alter table individual_professional_share drop constraint if exists individual_professional_share_experience_check;
alter table individual_professional_share add constraint individual_professional_share_experience_check
  check (experience_code in ('scholar', 'professional'));

alter table individual_professional_share enable row level security;
drop policy if exists individual_professional_share_read_own on individual_professional_share;
create policy individual_professional_share_read_own on individual_professional_share
  for select using (auth.uid() = user_id);


-- ---- 7. THE PRIVATE DOCUMENT BUCKET ---------------------------------------------------------------
--
-- Not the estate evidence bucket: its rows are read by hospital verifiers through the evidence table.
-- Server-mediated with NO storage policies, the posture COMP-ENG-002D section 5 approved and migration
-- 336 recorded. Every download is a short-lived signed URL issued after the owner check.
-- ON CONFLICT DO NOTHING, as in 336: an existing bucket keeps its configuration.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'individual-professional-evidence', 'individual-professional-evidence', false, 10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
