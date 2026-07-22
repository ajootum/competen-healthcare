-- 061: Governance & Compliance — standard self-assessments (GOV-001.6).
-- The Regulatory & Accreditation Center assesses readiness per framework
-- standard (JCI / SafeCare / MOH / internal reference codes from EQOS).
-- INSERT-ONLY history: each assessment is a new row; readers take the latest
-- per (framework, reference_code) so re-assessment builds an audit trail of
-- readiness over time. hospital_id null = platform-level self-assessment.
-- Idempotent; RLS-locked to the service role.

create table if not exists gov_standard_assessments (
  id uuid primary key default gen_random_uuid(),
  framework_id uuid not null references quality_frameworks(id) on delete cascade,
  reference_code text not null,                            -- e.g. IPSG.1, MMU.4
  title text,
  status text not null default 'not_assessed'
    check (status in ('met','partially_met','not_met','not_assessed')),
  gap_note text,                                           -- what is missing
  evidence_note text,                                      -- where the evidence lives
  owner_name text,
  hospital_id uuid references hospitals(id) on delete cascade,  -- null = platform-level
  assessed_by uuid references profiles(id) on delete set null,
  assessed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_gov_std_assess_framework on gov_standard_assessments(framework_id);
create index if not exists idx_gov_std_assess_ref on gov_standard_assessments(framework_id, reference_code);
create index if not exists idx_gov_std_assess_status on gov_standard_assessments(status);

alter table gov_standard_assessments enable row level security;
-- No client policies on purpose: reads/writes go through the service-role
-- admin client behind audited role-gated API routes.
