-- Migration 037: Workforce Assignment Engine (Phase 1 — Core Foundation)
-- CDN-001. Position-driven, template-based provisioning: employees are assigned
-- to Positions (backed by version-controlled Position Templates); the assignment
-- engine then auto-provisions workspaces (portal roles), competencies (cycle +
-- frameworks), learning (pathway + resources), assessments (assessment plan),
-- passport (employment record), notifications and audit — in one action.
--
-- The engine writes through the service-role API layer (src/lib/workforce/engine.ts)
-- which enforces role + tenant scope in code; RLS below is defence-in-depth.

-- ── 1. Position Library — the catalogue of approved roles (what exists, not who holds them)
create table if not exists position_library (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) on delete cascade,  -- null = platform/global
  hospital_id     uuid references hospitals(id) on delete cascade,      -- null = org-wide
  code            text,
  name            text not null,
  category        text not null default 'clinical'
                    check (category in ('clinical','education','assessment','leadership','administration','quality','other')),
  specialty       text,
  level           text not null default 'staff'
                    check (level in ('junior','staff','senior','manager','executive')),
  status          text not null default 'active' check (status in ('active','draft','retired')),
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);

-- ── 2. Position Template — the reusable, version-controlled blueprint
create table if not exists position_templates (
  id                   uuid primary key default gen_random_uuid(),
  position_library_id  uuid not null references position_library(id) on delete cascade,
  version              int not null default 1,
  workspaces           text[] not null default '{}',   -- portal role keys: nurse|assessor|educator|hospital_admin
  framework_ids        uuid[] not null default '{}',   -- competency frameworks to provision
  resource_ids         uuid[] not null default '{}',   -- learning resources to provision
  cycle_type           text not null default 'orientation'
                         check (cycle_type in ('orientation','probation','annual','remediation','specialty')),
  assessment_programme text not null default 'orientation'
                         check (assessment_programme in ('recruitment','orientation','probation','annual','specialty','remediation','return_to_practice','leadership')),
  cpu_ids              uuid[] not null default '{}',    -- clinical practice units for the assessment plan
  assessor_ids         uuid[] not null default '{}',   -- default assessors for the assessment plan
  notification_prefs   jsonb not null default '{}'::jsonb,
  passport_rules       jsonb not null default '{}'::jsonb,
  reporting_to_template_id uuid references position_templates(id) on delete set null,
  ai_context           text,
  change_summary       text,
  status               text not null default 'draft' check (status in ('draft','active','retired')),
  created_by           uuid references profiles(id),
  created_at           timestamptz not null default now(),
  unique (position_library_id, version)
);

-- ── 3. Position — a real organisational position inside a department
create table if not exists positions (
  id                     uuid primary key default gen_random_uuid(),
  hospital_id            uuid references hospitals(id) on delete cascade,
  department_id          uuid references departments(id) on delete set null,
  template_id            uuid not null references position_templates(id),
  code                   text,
  title                  text not null,
  supervisor_position_id uuid references positions(id) on delete set null,
  status                 text not null default 'active' check (status in ('active','frozen','retired')),
  created_by             uuid references profiles(id),
  created_at             timestamptz not null default now()
);

-- ── 4. Workforce Assignment — employee → position (append-only; history preserved)
create table if not exists workforce_assignments (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references profiles(id) on delete cascade,
  position_id         uuid not null references positions(id) on delete cascade,
  template_id         uuid references position_templates(id),  -- template version used at provisioning time
  assignment_type     text not null default 'permanent'
                        check (assignment_type in ('permanent','temporary','secondary','acting')),
  is_primary          boolean not null default true,
  effective_from      date not null default current_date,
  effective_to        date,
  status              text not null default 'active' check (status in ('scheduled','active','ended','cancelled')),
  provisioning_status text not null default 'pending' check (provisioning_status in ('pending','complete','partial','failed')),
  provisioned         jsonb not null default '{}'::jsonb,   -- record of what each pipeline step created
  provisioned_at      timestamptz,
  created_by          uuid references profiles(id),
  created_at          timestamptz not null default now()
);

-- ── 5. Workspace Registry — every provisioned workspace per employee (dedup source of truth)
create table if not exists workspace_registry (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null references profiles(id) on delete cascade,
  workspace_type       text not null,   -- portal role key
  status               text not null default 'active' check (status in ('active','archived')),
  source_assignment_id uuid references workforce_assignments(id) on delete set null,
  provisioned_date     timestamptz not null default now(),
  last_accessed        timestamptz,
  archived_date        timestamptz,
  unique (employee_id, workspace_type)
);

-- ── Indexes
create index if not exists idx_poslib_org   on position_library(organisation_id);
create index if not exists idx_poslib_hosp  on position_library(hospital_id);
create index if not exists idx_postpl_lib   on position_templates(position_library_id);
create index if not exists idx_positions_dept on positions(department_id);
create index if not exists idx_positions_hosp on positions(hospital_id);
create index if not exists idx_wfa_emp      on workforce_assignments(employee_id);
create index if not exists idx_wfa_pos      on workforce_assignments(position_id);
create index if not exists idx_wfa_status   on workforce_assignments(status);
create index if not exists idx_wsreg_emp    on workspace_registry(employee_id);

-- ── RLS (defence-in-depth; the API uses the service role + in-code enforcement)
alter table position_library      enable row level security;
alter table position_templates    enable row level security;
alter table positions             enable row level security;
alter table workforce_assignments enable row level security;
alter table workspace_registry    enable row level security;

drop policy if exists poslib_read   on position_library;
drop policy if exists postpl_read   on position_templates;
drop policy if exists positions_read on positions;
drop policy if exists wfa_read_own  on workforce_assignments;
drop policy if exists wsreg_read_own on workspace_registry;

create policy poslib_read    on position_library    for select to authenticated using (true);
create policy postpl_read    on position_templates  for select to authenticated using (true);
create policy positions_read on positions           for select to authenticated using (true);
create policy wfa_read_own   on workforce_assignments for select to authenticated using (employee_id = auth.uid());
create policy wsreg_read_own on workspace_registry  for select to authenticated using (employee_id = auth.uid());
