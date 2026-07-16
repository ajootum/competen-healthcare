-- ============================================================
-- MIGRATION 021: ASSESSOR OPERATING LAYER ("The Assessor Role" spec)
-- The platform manages complexity; the assessor manages decisions.
--  1) role_requirements — the Role-to-CPU Requirement Matrix (§3):
--     which CPUs each role/unit must hold, so assessment work is
--     GENERATED rather than manually assigned
--  2) entrustment_level on clinical_authorizations — the 5-level
--     entrustment decision (§16-17)
--  3) evidence validity on skill_library (portability groundwork §6)
-- Additive & idempotent.
-- ============================================================

-- ── ROLE REQUIREMENT MATRIX ─────────────────────────────────
create table if not exists role_requirements (
  id               uuid primary key default gen_random_uuid(),
  profession       text not null default 'nursing',
  role_label       text not null default 'Registered Nurse',   -- human role this applies to
  hospital_id      uuid references hospitals(id) on delete cascade,   -- null = all hospitals
  department_id    uuid references departments(id) on delete cascade, -- null = all units
  cpu_id           uuid not null references clinical_practice_units(id) on delete cascade,
  requirement_type text not null default 'mandatory'
                     check (requirement_type in ('mandatory','orientation','specialty','optional')),
  is_active        boolean not null default true,
  created_at       timestamptz default now(),
  unique (role_label, hospital_id, department_id, cpu_id)
);
create index if not exists idx_rolereq_cpu on role_requirements(cpu_id);

-- ── ENTRUSTMENT DECISION LEVELS (5-point scale) ─────────────
alter table clinical_authorizations add column if not exists entrustment_level text
  check (entrustment_level in ('not_permitted','direct_supervision','indirect_supervision','independent','may_supervise'));

-- ── EVIDENCE VALIDITY (skill portability groundwork) ────────
alter table skill_library add column if not exists evidence_validity_months int default 12;

-- ── RLS ─────────────────────────────────────────────────────
alter table role_requirements enable row level security;
do $$ begin
  create policy "Authenticated read" on role_requirements for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Admins write" on role_requirements for all using (exists (
    select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin')));
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
