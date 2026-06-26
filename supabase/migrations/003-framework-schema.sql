-- ============================================================
-- MIGRATION 003: FRAMEWORK ENGINE SCHEMA
-- Adds the three-level framework hierarchy and competency cycles
-- Safe to run multiple times (IF NOT EXISTS / OR REPLACE)
-- ============================================================

-- ── FRAMEWORK HIERARCHY ─────────────────────────────────────
-- Library → Framework → Domain → Competency

create table if not exists frameworks (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  library     text not null check (library in ('core', 'specialty', 'role')),
  description text,
  hospital_id uuid references hospitals(id) on delete cascade,
  is_active   boolean default true,
  sort_order  int default 0,
  created_at  timestamptz default now()
);

create table if not exists framework_domains (
  id           uuid primary key default gen_random_uuid(),
  framework_id uuid not null references frameworks(id) on delete cascade,
  name         text not null,
  sort_order   int default 0,
  created_at   timestamptz default now()
);

create table if not exists framework_competencies (
  id          uuid primary key default gen_random_uuid(),
  domain_id   uuid not null references framework_domains(id) on delete cascade,
  name        text not null,
  description text,
  sort_order  int default 0,
  created_at  timestamptz default now()
);

-- ── COMPETENCY CYCLES ───────────────────────────────────────
-- A formal competency assessment cycle for a nurse

create table if not exists competency_cycles (
  id           uuid primary key default gen_random_uuid(),
  nurse_id     uuid not null references profiles(id) on delete cascade,
  hospital_id  uuid references hospitals(id),
  cycle_type   text not null check (cycle_type in ('orientation', 'probation', 'annual', 'remediation', 'specialty')),
  status       text not null default 'active' check (status in ('active', 'completed', 'expired')),
  start_date   date not null default current_date,
  end_date     date,
  created_by   uuid references profiles(id),
  notes        text,
  created_at   timestamptz default now()
);

-- Frameworks assigned to a cycle
create table if not exists cycle_framework_assignments (
  id           uuid primary key default gen_random_uuid(),
  cycle_id     uuid not null references competency_cycles(id) on delete cascade,
  framework_id uuid not null references frameworks(id) on delete cascade,
  unique (cycle_id, framework_id)
);

-- ── COMPETENCY ASSESSMENTS ──────────────────────────────────
-- Individual competency scores within a cycle
-- Score 0-6 maps to the assessment levels from audit tools

create table if not exists competency_assessments (
  id              uuid primary key default gen_random_uuid(),
  cycle_id        uuid not null references competency_cycles(id) on delete cascade,
  nurse_id        uuid not null references profiles(id) on delete cascade,
  competency_id   uuid not null references framework_competencies(id) on delete cascade,
  score           int check (score between 0 and 6),
  assessed_by     uuid references profiles(id),
  evidence_url    text,
  notes           text,
  assessed_at     timestamptz default now(),
  unique (cycle_id, nurse_id, competency_id)
);

-- ── RLS ─────────────────────────────────────────────────────

alter table frameworks               enable row level security;
alter table framework_domains        enable row level security;
alter table framework_competencies   enable row level security;
alter table competency_cycles        enable row level security;
alter table cycle_framework_assignments enable row level security;
alter table competency_assessments   enable row level security;

-- Frameworks: public read (authenticated)
do $$ begin
  create policy "Auth users read frameworks"
    on frameworks for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Auth users read domains"
    on framework_domains for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Auth users read competencies"
    on framework_competencies for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

-- Cycles: nurses see own, admins see their hospital
do $$ begin
  create policy "Nurses see own cycles"
    on competency_cycles for select using (auth.uid() = nurse_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Admins see hospital cycles"
    on competency_cycles for select using (
      exists (
        select 1 from profiles p
        where p.id = auth.uid()
          and p.role in ('hospital_admin', 'super_admin')
          and (p.hospital_id = competency_cycles.hospital_id or p.role = 'super_admin')
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Admins insert cycles"
    on competency_cycles for insert with check (
      exists (
        select 1 from profiles p
        where p.id = auth.uid()
          and p.role in ('hospital_admin', 'super_admin', 'assessor')
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Admins update cycles"
    on competency_cycles for update using (
      exists (
        select 1 from profiles p
        where p.id = auth.uid()
          and p.role in ('hospital_admin', 'super_admin', 'assessor')
      )
    );
exception when duplicate_object then null; end $$;

-- Cycle framework assignments: readable by cycle participants
do $$ begin
  create policy "Read cycle assignments"
    on cycle_framework_assignments for select using (
      exists (
        select 1 from competency_cycles cc
        where cc.id = cycle_framework_assignments.cycle_id
          and (cc.nurse_id = auth.uid() or exists (
            select 1 from profiles p
            where p.id = auth.uid()
              and p.role in ('hospital_admin', 'super_admin', 'assessor')
          ))
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Admins insert cycle assignments"
    on cycle_framework_assignments for insert with check (
      exists (
        select 1 from profiles p
        where p.id = auth.uid()
          and p.role in ('hospital_admin', 'super_admin', 'assessor')
      )
    );
exception when duplicate_object then null; end $$;

-- Assessments: nurses see own, assessors can insert/update
do $$ begin
  create policy "Nurses see own assessments"
    on competency_assessments for select using (auth.uid() = nurse_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Assessors see assigned assessments"
    on competency_assessments for select using (
      exists (
        select 1 from profiles p
        where p.id = auth.uid()
          and p.role in ('hospital_admin', 'super_admin', 'assessor')
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Assessors insert assessments"
    on competency_assessments for insert with check (
      exists (
        select 1 from profiles p
        where p.id = auth.uid()
          and p.role in ('hospital_admin', 'super_admin', 'assessor')
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Assessors update assessments"
    on competency_assessments for update using (
      exists (
        select 1 from profiles p
        where p.id = auth.uid()
          and p.role in ('hospital_admin', 'super_admin', 'assessor')
      )
    );
exception when duplicate_object then null; end $$;

-- ── UPDATE PROFILES ROLE CHECK ───────────────────────────────
-- Add assessor and educator roles to the allowed list
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('nurse', 'assessor', 'educator', 'hospital_admin', 'super_admin'));
