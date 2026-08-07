-- ============================================================
-- MIGRATION 254: PATIENT BOOKING ACCESS -- THE THREE STORES PHASE 4 HAS BEEN NAMING AND NOT HAVING
-- CPR-V5-007 s8, s8.1, s9, s12
--
-- ----------------------------------------------------------------------------------------------------
-- ONE FILE, BECAUSE THESE THREE REFERENCE EACH OTHER.
--
-- practice_booking_request points at practice_booking_access. Splitting cross-referencing tables across
-- separately applied migrations is what produced the 231/240 duplication and the CPL/LCP problem: the
-- first half lands, the second is applied later or not at all, and in between there is a schema that
-- half-describes a feature. These arrive together or not at all.
--
-- src/lib/practice/patient-access.ts storePresence() already PROBES for exactly these three names and
-- reports each as present or absent. It selects `id` and nothing else, so every table below has an `id`.
-- When this migration lands that probe changes its answer on its own, with no code change -- which was
-- the point of probing rather than remembering.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT A PATIENT BOOKING IS, AND WHAT IT IS NOT
--
-- A confirmed patient booking DOES become a real appointment in practice_appointment, with no
-- practitioner approval step. That is the product decision: patients book, and the diary fills.
--
-- WARNING: WITH APPROVAL GONE, THREE CONTROLS CARRY THE WEIGHT, AND THIS SCHEMA EXISTS TO LET THEM WORK
-- RATHER THAN TO REPLACE THEM.
--
--   1. THE ONE-TIME CODE. The person booking proved control of a phone or an inbox. practice_otp_challenge
--      (224, hardened since) does that, and the constraints below refuse a booked request that cannot
--      name the challenge that verified it.
--   2. THE BOOKING RULE FOR THE CHANNEL. s7.3 already lets a practice say "staff may book at two hours'
--      notice, patients at two days". A patient booking resolves through resolveBookingRule like every
--      other booking, and the constraints below refuse a booked request that did not record which rule
--      and which VERSION decided it. s11's last line and AC-13 both require the pair.
--   3. THE PLACEMENT CHECK. checkPlacement() is the one funnel every write path passes through, and since
--      the lifecycle brakes it also refuses an archived or suspended practice. Nothing here goes round it.
--
-- SO WHAT IS practice_booking_request FOR, IF IT IS NOT A GATE? It is the record of what the patient
-- ASKED FOR and what was decided, and it earns its place on four things practice_appointment cannot hold:
--
--   - s9's intake. Reason for visit, referral source, guardian, and the patient's own account of their
--     diagnosis and treatment. practice_appointment has patient_name, patient_phone and reason. There is
--     nowhere else for the rest of a stranger's answers to go.
--   - THE REFUSALS. A patient turned away leaves no appointment row at all. Without this table, "how many
--     people tried to book and could not" is answerable only with silence -- the same argument migration
--     224 made for recording refused messages rather than only sent ones.
--   - THE VERIFICATION. Which challenge proved this person, and when. An appointment row cannot say.
--   - THE PATIENT'S OWN WORDS, KEPT APART FROM THE CLINICAL RECORD. s9 puts patient-reported diagnosis
--     and treatment in the booking intake and says "clearly labelled". Every such column below is
--     prefixed `stated_`, so nothing can lift one into a clinical field without renaming it first.
--
-- IT NEVER HOLDS THE SLOT. The appointment row holds the slot, and migration 255 makes overlapping
-- appointments impossible in the database. A request is provenance, not a reservation, and nothing should
-- ever read this table to decide whether a time is free.
--
-- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
-- the end of a statement -- the runner splits on them, and a semicolon inside a comment silently drops
-- the statements around it while still reporting success. That happened on migration 238.
-- ============================================================

-- ====================================================================================================
-- 1. THE BOOKING ACCESS PROFILE (s12 BookingAccessProfile, s8, s8.1)
-- ====================================================================================================
--
-- s12: "BookingAccessProfile | mode, handle, OTP, branding, publish status | belongs to practice."
--
-- WARNING: THE HANDLE IS NOT INVENTED HERE, AND THAT IS THE MOST IMPORTANT LINE IN THIS TABLE.
--
-- A handle namespace already exists. Migration 218 gave practice_practitioner_identity a unique handle
-- constrained to '^[a-z][a-z0-9]{2,29}$', practice_reserved_handle keeps 'admin', 'support' and friends
-- unclaimable, and practice_handle_history keeps a released handle claimed forever so that printed cards
-- and QR codes carrying it never point at a stranger. A second, independent handle column here would be a
-- second namespace: one that knows nothing about reserved names, nothing about retired ones, and that
-- could drift out of step with the identity the moment somebody changed theirs.
--
-- So this is a FOREIGN KEY onto that namespace, ON UPDATE CASCADE. Changing a handle in the identity
-- service moves the booking page with it in the same transaction. The charset check is repeated rather
-- than merely inherited, because a constraint that only exists in another table is one a future ALTER can
-- remove without anybody reading this file.
--
-- WHAT A HANDLE COLLISION OR AN ENUMERATION SWEEP WOULD REVEAL, AND WHY IT IS BOUNDED:
--   - A COLLISION IS IMPOSSIBLE. The FK plus ux_practice_booking_access_handle mean one handle addresses
--     at most one booking page, so nobody's patients can be routed to somebody else by claiming a name.
--   - A SWEEP IS CHEAP TO RUN. Three to thirty lowercase alphanumerics is a small space and the URL is
--     public by design -- s8's link-only mode is secret-by-obscurity and this file does not pretend
--     otherwise. What bounds the damage is that an unpublished profile MUST NOT RESOLVE: publish_state is
--     explicit, defaults to 'draft', and /@handle already answers a handle that resolves to nothing and a
--     handle never issued identically. A sweep therefore learns which practices chose to be findable,
--     which is what publishing means, and nothing about the ones that did not.

create table if not exists practice_booking_access (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,

  -- NULLABLE, because a practice configures its page before it has an address, and because
  -- practice_practitioner_identity.handle is itself nullable when suggestHandle found nothing free.
  -- Publishing without one is refused further down.
  handle text
    references practice_practitioner_identity(handle) on update cascade on delete restrict
    check (handle is null or handle ~ '^[a-z][a-z0-9]{2,29}$'),

  -- s8's four modes, and the codes are verbatim the ones PATIENT_ACCESS_MODES already exports, so the
  -- engine's list and this constraint cannot disagree about what a mode is called.
  mode text not null default 'internal_only'
    check (mode in ('public', 'link_only', 'internal_only', 'paused')),

  -- s8.1: "Booking page state: Draft, Ready, Published, Published with warnings or Paused."
  --
  -- DRAFT BY DEFAULT, AND SEPARATE FROM MODE ON PURPOSE. Mode says who may reach the page. State says
  -- whether it exists yet. Collapsing them would make choosing 'link_only' publish the page, which is a
  -- configuration choice quietly becoming an act.
  publish_state text not null default 'draft'
    check (publish_state in ('draft', 'ready', 'published', 'published_with_warnings', 'paused')),

  -- ---- OTP AND ABUSE PROTECTION (s8.1) -------------------------------------------------------------
  --
  -- TRUE, AND THERE IS A CONSTRAINT BELOW REFUSING TO PUBLISH WITHOUT IT. With practitioner approval gone
  -- this is the only thing standing between the diary and anybody who can type a name, so it is not a
  -- preference. The column exists rather than being assumed so that turning it off is visible as a row
  -- somebody changed, not merely as an absence.
  otp_required boolean not null default true,
  otp_channel text not null default 'any' check (otp_channel in ('sms', 'email', 'any')),

  -- ---- WHO MAY BOOK (s8.1) -------------------------------------------------------------------------
  --
  -- s8.1: "Guest booking versus account-required booking."
  guest_booking_allowed boolean not null default true,

  -- s8.1: "Existing-patient matching without exposing patient records." FALSE BY DEFAULT. Matching a
  -- stranger's answers against the patient register is a disclosure surface even when it returns nothing
  -- -- a "we found you" that differs from a "we did not" is a yes/no oracle on whether a named person is
  -- a patient here. Off unless a practice turns it on knowing that.
  existing_patient_matching boolean not null default false,

  -- ---- WHAT IS VISIBLE (s8.1 "Visible locations and appointment types") ----------------------------
  --
  -- EMPTY MEANS NOTHING IS VISIBLE, NOT EVERYTHING. The other reading would make creating a row publish
  -- every location and every appointment type the practice has, which is the wrong direction for a
  -- default nobody chose.
  --
  -- WARNING: THE LOCATION ARRAY CANNOT BE A FOREIGN KEY. Postgres will not point an array at another
  -- table, so nothing here stops a location id belonging to a DIFFERENT practice being written -- the
  -- exact cross-tenant hole checkPlacement's own comment describes for practice_appointment.location_id.
  -- The engine must verify every id against this workspace before writing, and the harness must prove it.
  visible_location_ids uuid[] not null default '{}'::uuid[],
  visible_appointment_types text[] not null default '{}'::text[],

  -- ---- BRANDING, INSTRUCTIONS, PRIVACY (s8.1) ------------------------------------------------------
  --
  -- s8.1: "Branding, instructions, privacy notice and data-capture consent."
  --
  -- brand_display_name is what the PAGE calls this practice, which is not necessarily what the workspace
  -- is called internally. A practice that trades as one name and is registered as another would otherwise
  -- have to rename itself everywhere to fix a public page.
  brand_display_name text check (brand_display_name is null or char_length(btrim(brand_display_name)) between 1 and 160),
  instructions text check (instructions is null or char_length(instructions) between 1 and 4000),
  privacy_notice text check (privacy_notice is null or char_length(privacy_notice) between 1 and 8000),

  -- s9's consent row is "Data capture and communication consent", owned by the consent service. This is
  -- the WORDING the page shows and whether it is required, not the consent itself -- the answer a patient
  -- gives is recorded on their request.
  consent_text text check (consent_text is null or char_length(consent_text) between 1 and 4000),
  consent_required boolean not null default true,

  -- ---- LIFECYCLE ----------------------------------------------------------------------------------
  published_at timestamptz,
  published_by uuid,
  paused_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- WARNING: WHAT PUBLISHING REFUSES.
--
-- s10.2 lists the publish blockers and most of them are facts about other tables that only an engine can
-- check. These three are facts about THIS ROW, so they belong here rather than in whichever screen
-- happens to call publish:
--
--   NO HANDLE, NO PUBLISHED PAGE. A published profile with no address is a page nobody can reach that
--   nonetheless reports itself live.
--   NO ONE-TIME CODE, NO PUBLISHED PAGE. See otp_required above. This is the constraint that stops the
--   verification being switched off in the same afternoon somebody decides it is inconvenient.
--   NO MODE THAT ADMITS A PATIENT, NO PUBLISHED PAGE. Publishing while 'internal_only' is a contradiction
--   the screen would otherwise have to explain after the fact.
alter table practice_booking_access drop constraint if exists practice_booking_access_publishable;
alter table practice_booking_access add constraint practice_booking_access_publishable
  check (publish_state not in ('published', 'published_with_warnings')
      or (handle is not null and otp_required and mode in ('public', 'link_only')));

-- The appointment types a practice may expose are the ones practice_appointment actually accepts. An
-- unenforced list here would let a page offer a type no booking could ever be made with.
alter table practice_booking_access drop constraint if exists practice_booking_access_types_known;
alter table practice_booking_access add constraint practice_booking_access_types_known
  check (visible_appointment_types <@ array['new_consultation', 'scheduled_followup', 'walk_in',
    'emergency', 'hospital_consultation', 'teleconsultation', 'home_visit']::text[]);

-- ONE PROFILE PER PRACTICE. s12 says the profile belongs to the practice, and two would make "is this
-- page published" a question with two answers. workspace_id is NOT NULL, so this is also a safe
-- on-conflict target -- unlike a key with a nullable part, where NULL is distinct from NULL and both the
-- uniqueness and the upsert quietly stop working. See migration 245's comment.
create unique index if not exists ux_practice_booking_access_workspace
  on practice_booking_access(workspace_id);

-- ONE PAGE PER HANDLE. Partial because a draft profile legitimately has no handle yet, and because in an
-- index NULL is distinct from NULL -- so unpublished drafts do not collide with each other.
create unique index if not exists ux_practice_booking_access_handle
  on practice_booking_access(handle) where handle is not null;

-- The patient-facing resolve: a handle, and only if it is actually published. Indexed together so the
-- unpublished case is answered without reading the row.
create index if not exists idx_practice_booking_access_published
  on practice_booking_access(handle) where publish_state in ('published', 'published_with_warnings');

alter table practice_booking_access enable row level security;

-- ====================================================================================================
-- 2. THE BOOKING REQUEST (s12 BookingRequest, s9's intake)
-- ====================================================================================================
--
-- s12: "BookingRequest | patient ref, occurrence, type, channel, status, applied rule/version | may
-- become appointment/encounter."
--
-- "MAY BECOME" IS THE WHOLE SHAPE OF THIS TABLE. appointment_id is the one place the two meet, it is
-- nullable, and it is unique -- so a request becomes at most one appointment and an appointment is
-- claimed by at most one request. A refused request has no appointment and never will.

create table if not exists practice_booking_request (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,

  -- Which page it came through. Nullable and ON DELETE SET NULL: reconfiguring or deleting a booking page
  -- must not erase the record of the bookings made through it.
  access_id uuid references practice_booking_access(id) on delete set null,

  -- ---- WHAT WAS ASKED FOR (s12 "occurrence, type, channel") ---------------------------------------
  --
  -- The slot the patient picked, where they picked one. ON DELETE SET NULL because generated slots are
  -- reaped and regenerated by the availability engine, and a request must not vanish with one.
  --
  -- NOT A RESERVATION. Nothing may read this column to decide whether a time is free -- see the header.
  slot_id uuid references practice_availability_slot(id) on delete set null,
  location_id uuid references practice_location(id) on delete set null,

  appointment_type text not null default 'new_consultation'
    check (appointment_type in ('new_consultation', 'scheduled_followup', 'walk_in', 'emergency',
                               'hospital_consultation', 'teleconsultation', 'home_visit')),

  -- s7.3's six channels. Defaulted to the one this table exists for, and constrained rather than assumed
  -- so that a staff-entered request recorded here is distinguishable from a patient-entered one.
  channel text not null default 'patient_self'
    check (channel in ('patient_self', 'practitioner', 'staff', 'referral', 'follow_up', 'walk_in')),

  requested_start timestamptz not null,
  requested_minutes integer not null default 20 check (requested_minutes between 5 and 480),

  -- ---- WHERE IT GOT TO -----------------------------------------------------------------------------
  --
  -- 'submitted'  answers given, code not yet verified
  -- 'verified'   the code was correct, the booking not yet made
  -- 'booked'     an appointment exists, and appointment_id names it
  -- 'refused'    a rule, the diary or the practice's state said no. refused_code says which
  -- 'withdrawn'  the patient abandoned it
  -- 'expired'    nobody finished it inside the code's five minutes
  status text not null default 'submitted'
    check (status in ('submitted', 'verified', 'booked', 'refused', 'withdrawn', 'expired')),

  appointment_id uuid references practice_appointment(id) on delete set null,

  -- ---- WHO PROVED THEY WERE REACHABLE (s8.1) -------------------------------------------------------
  --
  -- The challenge, never the code and never the destination. The destination is a phone number that
  -- already lives on the challenge row, and copying it here would put a stranger's number in a second
  -- table with a different retention story.
  challenge_id uuid references practice_otp_challenge(id) on delete set null,
  verified_at timestamptz,

  -- The same hashed source 253 added to the challenge, and the same constraint keeping it a hash. One
  -- caller submitting fifty requests is the abuse a per-destination limit cannot see.
  source_hash text check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$'),

  -- ---- WHICH RULE DECIDED IT (s11 last line, AC-13) ------------------------------------------------
  --
  -- Recorded on the REQUEST as well as on the appointment, because a REFUSED request has no appointment
  -- to carry it and "which rule turned this patient away" is the question a practitioner asks first.
  applied_rule_id uuid references practice_booking_rule(id) on delete set null,
  applied_rule_version integer,
  refused_code text check (refused_code is null or char_length(refused_code) between 1 and 60),
  refused_reason text check (refused_reason is null or char_length(refused_reason) between 1 and 500),

  -- ---- s9: IDENTITY. "Name, date of birth/age, sex. Ownership: Registration engine." ---------------
  --
  -- s9: "The booking workflow may request only the minimum information required to identify the patient
  -- and organise the encounter. Full patient registration is completed in the Patient Workspace."
  --
  -- These are the patient's ANSWERS, not a patient record. patient_id below is the record, when one is
  -- matched or created -- and until then these columns are all there is.
  given_name text check (given_name is null or char_length(btrim(given_name)) between 1 and 80),
  family_name text check (family_name is null or char_length(btrim(family_name)) between 1 and 80),
  birth_date date,
  -- Mirrors practice_patient.age_estimate_years, for the patient who knows their age and not their date
  -- of birth. Both nullable because a booking may honestly have neither.
  age_years integer check (age_years is null or age_years between 0 and 130),
  sex text not null default 'unspecified'
    check (sex in ('female', 'male', 'other', 'unknown', 'unspecified')),

  -- ---- s9: CONTACT. "Phone, email, guardian/representative." ---------------------------------------
  contact_phone text check (contact_phone is null or char_length(btrim(contact_phone)) between 3 and 40),
  contact_email text check (contact_email is null or char_length(btrim(contact_email)) between 3 and 160),

  -- s7.6: "Paediatric booking must support parent/guardian identity, relationship and contact
  -- information." The relationship vocabulary is migration 221's, not a second list -- three spellings of
  -- "mother" across two tables is how a report starts disagreeing with itself.
  representative_name text check (representative_name is null or char_length(btrim(representative_name)) between 2 and 160),
  representative_relationship text
    check (representative_relationship is null or representative_relationship in
      ('guardian', 'mother', 'father', 'spouse', 'partner', 'sibling', 'child', 'grandparent',
       'emergency_contact', 'interpreter', 'employer', 'insurance_contact', 'carer', 'social_worker', 'other')),
  representative_phone text check (representative_phone is null or char_length(btrim(representative_phone)) between 3 and 40),

  -- ---- s9: PRACTICE CONTEXT. "Reason for visit, referral source, selected location." ---------------
  reason_for_visit text check (reason_for_visit is null or char_length(reason_for_visit) between 1 and 1000),
  referral_source text check (referral_source is null or char_length(referral_source) between 1 and 200),

  -- ---- s9: PATIENT-REPORTED CONTEXT ----------------------------------------------------------------
  --
  -- s9: "Diagnosis and current treatment as stated by patient. Ownership: Booking intake, clearly
  -- labelled."
  --
  -- WARNING: THE `stated_` PREFIX IS THE LABEL, IN THE COLUMN NAME, WHERE IT CANNOT BE LOST.
  --
  -- A patient saying they have diabetes is not a diagnosis. A screen can label it, and the next screen
  -- can forget to -- but a column called stated_diagnosis cannot be copied into a clinical field without
  -- somebody typing a different name, which is the moment they have to decide whether they mean it. This
  -- is not the clinical record and nothing here may be promoted into one automatically.
  stated_diagnosis text check (stated_diagnosis is null or char_length(stated_diagnosis) between 1 and 1000),
  stated_treatment text check (stated_treatment is null or char_length(stated_treatment) between 1 and 1000),

  -- s9 puts facility identifiers under "Patient longitudinal record", and that is where the authoritative
  -- one lives: practice_patient_identifier, scoped to a location. This is the number a stranger TYPED,
  -- kept only so existing-patient matching has something to match on -- it is a claim, never an
  -- identifier of record, and the prefix says so.
  stated_hospital_number text check (stated_hospital_number is null or char_length(btrim(stated_hospital_number)) between 1 and 60),

  -- ---- s9: CONSENT. "Data capture and communication consent." --------------------------------------
  --
  -- The ANSWER, recorded here because at intake there is no patient record for the consent service to
  -- hang it off. Once a patient record exists the consent service owns the durable version -- these two
  -- columns are what the person clicked, at the moment they clicked it.
  consent_data_capture boolean not null default false,
  consent_communication boolean not null default false,
  consent_recorded_at timestamptz,

  -- ---- s9: DOCUMENTS -------------------------------------------------------------------------------
  --
  -- s9 lists "Referral letter, scan or supporting document. Ownership: Document service." THERE IS NO
  -- DOCUMENT SERVICE IN THIS BUILD, so there is no column here. A nullable document_id would imply an
  -- upload path that does not exist and would sit unused as evidence of a feature -- migration 198 took
  -- exactly this position on sent_at, and it was right.

  -- ---- THE PATIENT RECORD, IF THERE IS ONE ---------------------------------------------------------
  --
  -- Nullable and last, because for a new patient it is null until the registration engine makes one, and
  -- because a request must be readable without it.
  patient_id uuid references practice_patient(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- WARNING: WHAT A BOOKED REQUEST MUST BE ABLE TO PROVE.
--
-- With practitioner approval gone, these are the properties that replaced it, and they are constraints
-- rather than engine checks because an engine check is one refactor away from being skipped. A request
-- that reached 'booked' can always answer: which appointment, who verified you, and which rule allowed
-- it. If it cannot answer, it is not booked.
alter table practice_booking_request drop constraint if exists practice_booking_request_booked_is_complete;
alter table practice_booking_request add constraint practice_booking_request_booked_is_complete
  check (status <> 'booked'
      or (appointment_id is not null
          and challenge_id is not null and verified_at is not null
          and applied_rule_id is not null and applied_rule_version is not null));

-- The rule pair travels together or not at all -- migration 244 put the same constraint on
-- practice_appointment for the same reason. A rule id with no version names a rule as it is NOW, which
-- is a different rule wearing the same id.
alter table practice_booking_request drop constraint if exists practice_booking_request_applied_rule_complete;
alter table practice_booking_request add constraint practice_booking_request_applied_rule_complete
  check ((applied_rule_id is null and applied_rule_version is null)
      or (applied_rule_id is not null and applied_rule_version is not null));

-- A refusal with no code is a refusal nobody can count or explain. See migration 224 on refused_reason.
alter table practice_booking_request drop constraint if exists practice_booking_request_refusal_has_a_reason;
alter table practice_booking_request add constraint practice_booking_request_refusal_has_a_reason
  check (status <> 'refused' or refused_code is not null);

-- s9 makes data-capture consent part of the intake, and a booking made without it is a record the
-- practice had no permission to keep. Refused here rather than trusted to a form.
alter table practice_booking_request drop constraint if exists practice_booking_request_booked_has_consent;
alter table practice_booking_request add constraint practice_booking_request_booked_has_consent
  check (status <> 'booked' or consent_data_capture);

-- A stranger who gives neither a phone nor an email cannot be sent a code, and a code is the only thing
-- verifying them. Enforced at 'verified' rather than at insert, so a half-filled form is still recordable.
alter table practice_booking_request drop constraint if exists practice_booking_request_verified_is_reachable;
alter table practice_booking_request add constraint practice_booking_request_verified_is_reachable
  check (status not in ('verified', 'booked')
      or contact_phone is not null or contact_email is not null);

-- ONE REQUEST PER APPOINTMENT. Two requests both claiming to have created the same appointment would make
-- "who booked this and what did they tell us" a question with two answers. Partial, because the
-- overwhelming majority are null and in an index NULL is distinct from NULL -- which is what makes the
-- unbooked rows not collide.
create unique index if not exists ux_practice_booking_request_appointment
  on practice_booking_request(appointment_id) where appointment_id is not null;

-- ONE BOOKED REQUEST PER SLOT. Belt and braces over migration 255's exclusion constraint, which is the
-- real control: this one refuses two requests that both believe they took the same slot, so the
-- inconsistency is caught even where a booking was placed without a slot id.
create unique index if not exists ux_practice_booking_request_booked_slot
  on practice_booking_request(slot_id) where slot_id is not null and status = 'booked';

create index if not exists idx_practice_booking_request_ws
  on practice_booking_request(workspace_id, created_at desc);
create index if not exists idx_practice_booking_request_status
  on practice_booking_request(workspace_id, status, requested_start);
create index if not exists idx_practice_booking_request_patient
  on practice_booking_request(patient_id) where patient_id is not null;

alter table practice_booking_request enable row level security;

-- ====================================================================================================
-- 3. THE PATIENT SESSION -- AN AUTH ARTEFACT, AND ONLY THAT
-- ====================================================================================================
--
-- WARNING: A PATIENT SESSION IS NOT A PRACTITIONER SESSION, AND THIS TABLE IS SHAPED SO IT CANNOT BECOME
-- ONE BY ACCIDENT.
--
-- PATIENT_ACCESS_STORES already states the danger in one sentence: "Reusing the platform auth token would
-- give a patient an identity the practice shell knows how to let in." src/app/practice/patient-booking
-- deliberately lives OUTSIDE the (shell) segment so resolvePracticeShell's guards never run for it -- a
-- patient must not be a member, must not have a role, and must not have capabilities.
--
-- SO THERE ARE NO CAPABILITY COLUMNS, NO ROLE, NO MEMBERSHIP, NO user_id AND NO patient_id. Every one of
-- those is a thing some future guard could read and treat as permission. What is here is: which challenge
-- this came from, a hashed bearer, when it dies.
--
-- AND NO workspace_id EITHER, WHICH IS DELIBERATE RATHER THAN AN OVERSIGHT. The challenge already records
-- the practice the code was issued for. Copying it here would create two answers to "which practice is
-- this session for", and the day they disagreed the disagreement would be a session minted for one
-- practice being accepted by another. One place, read through the challenge, no drift possible.

create table if not exists practice_patient_session (
  id uuid primary key default gen_random_uuid(),

  -- THE CHALLENGE IT CAME FROM. NOT NULL, so a session cannot exist without a verification behind it,
  -- and ON DELETE CASCADE so that clearing challenges clears the sessions they minted rather than leaving
  -- sessions whose provenance has been deleted.
  challenge_id uuid not null references practice_otp_challenge(id) on delete cascade,

  -- NEVER THE TOKEN. The same position migration 224 took on the code itself: read access to this table
  -- is much wider than the person holding the session, and a bearer token in plaintext is a credential
  -- anybody with a SELECT can use. 64 lowercase hex, enforced, so nothing raw can be written here.
  --
  -- The id is NOT the bearer. Ids travel through logs, error payloads and joins in a way a secret must
  -- not, so the thing presented and the thing referenced are different values on purpose.
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),

  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Spent, or withdrawn. One column, because there is nothing else that can happen to a session.
  revoked_at timestamptz
);

-- WARNING: SHORT, AND CAPPED BY THE DATABASE RATHER THAN BY WHOEVER CALLS THE INSERT.
--
-- The code that opened it lives five minutes (CNE-003 s8). The session it mints exists to carry somebody
-- through an intake form and no further, so thirty minutes is the outer bound: long enough to type a name
-- and a date of birth on a phone, short enough that a session left on a shared handset is worthless by
-- the time the next person picks it up. A caller cannot ask for longer, because the ceiling is here.
alter table practice_patient_session drop constraint if exists practice_patient_session_short_lived;
alter table practice_patient_session add constraint practice_patient_session_short_lived
  check (expires_at > created_at and expires_at <= created_at + interval '30 minutes');

-- ONE SESSION PER CHALLENGE. A one-time code that could mint two sessions is not one-time -- the property
-- verifyOtp goes to such lengths to preserve would be given away here instead. challenge_id is NOT NULL,
-- so this key has no nullable part and no NULL-is-distinct-from-NULL hole.
create unique index if not exists ux_practice_patient_session_challenge
  on practice_patient_session(challenge_id);

-- The lookup a request makes: present a token, find the session. Unique because two sessions sharing a
-- bearer would make revoking one leave the other alive.
create unique index if not exists ux_practice_patient_session_token
  on practice_patient_session(token_hash);

-- For reaping. Nothing else reads this order.
create index if not exists idx_practice_patient_session_expiry
  on practice_patient_session(expires_at) where revoked_at is null;

alter table practice_patient_session enable row level security;

-- ====================================================================================================
-- 4. CAPABILITIES -- NONE ARE ADDED, AND THAT IS THE POINT
-- ====================================================================================================
--
-- Probed against the live catalogue rather than remembered: practice_role_capabilities holds 82 grants
-- over 47 distinct codes, and the two this area needs are already among them --
-- `practice.settings.manage` (configuring what the practice exposes, s14's "Publish booking page") and
-- `appointment.manage` (s14's "Create booking"). PATIENT_ACCESS_CAPABILITIES already names exactly those
-- two and nothing else.
--
-- SO NO CODE IS SEEDED HERE. Six invented codes have shipped in this product already, and migration 239
-- seeded three real ones without backfilling practice_role_assignment -- leaving them granted to nobody,
-- which is a capability that exists and can never be held. The safest number of new codes is none.
--
-- AND THE PATIENT HOLDS NO CAPABILITY AT ALL. s14's patient column is "Yes through published access": the
-- permission is a property of the PAGE being published, not of a person having been granted something.

-- ====================================================================================================
-- 5. THE LAUNCH FLAG IS NOT TURNED ON HERE
-- ====================================================================================================
--
-- PATIENT_BOOKING_FLAG is 'practice_patient_booking' and it has no row in practice_platform_flags, which
-- is how platformFlag() reports it off. Nothing below inserts one. The stores existing is not the same as
-- the surface being built, and a migration that flipped the flag as a finishing touch would open a door
-- with nothing behind it -- which is the failure INTAKE_NOT_BUILT exists to make impossible to reach by
-- configuration alone.

notify pgrst, 'reload schema';
