-- 097: Configuration Testing & Simulation Centre (NCP-012) — no-code test suites that ASSERT expected outcomes
-- against live configuration objects and gate promotion. A suite holds cases (jsonb): each case runs a real
-- executor server-side (schema conformance, dependency safety, metric RAG, rule decision, permission policy,
-- object status) and compares actual vs expected. Runs are recorded for history + regression trend. The suite's
-- last_run summary drives a promotion gate (all-pass = promotable). Idempotent; RLS service-role only, mirroring 092.

create table if not exists configuration_test_suites (
  id uuid primary key default gen_random_uuid(),
  suite_key text not null unique,                      -- e.g. suite.ward_quality_smoke
  name text not null,
  description text,
  cases jsonb not null default '[]',                   -- [{key,name,test_type,object_key,inputs,expected}]
  last_run jsonb,                                       -- {passed,failed,total,gate,at}
  status text not null default 'draft'                 -- draft | passing | failing
    check (status in ('draft','passing','failing')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  updated_by uuid references profiles(id) on delete set null
);
create index if not exists idx_test_suites_status on configuration_test_suites(status);

create table if not exists configuration_test_runs (
  id uuid primary key default gen_random_uuid(),
  suite_key text not null,
  passed int not null default 0,
  failed int not null default 0,
  total int not null default 0,
  gate text not null default 'blocked',                -- pass | blocked
  results jsonb not null default '[]',                 -- per-case {key,name,test_type,object_key,pass,actual,expected,detail}
  run_by uuid references profiles(id) on delete set null,
  run_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_test_runs_suite on configuration_test_runs(suite_key, created_at desc);

alter table configuration_test_suites enable row level security;
alter table configuration_test_runs enable row level security;
-- No client policies on purpose: reads/writes go through the service-role admin client behind super-admin-gated APIs.
