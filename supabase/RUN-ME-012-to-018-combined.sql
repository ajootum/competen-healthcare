-- ============================================================
-- COMBINED MIGRATIONS 012-018 (all idempotent - safe to re-run)
-- Paste this whole file into the Supabase SQL editor and Run once.
-- ============================================================

-- ########## migrations/012-governance-depth.sql ##########
-- ============================================================
-- MIGRATION 012: GOVERNANCE DEPTH (Book I Ch.11, Phase 3)
-- Governance committees, semantic versioning, change requests,
-- and the knowledge dependency graph (edges) for impact analysis.
-- Additive & idempotent.
-- ============================================================

-- ── GOVERNANCE COMMITTEES ───────────────────────────────────
create table if not exists governance_committees (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  level           text not null default 'facility'
                    check (level in ('enterprise','country','facility','department','specialty')),
  organisation_id uuid references organisations(id) on delete cascade,
  hospital_id     uuid references hospitals(id) on delete cascade,
  quorum          int default 1,
  is_active       boolean default true,
  created_at      timestamptz default now()
);

create table if not exists committee_members (
  id            uuid primary key default gen_random_uuid(),
  committee_id  uuid not null references governance_committees(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  role          text default 'member' check (role in ('chair','member','reviewer')),
  created_at    timestamptz default now(),
  unique (committee_id, profile_id)
);

-- ── SEMANTIC VERSIONING (Book I 11.9) ───────────────────────
-- major.minor.revision on frameworks (existing version_num kept as legacy counter)
alter table frameworks add column if not exists version_major int default 1;
alter table frameworks add column if not exists version_minor int default 0;
alter table frameworks add column if not exists version_revision int default 0;
alter table frameworks add column if not exists governance_committee_id uuid references governance_committees(id) on delete set null;
alter table frameworks add column if not exists review_date date;

-- ── CHANGE REQUESTS (Book I 11.10) ──────────────────────────
create table if not exists change_requests (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null,
  entity_id     uuid not null,
  entity_name   text,
  rationale     text not null,
  change_kind   text default 'minor' check (change_kind in ('major','minor','revision')),
  impact_summary jsonb,
  status        text default 'open' check (status in ('open','approved','rejected','implemented')),
  requested_by  uuid references profiles(id),
  requested_by_name text,
  reviewed_by   uuid references profiles(id),
  effective_date date,
  created_at    timestamptz default now()
);

-- ── KNOWLEDGE DEPENDENCY GRAPH (Book I 11.15 / 13.9) ────────
-- Generic governed edges between any two objects.
create table if not exists knowledge_edges (
  id            uuid primary key default gen_random_uuid(),
  source_type   text not null,
  source_id     uuid not null,
  target_type   text not null,
  target_id     uuid not null,
  relationship  text not null default 'references'
                  check (relationship in (
                    'contains','belongs_to','requires','depends_on','supports',
                    'assesses','generates','validates','supersedes','references','related_to')),
  created_at    timestamptz default now(),
  unique (source_type, source_id, target_type, target_id, relationship)
);
create index if not exists idx_edges_source on knowledge_edges(source_type, source_id);
create index if not exists idx_edges_target on knowledge_edges(target_type, target_id);

-- ── RLS ─────────────────────────────────────────────────────
alter table governance_committees enable row level security;
alter table committee_members     enable row level security;
alter table change_requests       enable row level security;
alter table knowledge_edges       enable row level security;

do $$ begin
  create policy "Staff read committees" on governance_committees for select
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('hospital_admin','educator','assessor','super_admin')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Admins write committees" on governance_committees for all
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('hospital_admin','super_admin')));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Staff read committee members" on committee_members for select
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('hospital_admin','educator','assessor','super_admin')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Admins write committee members" on committee_members for all
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('hospital_admin','super_admin')));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Staff read change requests" on change_requests for select
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('hospital_admin','educator','assessor','super_admin')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff write change requests" on change_requests for all
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('hospital_admin','educator','super_admin')));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Auth read edges" on knowledge_edges for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Super admin writes edges" on knowledge_edges for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin'));
exception when duplicate_object then null; end $$;

-- ########## migrations/013-metadata-classification.sql ##########
-- ============================================================
-- MIGRATION 013: METADATA, TAXONOMY & CLASSIFICATION (Book I Ch.13, Phase 4)
-- Controlled vocabularies, tags, classification codes.
-- Additive & idempotent.
-- ============================================================

-- ── TAXONOMIES (controlled vocabularies) ────────────────────
create table if not exists taxonomies (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null unique,   -- profession | specialty | role | competency_type | care_setting | age_group ...
  label       text not null,
  created_at  timestamptz default now()
);

create table if not exists taxonomy_terms (
  id           uuid primary key default gen_random_uuid(),
  taxonomy_id  uuid not null references taxonomies(id) on delete cascade,
  value        text not null,
  code         text,
  sort_order   int default 0,
  created_at   timestamptz default now(),
  unique (taxonomy_id, value)
);

-- ── TAGS (governed + local) ─────────────────────────────────
create table if not exists tags (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text default 'general'
                check (category in ('clinical','safety','education','governance','general')),
  is_enterprise boolean default true,
  hospital_id uuid references hospitals(id) on delete cascade,
  created_at  timestamptz default now(),
  unique (name, category)
);

-- Polymorphic tag assignment
create table if not exists object_tags (
  id           uuid primary key default gen_random_uuid(),
  tag_id       uuid not null references tags(id) on delete cascade,
  object_type  text not null,   -- framework | cpu | competency | skill | policy ...
  object_id    uuid not null,
  created_at   timestamptz default now(),
  unique (tag_id, object_type, object_id)
);
create index if not exists idx_object_tags_obj on object_tags(object_type, object_id);

-- ── CLASSIFICATION CODES on remaining objects ───────────────
alter table frameworks        add column if not exists code text;
alter table framework_domains add column if not exists code text;

-- ── SEED CORE TAXONOMIES ────────────────────────────────────
insert into taxonomies (kind, label) values
  ('profession',      'Profession'),
  ('specialty',       'Specialty'),
  ('role',            'Role'),
  ('competency_type', 'Competency Type'),
  ('care_setting',    'Care Setting'),
  ('age_group',       'Age Group')
on conflict (kind) do nothing;

do $$
declare prof uuid; spec uuid; ctype uuid; setting uuid;
begin
  select id into prof from taxonomies where kind = 'profession';
  select id into spec from taxonomies where kind = 'specialty';
  select id into ctype from taxonomies where kind = 'competency_type';
  select id into setting from taxonomies where kind = 'care_setting';

  insert into taxonomy_terms (taxonomy_id, value) values
    (prof, 'Nursing'), (prof, 'Medicine'), (prof, 'Pharmacy'),
    (prof, 'Physiotherapy'), (prof, 'Occupational Therapy'), (prof, 'Radiography')
  on conflict do nothing;

  insert into taxonomy_terms (taxonomy_id, value) values
    (spec, 'Intensive Care'), (spec, 'Emergency'), (spec, 'Neonatal Care'),
    (spec, 'Operating Room'), (spec, 'Oncology'), (spec, 'Rehabilitation')
  on conflict do nothing;

  insert into taxonomy_terms (taxonomy_id, value) values
    (ctype, 'Core'), (ctype, 'Specialty'), (ctype, 'Role-Based'),
    (ctype, 'Leadership'), (ctype, 'Mandatory Compliance')
  on conflict do nothing;

  insert into taxonomy_terms (taxonomy_id, value) values
    (setting, 'ICU'), (setting, 'NICU'), (setting, 'PICU'), (setting, 'Theatre'),
    (setting, 'Emergency'), (setting, 'Ward'), (setting, 'Ambulatory Care')
  on conflict do nothing;
end $$;

-- ── SEED GOVERNED TAGS ──────────────────────────────────────
insert into tags (name, category) values
  ('Pediatric','clinical'), ('Adult','clinical'), ('Critical Care','clinical'), ('Emergency','clinical'),
  ('High Risk','safety'), ('Time Critical','safety'), ('Mandatory','safety'),
  ('Beginner','education'), ('Advanced','education'), ('Refresher','education'),
  ('Reviewed','governance'), ('Pending Revision','governance'), ('Deprecated','governance')
on conflict do nothing;

-- ── RLS ─────────────────────────────────────────────────────
alter table taxonomies      enable row level security;
alter table taxonomy_terms  enable row level security;
alter table tags            enable row level security;
alter table object_tags     enable row level security;

do $$ begin
  create policy "Auth read taxonomies" on taxonomies for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Auth read terms" on taxonomy_terms for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Auth read tags" on tags for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Auth read object_tags" on object_tags for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Super admin writes taxonomies" on taxonomies for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Super admin writes terms" on taxonomy_terms for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Admins write tags" on tags for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Admins write object_tags" on object_tags for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin')));
exception when duplicate_object then null; end $$;

-- ########## migrations/014-learning-pathways.sql ##########
-- ============================================================
-- MIGRATION 014: LEARNING & DEVELOPMENT LAYER (Book II Ch.17/19)
-- Governed learning resources linked to competencies, and
-- auto-generated personalised learning pathways from competency gaps.
-- Additive & idempotent.
-- ============================================================

-- ── LEARNING RESOURCES (Knowledge Resource Object, Book II Ch.19) ──
create table if not exists learning_resources (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  resource_type text not null default 'course'
                  check (resource_type in ('course','policy','video','guideline','simulation','question_bank','article','reflection')),
  url           text,
  description   text,
  hospital_id   uuid references hospitals(id) on delete cascade,   -- null = enterprise/master
  is_active     boolean default true,
  created_at    timestamptz default now()
);

-- Which competencies a resource helps develop (many-to-many)
create table if not exists resource_competencies (
  id            uuid primary key default gen_random_uuid(),
  resource_id   uuid not null references learning_resources(id) on delete cascade,
  competency_id uuid not null references framework_competencies(id) on delete cascade,
  created_at    timestamptz default now(),
  unique (resource_id, competency_id)
);
create index if not exists idx_res_comp_comp on resource_competencies(competency_id);

-- ── LEARNING PATHWAYS (Book II Ch.17) ───────────────────────
-- A personalised sequence of learning tied to a nurse's competency gaps.
create table if not exists learning_pathways (
  id          uuid primary key default gen_random_uuid(),
  nurse_id    uuid not null references profiles(id) on delete cascade,
  title       text not null default 'Personalised Learning Pathway',
  status      text not null default 'active' check (status in ('active','completed','archived')),
  generated_at timestamptz default now(),
  created_at  timestamptz default now()
);

create table if not exists pathway_items (
  id            uuid primary key default gen_random_uuid(),
  pathway_id    uuid not null references learning_pathways(id) on delete cascade,
  competency_id uuid references framework_competencies(id) on delete set null,
  competency_name text,
  reason        text,          -- e.g. "Requires Remediation", "Not Yet Competent", "Expired"
  resource_id   uuid references learning_resources(id) on delete set null,
  resource_title text,
  resource_type text,
  status        text not null default 'pending' check (status in ('pending','in_progress','completed')),
  sort_order    int default 0,
  created_at    timestamptz default now()
);
create index if not exists idx_pathway_items_pathway on pathway_items(pathway_id);

-- ── RLS ─────────────────────────────────────────────────────
alter table learning_resources    enable row level security;
alter table resource_competencies enable row level security;
alter table learning_pathways     enable row level security;
alter table pathway_items         enable row level security;

do $$ begin
  create policy "Auth read resources" on learning_resources for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Auth read resource_comp" on resource_competencies for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Admins write resources" on learning_resources for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Admins write resource_comp" on resource_competencies for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator')));
exception when duplicate_object then null; end $$;

-- Pathways: nurse sees own; educators/admins manage
do $$ begin
  create policy "Nurse reads own pathway" on learning_pathways for select using (nurse_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff manage pathways" on learning_pathways for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Nurse reads own pathway items" on pathway_items for select
    using (exists (select 1 from learning_pathways lp where lp.id = pathway_id and lp.nurse_id = auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Nurse updates own pathway items" on pathway_items for update
    using (exists (select 1 from learning_pathways lp where lp.id = pathway_id and lp.nurse_id = auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff manage pathway items" on pathway_items for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator')));
exception when duplicate_object then null; end $$;

-- ########## migrations/015-plans-authorizations.sql ##########
-- ============================================================
-- MIGRATION 015: ASSESSMENT PLANS + CLINICAL AUTHORIZATION
-- Book II Ch.11 (Assessment Plan Object) & Ch.24 (Clinical Authorization Object)
-- Additive & idempotent.
-- ============================================================

-- ── ASSESSMENT PLAN (Book II Ch.11) ─────────────────────────
-- Operationalises a blueprint into a scheduled, individualised plan.
create table if not exists assessment_plans (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  hospital_id     uuid references hospitals(id) on delete cascade,
  programme_type  text not null default 'annual'
                    check (programme_type in ('recruitment','orientation','probation','annual','specialty','remediation','return_to_practice','leadership')),
  scheduling_rule text default 'fixed'
                    check (scheduling_rule in ('fixed','rolling','competency_triggered','event_triggered')),
  nurse_id        uuid references profiles(id) on delete cascade,   -- null when a reusable template
  is_template     boolean default false,
  start_date      date default current_date,
  due_date        date,
  status          text not null default 'draft'
                    check (status in ('draft','active','complete','cancelled')),
  notes           text,
  created_by      uuid references profiles(id),
  created_at      timestamptz default now()
);

-- Targeted CPUs / frameworks with expected competency level
create table if not exists plan_items (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references assessment_plans(id) on delete cascade,
  cpu_id        uuid references clinical_practice_units(id) on delete cascade,
  framework_id  uuid references frameworks(id) on delete cascade,
  expected_score int check (expected_score between 0 and 6),
  method        text,
  created_at    timestamptz default now()
);

-- Assigned assessors (multi-assessor planning)
create table if not exists plan_assessors (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references assessment_plans(id) on delete cascade,
  assessor_id  uuid not null references profiles(id) on delete cascade,
  role         text default 'primary' check (role in ('primary','secondary','peer','observer')),
  created_at   timestamptz default now(),
  unique (plan_id, assessor_id)
);

-- ── CLINICAL AUTHORIZATION (Book II Ch.24) ──────────────────
-- Separates demonstrated competency from organizational permission to practise.
create table if not exists clinical_authorizations (
  id                  uuid primary key default gen_random_uuid(),
  authorization_number text unique default ('CAO-' || substr(gen_random_uuid()::text, 1, 8)),
  nurse_id            uuid not null references profiles(id) on delete cascade,
  hospital_id         uuid references hospitals(id) on delete cascade,
  authorization_type  text not null default 'clinical_privilege'
                        check (authorization_type in (
                          'clinical_privilege','scope_of_practice','supervised_practice','restricted_practice',
                          'temporary','emergency','equipment','independent','procedural')),
  authorization_level text not null default 'independent'
                        check (authorization_level in ('supervised','independent')),
  status              text not null default 'active'
                        check (status in ('pending','active','suspended','revoked','expired')),
  scope               text,
  conditions          text,
  effective_date      date default current_date,
  expiry_date         date,
  based_on_decision   uuid references competency_decisions(id) on delete set null,
  granted_by          uuid references profiles(id),
  granted_by_name     text,
  created_at          timestamptz default now()
);
create index if not exists idx_cao_nurse on clinical_authorizations(nurse_id);

-- Activities authorized — each links to a CPU / competency
create table if not exists authorization_activities (
  id               uuid primary key default gen_random_uuid(),
  authorization_id uuid not null references clinical_authorizations(id) on delete cascade,
  cpu_id           uuid references clinical_practice_units(id) on delete set null,
  competency_id    uuid references framework_competencies(id) on delete set null,
  label            text not null,
  created_at       timestamptz default now()
);

-- ── RLS ─────────────────────────────────────────────────────
alter table assessment_plans        enable row level security;
alter table plan_items              enable row level security;
alter table plan_assessors          enable row level security;
alter table clinical_authorizations enable row level security;
alter table authorization_activities enable row level security;

-- Plans: staff manage; a nurse can see plans assigned to them
do $$ begin
  create policy "Staff manage plans" on assessment_plans for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator','assessor')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Nurse reads own plans" on assessment_plans for select using (nurse_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff manage plan items" on plan_items for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator','assessor')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Auth read plan items" on plan_items for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff manage plan assessors" on plan_assessors for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator','assessor')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Auth read plan assessors" on plan_assessors for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

-- Authorizations: nurse reads own; admins/educators grant & manage
do $$ begin
  create policy "Nurse reads own authorizations" on clinical_authorizations for select using (nurse_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff read authorizations" on clinical_authorizations for select
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator','assessor')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Admins write authorizations" on clinical_authorizations for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Read authorization activities" on authorization_activities for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Admins write authorization activities" on authorization_activities for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator')));
exception when duplicate_object then null; end $$;

-- ########## migrations/016-credentials-curriculum.sql ##########
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

-- ########## migrations/017-knowledge-graph.sql ##########
-- ============================================================
-- MIGRATION 017: KNOWLEDGE GRAPH + VECTOR FOUNDATION (Book IV Ch.2–5)
-- Enables pgvector and adds an embeddings table for RAG retrieval.
-- The knowledge_edges table already exists (migration 012); this adds the
-- semantic/vector substrate. Additive & idempotent.
-- ============================================================

-- pgvector is available on Supabase; enable it.
create extension if not exists vector;

-- ── KNOWLEDGE EMBEDDINGS (RAG substrate) ────────────────────
-- One row per governed object chunk; embedding filled by the pipeline once
-- an AI provider key is configured. Dimension 1536 fits common embedding models
-- (OpenAI text-embedding-3-small, Voyage, etc.); adjust if your model differs.
create table if not exists knowledge_embeddings (
  id            uuid primary key default gen_random_uuid(),
  object_type   text not null,          -- framework | domain | practice | cpu | competency | skill | resource | policy
  object_id     uuid not null,
  content       text not null,          -- the text that was embedded
  embedding     vector(1536),           -- null until embedded
  model         text,                   -- which embedding model produced it
  updated_at    timestamptz default now(),
  created_at    timestamptz default now(),
  unique (object_type, object_id)
);

-- Vector similarity index (cosine). Created only if the table has the column.
do $$ begin
  create index if not exists idx_knowledge_embeddings_vec
    on knowledge_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);
exception when others then null; end $$;

create index if not exists idx_knowledge_embeddings_obj on knowledge_embeddings(object_type, object_id);
create index if not exists idx_knowledge_embeddings_null on knowledge_embeddings(object_type) where embedding is null;

-- ── RLS ─────────────────────────────────────────────────────
alter table knowledge_embeddings enable row level security;
do $$ begin
  create policy "Auth read embeddings" on knowledge_embeddings for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Super admin writes embeddings" on knowledge_embeddings for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin'));
exception when duplicate_object then null; end $$;

-- ########## migrations/018-fts-recognitions.sql ##########
-- ============================================================
-- MIGRATION 018: FULL-TEXT SEARCH + PROFESSIONAL RECOGNITION
-- 1) search_ckcm() — Postgres FTS over all governed content
--    (Book IV retrieval upgrade for the AI agents; no embeddings key needed)
-- 2) professional_recognitions — Book II Ch.26 (Professional Recognition Object)
-- Additive & idempotent.
-- ============================================================

-- ── CKCM FULL-TEXT SEARCH ───────────────────────────────────
create or replace function search_ckcm(q text, max_results int default 20)
returns table(object_type text, object_id uuid, title text, snippet text, rank real)
language sql stable
as $$
with tsq as (select websearch_to_tsquery('english', q) as query),
hits as (
  select 'framework'::text as object_type, f.id as object_id, f.name as title,
         coalesce(f.description, '') as snippet,
         ts_rank(to_tsvector('english', f.name || ' ' || coalesce(f.description, '')), tsq.query) as rank
  from frameworks f, tsq
  where f.is_active
    and to_tsvector('english', f.name || ' ' || coalesce(f.description, '')) @@ tsq.query

  union all
  select 'cpu', u.id, u.name, coalesce(u.description, ''),
         ts_rank(to_tsvector('english', u.name || ' ' || coalesce(u.description, '')), tsq.query)
  from clinical_practice_units u, tsq
  where to_tsvector('english', u.name || ' ' || coalesce(u.description, '')) @@ tsq.query

  union all
  select 'competency', c.id, c.name, coalesce(c.description, ''),
         ts_rank(to_tsvector('english', c.name || ' ' || coalesce(c.description, '')), tsq.query)
  from framework_competencies c, tsq
  where to_tsvector('english', c.name || ' ' || coalesce(c.description, '')) @@ tsq.query

  union all
  select 'skill', s.id, s.name, '',
         ts_rank(to_tsvector('english', s.name), tsq.query)
  from competency_skills s, tsq
  where to_tsvector('english', s.name) @@ tsq.query

  union all
  select 'resource', r.id, r.title, coalesce(r.description, ''),
         ts_rank(to_tsvector('english', r.title || ' ' || coalesce(r.description, '')), tsq.query)
  from learning_resources r, tsq
  where r.is_active
    and to_tsvector('english', r.title || ' ' || coalesce(r.description, '')) @@ tsq.query

  union all
  select 'policy', p.id, p.title, left(coalesce(p.content, ''), 300),
         ts_rank(to_tsvector('english', p.title || ' ' || coalesce(p.content, '')), tsq.query)
  from policies p, tsq
  where to_tsvector('english', p.title || ' ' || coalesce(p.content, '')) @@ tsq.query
)
select * from hits order by rank desc limit max_results
$$;

grant execute on function search_ckcm(text, int) to authenticated;

-- ── PROFESSIONAL RECOGNITION (Book II Ch.26) ────────────────
create table if not exists professional_recognitions (
  id               uuid primary key default gen_random_uuid(),
  nurse_id         uuid not null references profiles(id) on delete cascade,
  hospital_id      uuid references hospitals(id) on delete cascade,
  recognition_type text not null default 'excellence_award'
                     check (recognition_type in (
                       'excellence_award','preceptor','mentor','employee_of_month',
                       'innovation','patient_safety_champion','long_service','custom')),
  title            text not null,
  description      text,
  awarded_by       uuid references profiles(id),
  awarded_by_name  text,
  awarded_at       date default current_date,
  created_at       timestamptz default now()
);
create index if not exists idx_recognitions_nurse on professional_recognitions(nurse_id);

alter table professional_recognitions enable row level security;
do $$ begin
  create policy "Nurse reads own recognitions" on professional_recognitions for select using (nurse_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff read recognitions" on professional_recognitions for select
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('super_admin','hospital_admin','educator','assessor')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Admins write recognitions" on professional_recognitions for all
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('super_admin','hospital_admin','educator')));
exception when duplicate_object then null; end $$;

-- Refresh the API schema cache so new tables/functions are visible immediately
notify pgrst, 'reload schema';
