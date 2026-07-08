-- ============================================================
-- MIGRATION 016: PROFESSIONAL CREDENTIALS + CURRICULUM
-- Book II Ch.25 (Professional Credential Object) & Ch.18 (Curriculum Object)
-- Additive & idempotent.
-- ============================================================

-- ── PROFESSIONAL CREDENTIALS (Book II Ch.25) ────────────────
-- Verified formal qualifications/registrations/certifications, complementing
-- the competency passport with credentials issued by external/internal bodies.
create table if not exists professional_credentials (
  id                uuid primary key default gen_random_uuid(),
  credential_number text unique default ('PCO-' || substr(gen_random_uuid()::text, 1, 8)),
  nurse_id          uuid not null references profiles(id) on delete cascade,
  hospital_id       uuid references hospitals(id) on delete cascade,
  credential_type   text not null default 'professional_license'
                      check (credential_type in (
                        'professional_license','academic_qualification','board_certification',
                        'specialty_certification','internal_certification','external_certification',
                        'cpd_certificate','instructor_certification','mandatory_training')),
  title             text not null,
  issuing_body      text,
  issue_date        date,
  expiry_date       date,
  status            text not null default 'active'
                      check (status in ('active','expired','suspended','revoked','pending_verification')),
  verified          boolean default false,
  verified_by       uuid references profiles(id),
  verified_at       timestamptz,
  document_url      text,
  created_at        timestamptz default now()
);
create index if not exists idx_credentials_nurse on professional_credentials(nurse_id);

-- ── CURRICULUM (Book II Ch.18) ──────────────────────────────
-- Competency-driven educational structure: Curriculum → Modules → Resources,
-- mapped to the competencies it develops.
create table if not exists curricula (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  description    text,
  target_role    text,
  programme_type text default 'orientation'
                   check (programme_type in ('orientation','specialty','cpd','remediation','leadership','certification')),
  duration_weeks int,
  hospital_id    uuid references hospitals(id) on delete cascade,
  is_active      boolean default true,
  created_at     timestamptz default now()
);

-- Competencies a curriculum targets (outcome) or requires (prerequisite)
create table if not exists curriculum_competencies (
  id            uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references curricula(id) on delete cascade,
  competency_id uuid not null references framework_competencies(id) on delete cascade,
  relation      text default 'outcome' check (relation in ('outcome','prerequisite')),
  created_at    timestamptz default now(),
  unique (curriculum_id, competency_id, relation)
);

create table if not exists curriculum_modules (
  id            uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references curricula(id) on delete cascade,
  title         text not null,
  description   text,
  sort_order    int default 0,
  created_at    timestamptz default now()
);

-- Modules pull from the governed learning resource library
create table if not exists module_resources (
  id          uuid primary key default gen_random_uuid(),
  module_id   uuid not null references curriculum_modules(id) on delete cascade,
  resource_id uuid not null references learning_resources(id) on delete cascade,
  sort_order  int default 0,
  created_at  timestamptz default now(),
  unique (module_id, resource_id)
);

-- ── RLS ─────────────────────────────────────────────────────
alter table professional_credentials enable row level security;
alter table curricula                enable row level security;
alter table curriculum_competencies  enable row level security;
alter table curriculum_modules       enable row level security;
alter table module_resources         enable row level security;

-- Credentials: nurse reads own; staff read/manage
do $$ begin
  create policy "Nurse reads own credentials" on professional_credentials for select using (nurse_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff read credentials" on professional_credentials for select
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator','hr_manager')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff write credentials" on professional_credentials for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator')));
exception when duplicate_object then null; end $$;

-- Curriculum: authenticated read; staff manage
do $$ begin
  create policy "Auth read curricula" on curricula for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff write curricula" on curricula for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Auth read curr comp" on curriculum_competencies for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff write curr comp" on curriculum_competencies for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Auth read modules" on curriculum_modules for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff write modules" on curriculum_modules for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Auth read module res" on module_resources for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff write module res" on module_resources for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator')));
exception when duplicate_object then null; end $$;
