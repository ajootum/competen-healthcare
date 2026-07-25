-- 093: Configuration Governance & Release Management (WCE-004) — the governed pathway that moves configuration
-- changes from draft to production. Completes the WCE chain: WCE-002 (registry) → WCE-003 (composer) → WCE-004
-- (governance) → WCE-001 (runtime). Every governed change is a formal change request whose risk classification
-- and required reviews are DERIVED FROM the WCE-002 registry (an object's safety_classification drives which
-- reviews are mandatory, §43). MVP object model (change requests + reviews + immutable governance audit);
-- release packaging, test-evidence store, change-freeze calendar and progressive-rollout orchestration are
-- next-phase (§38 lists the full table set). Idempotent; RLS service-role only (writes via super-admin APIs).

create table if not exists configuration_change_requests (
  id uuid primary key default gen_random_uuid(),
  cr_ref text not null unique,                         -- CCR-YYYY-NNNN (generated in app)
  title text not null,
  description text,
  business_reason text,
  scope_type text not null default 'platform'
    check (scope_type in ('platform','enterprise','tenant','hospital','facility','department','unit','role','user')),
  scope_ref text,
  change_type text not null default 'normal'
    check (change_type in ('standard','normal','major','emergency','corrective','regulatory','security','clinical_safety','ai','template','onboarding','platform_wide','rollback','deprecation','retirement')),
  risk_level text not null default 'low' check (risk_level in ('low','moderate','high','critical')),
  risk_score int not null default 0,
  affected_objects jsonb not null default '[]',        -- registry object keys
  required_reviews jsonb not null default '[]',        -- ["product","technical","clinical_safety",...]
  status text not null default 'draft'
    check (status in ('draft','submitted','under_review','changes_requested','approved','scheduled','publishing','published','verification','verified','closed','rejected','cancelled','failed','rolled_back','superseded')),
  emergency_justification text,
  planned_release_date date,
  rollback_plan text,
  requested_by uuid references profiles(id) on delete set null,
  requested_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ccr_status on configuration_change_requests(status);
create index if not exists idx_ccr_risk on configuration_change_requests(risk_level);
create index if not exists idx_ccr_scope on configuration_change_requests(scope_type, scope_ref);

create table if not exists configuration_change_reviews (
  id uuid primary key default gen_random_uuid(),
  cr_id uuid not null references configuration_change_requests(id) on delete cascade,
  review_type text not null,                           -- product / technical / clinical_safety / security / privacy / data_governance / ai_governance / tenant_approval / enterprise_approval / release_manager
  decision text not null default 'pending'
    check (decision in ('pending','approve','approve_conditions','request_changes','reject','escalate','additional_testing')),
  findings text,
  conditions text,
  reviewer_id uuid references profiles(id) on delete set null,
  reviewer_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ccr_review on configuration_change_reviews(cr_id);

create table if not exists configuration_governance_audit (
  id uuid primary key default gen_random_uuid(),
  cr_id uuid references configuration_change_requests(id) on delete set null,
  cr_ref text,
  action text not null,                                -- created / submitted / risk_assessed / reviewed / approved / published / verified / rolled_back / cancelled / emergency
  previous_value jsonb,
  new_value jsonb,
  actor_id uuid references profiles(id) on delete set null,
  actor_name text,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ccr_audit on configuration_governance_audit(cr_id, created_at desc);

alter table configuration_change_requests enable row level security;
alter table configuration_change_reviews enable row level security;
alter table configuration_governance_audit enable row level security;
-- No client policies on purpose: reads/writes go through the service-role admin client behind super-admin-gated APIs.
