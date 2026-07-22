-- 060: Governance & Compliance — risk register + internal controls (GOV-001.4).
-- Enterprise risk management: gov_risks holds the 5x5 register (likelihood x
-- impact 1-5; inherent score = likelihood*impact computed in app; residual
-- scored separately once treatment applies). gov_controls is the controls
-- library, each optionally linked to a risk, with an effectiveness rating from
-- testing. hospital_id null = platform-wide. Idempotent; RLS-locked to the
-- service role (writes flow through audited admin APIs).

create table if not exists gov_risks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text not null default 'operational'
    check (category in ('strategic','operational','clinical','workforce','financial','technology','cybersecurity','legal','regulatory','data_protection','ai','reputation','business_continuity','third_party')),
  hospital_id uuid references hospitals(id) on delete cascade,   -- null = platform-wide
  owner_id uuid references profiles(id) on delete set null,
  owner_name text,
  likelihood int not null default 3 check (likelihood between 1 and 5),
  impact int not null default 3 check (impact between 1 and 5),
  residual_likelihood int check (residual_likelihood between 1 and 5),
  residual_impact int check (residual_impact between 1 and 5),
  treatment text not null default 'reduce'
    check (treatment in ('avoid','reduce','transfer','accept','monitor','escalate')),
  status text not null default 'open'
    check (status in ('open','mitigating','accepted','escalated','closed')),
  mitigation text,
  review_date date,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists gov_controls (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  objective text,
  control_type text not null default 'preventive'
    check (control_type in ('preventive','detective','corrective')),
  frequency text not null default 'continuous'
    check (frequency in ('continuous','daily','weekly','monthly','quarterly','annual')),
  hospital_id uuid references hospitals(id) on delete cascade,   -- null = platform-wide
  owner_id uuid references profiles(id) on delete set null,
  owner_name text,
  risk_id uuid references gov_risks(id) on delete set null,      -- primary linked risk
  effectiveness text not null default 'not_tested'
    check (effectiveness in ('effective','partially_effective','ineffective','not_tested')),
  last_tested date,
  testing_method text,
  evidence_required text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_gov_risks_status on gov_risks(status);
create index if not exists idx_gov_risks_hospital on gov_risks(hospital_id);
create index if not exists idx_gov_risks_category on gov_risks(category);
create index if not exists idx_gov_controls_risk on gov_controls(risk_id);
create index if not exists idx_gov_controls_effectiveness on gov_controls(effectiveness);

alter table gov_risks enable row level security;
alter table gov_controls enable row level security;
-- No client policies on purpose: reads/writes go through the service-role
-- admin client behind audited role-gated API routes.
