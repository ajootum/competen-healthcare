-- ============================================================
-- PHASE 1: Organisation Hierarchy
-- Group → Country → Organisation → Hospital/Clinic → Department → Unit
-- ============================================================

-- Organisations (parent groups above hospitals/clinics)
create table if not exists organisations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  group_name   text,                          -- e.g. "Aga Khan Group"
  type         text not null default 'private'
                 check (type in ('government','private','ngo','faith_based','academic')),
  country      text not null,
  region       text,
  website      text,
  is_active    boolean not null default true,
  created_at   timestamptz default now()
);

-- Add organisation_id and type to hospitals table
alter table hospitals
  add column if not exists organisation_id uuid references organisations(id),
  add column if not exists type           text not null default 'hospital'
    check (type in ('hospital','clinic','health_center','nursing_home','diagnostic_center'));

-- Departments (within a hospital/clinic)
create table if not exists departments (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references hospitals(id) on delete cascade,
  name         text not null,
  specialty    text,
  head_id      uuid references profiles(id),  -- department head/manager
  is_active    boolean not null default true,
  created_at   timestamptz default now()
);

-- Units (within a department)
create table if not exists units (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  name          text not null,
  unit_type     text,                         -- e.g. "Ward","ICU","Theatre","OPD"
  bed_count     int,
  is_active     boolean not null default true,
  created_at    timestamptz default now()
);

-- Add department_id and unit_id to profiles
alter table profiles
  add column if not exists department_id uuid references departments(id),
  add column if not exists unit_id       uuid references units(id);

-- ── RLS ────────────────────────────────────────────────────────

alter table organisations enable row level security;
alter table departments   enable row level security;
alter table units         enable row level security;

-- Organisations: super_admin sees all; authenticated users see active ones
create policy "Authenticated view organisations"
  on organisations for select
  using (auth.role() = 'authenticated');

create policy "Super admin manages organisations"
  on organisations for all
  using (current_user_is_super_admin());

-- Departments: hospital_admin manages their own; nurses/assessors can read theirs
create policy "Hospital members view departments"
  on departments for select
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.hospital_id = departments.hospital_id
    )
    or current_user_is_super_admin()
  );

create policy "Hospital admin manages departments"
  on departments for all
  using (
    current_user_is_hospital_admin_for(hospital_id)
    or current_user_is_super_admin()
  );

-- Units: same pattern as departments
create policy "Hospital members view units"
  on units for select
  using (
    exists (
      select 1 from departments d
      join profiles p on p.hospital_id = d.hospital_id
      where d.id = units.department_id
        and p.id = auth.uid()
    )
    or current_user_is_super_admin()
  );

create policy "Hospital admin manages units"
  on units for all
  using (
    exists (
      select 1 from departments d
      where d.id = units.department_id
        and current_user_is_hospital_admin_for(d.hospital_id)
    )
    or current_user_is_super_admin()
  );
