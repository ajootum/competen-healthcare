-- CPR-PD-010 phase 9 - Privacy, Security and Clinical Safety governance. s7, s8, s9.
--
-- APPLY THIS FILE WHOLE. It defines a plpgsql trigger function with a dollar-quoted body.
--
-- THESE THREE ARE DEFINED AS MUCH BY WHAT THEY CANNOT HOLD AS BY WHAT THEY DO
--
--   s7  "Privacy governance may inspect control/evidence state, NOT ROUTINE PATIENT CLINICAL CONTENT."
--   s8  "Restrict sensitive exploit/detection details to authorized security roles."
--   s9  "Clinical safety governance DOES NOT CONVERT the Product Director workspace into patient
--        outcome analytics."
--   s25 non-goals: not a Security Operations Center, not clinical quality/outcomes analytics.
--
-- The pattern this module has used six times is to OMIT a column so a rule becomes unexpressible. Here
-- it appears twice more, in both directions:
--
--   OMITTED   no table below has a patient reference of any kind. Not a patient_id, not an
--             encounter_id, not an appointment_id. A privacy data class describes a CATEGORY of data
--             and never an instance of it, and a safety hazard describes a FEATURE and never a person
--             it happened to. There is nowhere for one to go, which is the same position PD-009 took
--             on the five support record types.
--
--   SEPARATED s8's restricted exploit detail lives in its OWN TABLE rather than a column behind a
--             boolean. A flag says "this is restricted" AFTER the row has already been selected, and
--             every `select *`, every export and every cross-module link carries the payload with it.
--             A separate table means the default read cannot include it and a caller has to ask.
--
-- AND NO SAFETY SCORE IS INVENTED
--
-- s9 asks for residual safety risk. There is no published safety scoring methodology - the same
-- position migration 320 took on risk posture - so this records a residual STATEMENT and an optional
-- link to a scored product risk, and does not manufacture a safety severity scale in a migration.

-- ---- 1. THE PRIVACY DATA INVENTORY (s7) -------------------------------------------------------------
--
-- s7: "Maintain product data inventory/classification AT A GOVERNED LEVEL: identity, Practice
-- configuration, patient-related product data, documents, communications, commercial, telemetry/audit
-- and other approved classes. Track purpose, owner, system/location, retention rule, sharing/access
-- model and applicable privacy controls."
--
-- NOTE  "patient-related product data" IS A CLASS NAME, NOT A PATIENT. A row here says "the product
-- holds clinical documents, for this purpose, kept this long, shared this way". It never says anything
-- about a document, and there is no column through which it could.

create table if not exists gov_data_class (
  data_class_id uuid primary key default gen_random_uuid(),
  code          text not null unique,
  label         text not null check (btrim(label) <> ''),
  -- s7's governed classes, as a vocabulary so the inventory can be counted and compared
  category      text not null
                check (category in ('identity', 'practice_configuration', 'patient_related',
                                    'documents', 'communications', 'commercial',
                                    'telemetry_audit', 'other')),

  -- s7's required attributes
  purpose       text not null check (btrim(purpose) <> ''),
  owner_name    text,
  system_location text,
  retention_rule text,
  sharing_model text,
  lawful_basis  text,

  classification text not null default 'internal'
                 check (classification in ('public', 'internal', 'confidential', 'restricted')),
  contains_personal_data boolean not null default false,
  contains_special_category boolean not null default false,

  last_reviewed_on date,
  next_review_on   date,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),

  -- special category data is a subset of personal data. A row claiming the second without the first is
  -- a classification error that would quietly lower the protection the class attracts
  constraint gov_data_class_special_implies_personal
    check (not contains_special_category or contains_personal_data),
  -- s7 requires a retention rule to be TRACKED. Null means nobody has stated one, which is a finding
  -- rather than an error - so it is nullable and surfaced, not defaulted to something plausible
  constraint gov_data_class_review_is_ordered
    check (next_review_on is null or last_reviewed_on is null or next_review_on >= last_reviewed_on)
);

comment on table gov_data_class is
  'CPR-PD-010 s7 privacy data inventory. Describes CATEGORIES of data and never an instance - there is no patient, encounter or document reference anywhere in this table by design.';

alter table gov_data_class enable row level security;

create index if not exists idx_gov_data_class_review on gov_data_class (next_review_on);

-- ---- 2. SECURITY GOVERNANCE REVIEWS (s8) ------------------------------------------------------------
--
-- s8 names the domains: "authentication, authorization, encryption, secrets, session management,
-- tenancy isolation, auditability, backups/continuity and third-party dependencies."
--
-- s8 also says "do not turn this page into a SOC" - so this is a REVIEW record with a posture and an
-- owner, not a vulnerability feed. Live detection belongs to Product Health and security tooling.

create table if not exists gov_security_review (
  review_id     uuid primary key default gen_random_uuid(),
  reference     text not null unique,
  domain        text not null
                check (domain in ('authentication', 'authorization', 'encryption', 'secrets',
                                  'session_management', 'tenancy_isolation', 'auditability',
                                  'backup_continuity', 'third_party')),
  title         text not null check (btrim(title) <> ''),
  scope         text,

  posture       text not null default 'not_assessed'
                check (posture in ('not_assessed', 'effective', 'gaps_identified', 'ineffective')),
  summary       text,

  reviewed_by   text,
  reviewed_at   timestamp with time zone,
  next_review_on date,

  risk_id       uuid references gov_product_risk(risk_id) on delete set null,
  control_id    uuid references gov_control(control_id) on delete set null,
  finding_id    uuid references gov_audit_finding(finding_id) on delete set null,

  -- s8: restricted detail EXISTS somewhere else. This says whether to go looking, and nothing more
  has_restricted_detail boolean not null default false,

  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),

  constraint gov_security_review_assessed_is_attributed
    check ((posture = 'not_assessed') or (reviewed_by is not null and reviewed_at is not null)),
  -- an adverse posture states what the gap is, on the same rule as an adverse control test
  constraint gov_security_review_adverse_is_summarised
    check (posture not in ('gaps_identified', 'ineffective') or btrim(coalesce(summary, '')) <> '')
);

comment on table gov_security_review is
  'CPR-PD-010 s8 security governance review. A posture record, not a vulnerability feed - s8 says do not turn this into a SOC. Restricted exploit detail is in gov_security_restricted_detail, never here.';

alter table gov_security_review enable row level security;

create index if not exists idx_gov_security_review_domain on gov_security_review (domain, next_review_on);

-- ---- 3. RESTRICTED DETAIL, IN ITS OWN TABLE (s8, s19) -----------------------------------------------
--
-- s19: "Restricted records must remain restricted IN SEARCH, NOTIFICATIONS, EXPORTS AND CROSS-MODULE
-- LINKS." A boolean on the review cannot deliver that: by the time a caller reads the flag it has
-- already selected the exploit detail, and every generic exporter, search indexer and payload logger in
-- the product has had it too.
--
-- A separate table makes the restriction structural. The overview, the register, every list and every
-- export read gov_security_review and physically cannot return what is not in it.

create table if not exists gov_security_restricted_detail (
  detail_id     uuid primary key default gen_random_uuid(),
  review_id     uuid not null references gov_security_review(review_id) on delete cascade,
  detail        text not null check (btrim(detail) <> ''),
  detail_kind   text not null default 'finding'
                check (detail_kind in ('finding', 'exploit_path', 'detection_logic', 'configuration')),
  recorded_by   text not null check (btrim(recorded_by) <> ''),
  recorded_at   timestamp with time zone not null default now(),
  -- the capability a caller must hold. Named on the row so a reader of the schema can see the gate
  required_capability text not null default 'hq.practice.governance.view'
);

comment on table gov_security_restricted_detail is
  'CPR-PD-010 s8/s19 restricted security detail. A SEPARATE TABLE rather than a flagged column, because a flag is read after the payload has already been selected, exported and logged.';

alter table gov_security_restricted_detail enable row level security;

create index if not exists idx_gov_security_detail_review on gov_security_restricted_detail (review_id);

-- keep the pointer honest: has_restricted_detail must not claim detail that does not exist
create or replace function gov_security_detail_syncs_flag()
returns trigger
language plpgsql
as $$
declare
  target uuid;
  n int;
begin
  target := coalesce(new.review_id, old.review_id);
  select count(*) into n from gov_security_restricted_detail where review_id = target;
  update gov_security_review set has_restricted_detail = (n > 0) where review_id = target;
  return null;
end;
$$;

drop trigger if exists trg_gov_security_detail_syncs_flag on gov_security_restricted_detail;
create trigger trg_gov_security_detail_syncs_flag
  after insert or delete on gov_security_restricted_detail
  for each row execute function gov_security_detail_syncs_flag();

-- ---- 4. CLINICAL SAFETY HAZARDS (s9) ----------------------------------------------------------------
--
-- s9: "Maintain safety hazards/risks, safety requirements, mitigations, verification evidence and
-- residual safety risk", for "features whose failure, misleading behavior or automation could plausibly
-- influence clinical care or practitioner decisions."
--
-- NOTE  A HAZARD IS ABOUT A FEATURE. "The medication warning does not fire for a renamed drug" is a
-- hazard. "Patient X received the wrong dose" is an incident and belongs to a clinical safety process
-- that is not this workspace. There is no patient column here, and s9's own sentence is why.

create table if not exists gov_safety_hazard (
  hazard_id     uuid primary key default gen_random_uuid(),
  reference     text not null unique,
  title         text not null check (btrim(title) <> ''),

  -- the FEATURE at issue, from the phase 2 journey vocabulary where one applies
  feature_area  text not null check (btrim(feature_area) <> ''),
  journey_key   text references mos_journey(key),

  -- s9's hazard anatomy
  hazard        text not null check (btrim(hazard) <> ''),
  cause         text,
  potential_harm text not null check (btrim(potential_harm) <> ''),
  safety_requirement text,
  mitigation    text,

  -- s9: verification evidence. Reuses the s13 index rather than a second evidence store
  verification_evidence_id uuid references gov_evidence(evidence_id) on delete set null,

  -- s9's residual safety risk, as a STATEMENT plus an optional link to a scored product risk. No
  -- safety severity scale is invented here - there is no published safety methodology, and migration
  -- 320 took the same position on risk posture
  residual_statement text,
  risk_id       uuid references gov_product_risk(risk_id) on delete set null,

  state         text not null default 'identified'
                check (state in ('identified', 'assessed', 'mitigated', 'verified', 'accepted', 'closed')),
  owner_name    text,
  -- s9: "High-risk clinical feature changes may require defined safety review/approval before release"
  requires_pre_release_approval boolean not null default false,
  approval_decision_id uuid references gov_decision(decision_id) on delete set null,

  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),

  -- s9 wants verification EVIDENCE, so a hazard cannot claim to be verified on assertion alone
  constraint gov_safety_verified_is_evidenced
    check (state <> 'verified' or verification_evidence_id is not null),
  -- accepting a residual safety risk states what is being accepted
  constraint gov_safety_accepted_states_residual
    check (state <> 'accepted' or btrim(coalesce(residual_statement, '')) <> '')
);

comment on table gov_safety_hazard is
  'CPR-PD-010 s9 clinical safety hazard. Describes a FEATURE that could influence clinical care - there is no patient, encounter or outcome reference, because s9 forbids turning this workspace into patient outcome analytics.';

alter table gov_safety_hazard enable row level security;

create index if not exists idx_gov_safety_open on gov_safety_hazard (state, feature_area);
create index if not exists idx_gov_safety_journey on gov_safety_hazard (journey_key);

-- ---- 5. NOTHING IS SEEDED ---------------------------------------------------------------------------
--
-- A seeded data inventory would state what this product holds and why, and a seeded hazard list would
-- state which features can influence clinical care. Both are governance claims. Neither is mine to make
-- in a migration.

notify pgrst, 'reload schema';
