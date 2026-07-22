-- 059: Governance & Compliance — obligations register (GOV-001.3).
-- The Compliance Management module tracks whether each organisation meets its
-- legal/regulatory/clinical/internal requirements. One row per obligation;
-- hospital_id null = platform-wide. Status is maintained by governance staff
-- via /api/governance/obligations. Idempotent; RLS-locked to the service role
-- (all writes flow through audited super-admin/admin APIs).

create table if not exists gov_obligations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_authority text,                                   -- e.g. Ministry of Health, JCI, internal board
  framework_id uuid references quality_frameworks(id) on delete set null,
  domain text not null default 'regulatory'
    check (domain in ('regulatory','clinical','workforce','licence','training','competency','data_privacy','cybersecurity','financial','contractual','documentation','ai')),
  hospital_id uuid references hospitals(id) on delete cascade,  -- null = platform-wide
  owner_id uuid references profiles(id) on delete set null,
  owner_name text,
  review_frequency text not null default 'annual'
    check (review_frequency in ('monthly','quarterly','biannual','annual','once')),
  evidence_required text,
  effective_date date,
  expiry_date date,
  status text not null default 'not_assessed'
    check (status in ('compliant','at_risk','non_compliant','not_assessed','waived')),
  risk_rating text not null default 'medium'
    check (risk_rating in ('low','medium','high','critical')),
  waiver_note text,                                        -- justification when status = 'waived'
  note text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_gov_obligations_status on gov_obligations(status);
create index if not exists idx_gov_obligations_hospital on gov_obligations(hospital_id);
create index if not exists idx_gov_obligations_expiry on gov_obligations(expiry_date);

alter table gov_obligations enable row level security;
-- No client policies on purpose: reads/writes go through the service-role
-- admin client behind audited role-gated API routes.
