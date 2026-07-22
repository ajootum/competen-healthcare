-- 062: Governance & Compliance — survey & inspection management (GOV-001.6).
-- Accreditation surveys, regulatory inspections and mock assessments: scheduled
-- against a framework, advanced through preparation to completion, with an
-- outcome recorded at the end. hospital_id null = platform-level. Idempotent;
-- RLS-locked to the service role (writes via audited admin APIs).

create table if not exists gov_surveys (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  framework_id uuid references quality_frameworks(id) on delete set null,
  survey_type text not null default 'external'
    check (survey_type in ('external','mock','self_assessment','inspection','surveillance')),
  surveyor text,                                            -- assessing body / assessor names
  hospital_id uuid references hospitals(id) on delete cascade,  -- null = platform-level
  scheduled_date date,
  end_date date,
  status text not null default 'planned'
    check (status in ('planned','preparing','in_progress','completed','cancelled')),
  outcome text not null default 'pending'
    check (outcome in ('pending','passed','passed_with_conditions','failed')),
  prep_note text,                                           -- visit preparation / document requests
  result_note text,                                         -- preliminary findings / final results
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_gov_surveys_status on gov_surveys(status);
create index if not exists idx_gov_surveys_date on gov_surveys(scheduled_date);
create index if not exists idx_gov_surveys_framework on gov_surveys(framework_id);

alter table gov_surveys enable row level security;
-- No client policies on purpose: reads/writes go through the service-role
-- admin client behind audited role-gated API routes.
