-- ═══════════════════════════════════════════════════════════════════════════
-- 052 — Enterprise Administration (ENT-001)
-- Backs the six Enterprise Administration modules. Most of the data hierarchy
-- already exists (enterprises → organisations → hospitals → departments → units,
-- plus positions and profiles); this migration adds the missing levels
-- (Divisions, Services, Teams), a unified Enterprise Template registry, and the
-- richer profile columns the module specs require. New tables are RLS-locked
-- (service-role only) like the rest of the platform-control surface.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Divisions (Facility → Division → Department) ────────────────────────────
create table if not exists ent_divisions (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references hospitals(id) on delete cascade,
  name          text not null,
  code          text,
  director_id   uuid references profiles(id) on delete set null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists idx_ent_divisions_hospital on ent_divisions(hospital_id);

-- ── Service catalogue (can span departments / facilities) ───────────────────
create table if not exists ent_services (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) on delete cascade,
  hospital_id     uuid references hospitals(id) on delete set null,
  name            text not null,
  category        text,   -- emergency, critical, inpatient, outpatient, surgical, lab, radiology, pharmacy, rehab, training …
  scope           text,   -- free-text operational scope
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists idx_ent_services_org on ent_services(organisation_id);

-- ── Teams (Unit → Team) ─────────────────────────────────────────────────────
create table if not exists ent_teams (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references units(id) on delete cascade,
  name        text not null,
  code        text,
  lead_id     uuid references profiles(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_ent_teams_unit on ent_teams(unit_id);

-- ── Enterprise Templates (unified registry for all template types) ──────────
-- Org templates also exist in plat_org_templates (control-plane provisioning);
-- this registry covers the full Enterprise Templates module: organisation,
-- facility, department, unit, role, workspace and structure templates.
create table if not exists ent_templates (
  id            uuid primary key default gen_random_uuid(),
  code          text,
  name          text not null,
  template_type text not null default 'organisation'
                  check (template_type in ('organisation','facility','department','unit','role','workspace','structure')),
  version_major int not null default 1,
  version_minor int not null default 0,
  status        text not null default 'draft'
                  check (status in ('draft','review','approved','published','assigned','retired')),
  description   text,
  spec          jsonb not null default '{}'::jsonb,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_ent_templates_type on ent_templates(template_type, status);

-- ── Richer profile columns on the existing hierarchy ────────────────────────
-- Organisations: fuller tenant lifecycle + identity.
alter table organisations
  add column if not exists status         text default 'active'
    check (status in ('draft','onboarding','active','suspended','restricted','archived','closed')),
  add column if not exists org_code       text,
  add column if not exists legal_name     text;

-- Facilities: onboarding lifecycle + identity.
alter table hospitals
  add column if not exists status         text default 'active'
    check (status in ('draft','onboarding','active','suspended','archived')),
  add column if not exists facility_code  text,
  add column if not exists director_id    uuid references profiles(id) on delete set null;

-- Departments: structure builder metadata.
alter table departments
  add column if not exists code           text,
  add column if not exists division_id    uuid references ent_divisions(id) on delete set null,
  add column if not exists dept_type      text,
  add column if not exists cost_centre    text,
  add column if not exists status         text default 'active'
    check (status in ('active','archived'));

-- Units: operational metadata (bed_count already exists).
alter table units
  add column if not exists code           text,
  add column if not exists manager_id     uuid references profiles(id) on delete set null,
  add column if not exists specialty      text,
  add column if not exists shift_model    text,
  add column if not exists status         text default 'active'
    check (status in ('active','archived'));

-- Positions: catalogue metadata (code, title, supervisor_position_id already exist).
alter table positions
  add column if not exists grade          text,
  add column if not exists profession     text,
  add column if not exists default_role   text,
  add column if not exists can_supervise  boolean not null default false;

-- People: link a person to a position + employment record.
alter table profiles
  add column if not exists position_id     uuid references positions(id) on delete set null,
  add column if not exists staff_number    text,
  add column if not exists employment_type text,
  add column if not exists line_manager_id uuid references profiles(id) on delete set null,
  add column if not exists account_status  text default 'active'
    check (account_status in ('active','invited','suspended','deactivated','left'));

-- ── Lock the new tables to the service role (no policies = service-role only) ─
do $$
begin
  perform 1;
  execute 'alter table public.ent_divisions enable row level security';
  execute 'alter table public.ent_services  enable row level security';
  execute 'alter table public.ent_teams     enable row level security';
  execute 'alter table public.ent_templates enable row level security';
end $$;
