-- ============================================================
-- MIGRATION 191: COMPETEN PRACTICE PROVISIONING FOUNDATION (CPR-PROV-001 section 5)
--
-- THE FIRST PRODUCT TABLES OF COMPETEN PRACTICE, and the first tables on this platform whose tenant
-- boundary is NOT hospital_id. A Practice workspace is practitioner-owned (CPR-ARCH-001 sections 8/10);
-- hospitals appear later as contexts on encounters, never as owners. Entities, fields, constraints and
-- indexes follow CPR-PROV-001 section 5 with the CPR-DM-001 section 4 metadata contract applied.
--
-- NAMES ARE THE SPEC'S, not this codebase's earlier prc_ proposal. Every name below was verified free
-- against the live schema before adoption (the collision risk was CKCM's `practices`, which PROV-001's
-- names do not touch). Verified with the count discriminator, not the error -- a lesson this session
-- paid for twice.
--
-- RLS: ENABLED WITH ZERO POLICIES ON EVERY TABLE. All application access goes through the service-role
-- API layer, which enforces workspace context per CPR-SHELL-001/SEC-001; deny-by-default is this
-- platform's proven-safe category (anon harness). No blanket reads, no dashboard-authored policies --
-- the entire policy story for practice_* starts clean and stays declared in migrations only.
--
-- STATE MACHINES LIVE IN CHECK CONSTRAINTS (values from PROV-001 sections 6/8.1 and IAM-001 8.1), so an
-- illegal status cannot be written even by a buggy service. Transition LEGALITY (which state may follow
-- which) is enforced in the orchestrator, which records every step in provisioning_step.
--
-- Four catalog tables beyond PROV-001's ten make the orchestrator data-driven rather than hard-coded
-- (PROV-04 "Defaults" epic): role->capability sets, onboarding step definitions, plans, and deployment
-- launch flags (IAM-001 section 14.1 ladder -- signup stays OFF until the integrated tests pass).
--
-- Plain idempotent statements, ASCII only, no do-blocks.
-- ============================================================

-- ---- 1. practice_workspace -------------------------------------------------------------------------

create table if not exists practice_workspace (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'individual_practice'
    check (type in ('individual_practice', 'managed_practice')),
  name text not null check (char_length(name) between 1 and 120),
  owner_person_id uuid not null,
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED', 'IDENTITY_PENDING', 'PROVISIONING', 'ONBOARDING', 'ACTIVE',
                      'SUSPENDED', 'MIGRATING', 'CLOSING', 'CLOSED', 'FAILED')),
  country text not null,
  timezone text not null,
  default_practice_type text not null default 'independent'
    check (default_practice_type in ('independent', 'hospital_based', 'clinic', 'outreach', 'teleconsultation', 'mixed')),
  profession_code text,
  primary_specialty_code text,
  suspension_reason text,
  record_version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create index if not exists idx_practice_workspace_owner on practice_workspace(owner_person_id, status);
create index if not exists idx_practice_workspace_status on practice_workspace(status);

-- ---- 2. practice_membership ------------------------------------------------------------------------

create table if not exists practice_membership (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  user_id uuid not null,
  role_code text not null
    check (role_code in ('practice_owner', 'practitioner', 'practice_assistant', 'billing_reporting', 'read_only_auditor')),
  status text not null default 'active'
    check (status in ('active', 'invited', 'suspended', 'revoked')),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now()
);

-- PROV-001 5.1: unique ACTIVE membership per workspace/user/role family, and exactly one active owner.
create unique index if not exists ux_practice_membership_active
  on practice_membership(workspace_id, user_id, role_code) where status = 'active';
create unique index if not exists ux_practice_owner_single
  on practice_membership(workspace_id) where role_code = 'practice_owner' and status = 'active';
create index if not exists idx_practice_membership_user on practice_membership(user_id, status);

-- ---- 3. practice_role_assignment (capability grants per membership) --------------------------------

create table if not exists practice_role_assignment (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references practice_membership(id) on delete cascade,
  capability_code text not null,
  source text not null default 'role_default'
    check (source in ('role_default', 'explicit_grant', 'delegation')),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);

create unique index if not exists ux_practice_capability
  on practice_role_assignment(membership_id, capability_code) where effective_to is null;

-- ---- 4. practice_configuration (one effective, versioned) ------------------------------------------

create table if not exists practice_configuration (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  locale text not null default 'en-UG',
  date_format text not null default 'DD Mon YYYY',
  identifier_policy jsonb not null default '{}'::jsonb,
  default_encounter_mode text not null default 'in_person'
    check (default_encounter_mode in ('in_person', 'teleconsultation', 'outreach', 'mixed')),
  feature_flags jsonb not null default '{}'::jsonb,
  config_version integer not null default 1,
  is_effective boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_practice_configuration_effective
  on practice_configuration(workspace_id) where is_effective;

-- ---- 5. practice_location --------------------------------------------------------------------------

create table if not exists practice_location (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  name text not null,
  type text not null default 'clinic'
    check (type in ('hospital', 'clinic', 'outreach', 'teleconsultation', 'independent')),
  organisation_ref uuid,
  country text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_practice_location_ws on practice_location(workspace_id, active);

-- ---- 6. practice_entitlement -----------------------------------------------------------------------

create table if not exists practice_entitlement (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  product_code text not null default 'practice',
  plan_code text not null,
  status text not null default 'active'
    check (status in ('active', 'trial', 'expired', 'suspended', 'cancelled')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  sponsor_ref uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_practice_entitlement_ws
  on practice_entitlement(workspace_id, status, starts_at, ends_at);

-- ---- 7. practice_onboarding ------------------------------------------------------------------------

create table if not exists practice_onboarding (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  user_id uuid not null,
  state text not null default 'in_progress'
    check (state in ('in_progress', 'completed', 'abandoned')),
  current_step text not null default 'professional_profile',
  completed_steps jsonb not null default '[]'::jsonb,
  step_data jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_practice_onboarding_active
  on practice_onboarding(workspace_id, user_id) where state = 'in_progress';

-- ---- 8. provisioning_request (idempotency spine) ---------------------------------------------------

create table if not exists provisioning_request (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  request_type text not null default 'individual'
    check (request_type in ('individual', 'managed', 'invitation', 'pilot', 'migration')),
  actor_user_id uuid not null,
  target_user_id uuid not null,
  workspace_id uuid,
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED', 'IDENTITY_PENDING', 'PROVISIONING', 'ONBOARDING', 'ACTIVE',
                      'EXPIRED', 'FAILED', 'COMPLETED')),
  payload_hash text not null,
  error_code text,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- PROV-001 5.1 and section 8: one logical request per key; retries return the original result.
create unique index if not exists ux_provisioning_idempotency on provisioning_request(idempotency_key);
create index if not exists idx_provisioning_reconcile on provisioning_request(status, updated_at);

-- ---- 9. provisioning_step (durable, replay-safe step results) --------------------------------------

create table if not exists provisioning_step (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references provisioning_request(id) on delete cascade,
  step_code text not null
    check (step_code in ('create_workspace', 'create_owner_membership', 'assign_capabilities',
                         'create_configuration', 'create_location', 'create_entitlement',
                         'create_onboarding', 'publish_completed')),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  attempts integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text
);

create unique index if not exists ux_provisioning_step on provisioning_step(request_id, step_code);

-- ---- 10. practice_audit_event (append-only; IAM-001 Appendix B event names) ------------------------

create table if not exists practice_audit_event (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  actor_id uuid,
  event_type text not null,
  source text not null default 'api',
  payload jsonb not null default '{}'::jsonb,
  payload_hash text,
  correlation_id text,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_practice_audit_ws on practice_audit_event(workspace_id, occurred_at desc);
create index if not exists idx_practice_audit_type on practice_audit_event(event_type, occurred_at desc);

-- ---- 11. Catalogs (PROV-04 defaults: data-driven, seeded below) ------------------------------------

create table if not exists practice_role_capabilities (
  role_code text not null,
  capability_code text not null,
  primary key (role_code, capability_code)
);

create table if not exists practice_onboarding_step_catalog (
  step_code text primary key,
  position integer not null,
  required boolean not null default true,
  title text not null
);

create table if not exists practice_plans (
  plan_code text primary key,
  name text not null,
  trial_days integer,
  active boolean not null default true
);

create table if not exists practice_platform_flags (
  flag text primary key,
  enabled boolean not null default false,
  note text
);

-- ---- 12. Seeds -------------------------------------------------------------------------------------

-- Capability sets per IAM-001 section 10 and SHELL-001 section 4 guard capabilities. The owner holds
-- administration; CLINICAL capabilities come from the practitioner role, so an owner who is also a
-- clinician holds both memberships' capabilities -- workspace administration does not automatically
-- grant unrestricted clinical access (IAM-001 10).
insert into practice_role_capabilities (role_code, capability_code) values
  ('practice_owner', 'practice.home.view'),
  ('practice_owner', 'practice.settings.manage'),
  ('practice_owner', 'practice.members.manage'),
  ('practice_owner', 'practice.locations.manage'),
  ('practice_owner', 'report.view'),
  ('practitioner', 'practice.home.view'),
  ('practitioner', 'practice.calendar.view'),
  ('practitioner', 'patient.list'),
  ('practitioner', 'patient.create'),
  ('practitioner', 'patient.view'),
  ('practitioner', 'encounter.list'),
  ('practitioner', 'encounter.create'),
  ('practitioner', 'encounter.edit'),
  ('practitioner', 'followup.view'),
  ('practitioner', 'report.view'),
  ('practice_assistant', 'practice.home.view'),
  ('practice_assistant', 'practice.calendar.view'),
  ('practice_assistant', 'patient.list'),
  ('practice_assistant', 'patient.create'),
  ('billing_reporting', 'practice.home.view'),
  ('billing_reporting', 'report.view'),
  ('read_only_auditor', 'practice.home.view'),
  ('read_only_auditor', 'report.view')
on conflict (role_code, capability_code) do nothing;

-- Onboarding steps per PROV-001 section 12, in order, all required.
insert into practice_onboarding_step_catalog (step_code, position, required, title) values
  ('professional_profile', 1, true, 'Professional profile'),
  ('practice_context', 2, true, 'Practice context'),
  ('regional_settings', 3, true, 'Regional settings'),
  ('clinical_defaults', 4, true, 'Clinical defaults'),
  ('privacy_security', 5, true, 'Privacy and security'),
  ('review_activate', 6, true, 'Review and activate')
on conflict (step_code) do nothing;

insert into practice_plans (plan_code, name, trial_days, active) values
  ('practice_trial', 'Competen Practice Trial', 30, true),
  ('practice_standard', 'Competen Practice', null, true)
on conflict (plan_code) do nothing;

-- IAM-001 section 14.1 launch ladder. Everything closed except pilot provisioning, which lets a platform
-- operator create test workspaces (PROV-001 mode: pilot) while public signup stays honestly off.
insert into practice_platform_flags (flag, enabled, note) values
  ('practice_sign_in', false, 'Practice sign-in page accepts credentials. Off = development posture.'),
  ('practice_public_signup', false, 'Self-service individual signup. Off until IAM+PROV+SHELL integrated tests pass.'),
  ('practice_pilot_provisioning', true, 'Platform-operator pilot provisioning of test workspaces.')
on conflict (flag) do nothing;

-- ---- 13. RLS: deny-by-default on every table -------------------------------------------------------

alter table practice_workspace enable row level security;
alter table practice_membership enable row level security;
alter table practice_role_assignment enable row level security;
alter table practice_configuration enable row level security;
alter table practice_location enable row level security;
alter table practice_entitlement enable row level security;
alter table practice_onboarding enable row level security;
alter table provisioning_request enable row level security;
alter table provisioning_step enable row level security;
alter table practice_audit_event enable row level security;
alter table practice_role_capabilities enable row level security;
alter table practice_onboarding_step_catalog enable row level security;
alter table practice_plans enable row level security;
alter table practice_platform_flags enable row level security;

notify pgrst, 'reload schema';
