-- ============================================================
-- MIGRATION 011: CKCM STRUCTURAL SPINE (Book I, Phase 1)
-- Adds the two missing hierarchy levels + governed assessment objects:
--   Framework → Domain → PRACTICE → CLINICAL PRACTICE UNIT → Competency → Skill
-- Plus: Assessment Blueprint, Evidence Matrix, Competency Decision
-- Fully additive & idempotent — existing frameworks keep working with
-- practice_id / cpu_id left NULL (treated as "ungrouped").
-- ============================================================

-- ── PRACTICE LAYER ──────────────────────────────────────────
-- A coherent clinical practice area within a domain (e.g. "Oxygen Therapy")
create table if not exists practices (
  id          uuid primary key default gen_random_uuid(),
  domain_id   uuid not null references framework_domains(id) on delete cascade,
  name        text not null,
  description text,
  code        text,                 -- e.g. PRA-OXY-001
  sort_order  int default 0,
  created_at  timestamptz default now()
);

-- ── CLINICAL PRACTICE UNIT (CPU) LAYER ──────────────────────
-- The smallest independently governable package of clinical practice.
create table if not exists clinical_practice_units (
  id             uuid primary key default gen_random_uuid(),
  practice_id    uuid not null references practices(id) on delete cascade,
  name           text not null,
  description    text,
  code           text,               -- e.g. CPU-OXYSAFE-001
  risk_category  text default 'standard'
                   check (risk_category in ('low','standard','high','critical')),
  complexity     int default 2 check (complexity between 1 and 5),
  reassessment_months int default 12,
  pub_status     text default 'draft'
                   check (pub_status in ('draft','in_review','approved','published','archived')),
  version_num    int default 0,
  sort_order     int default 0,
  created_at     timestamptz default now()
);

-- ── LINK EXISTING COMPETENCIES INTO THE NEW LAYERS ──────────
-- Nullable so all current competencies remain valid (ungrouped).
alter table framework_competencies add column if not exists practice_id uuid references practices(id) on delete set null;
alter table framework_competencies add column if not exists cpu_id      uuid references clinical_practice_units(id) on delete set null;
alter table framework_competencies add column if not exists code        text;
alter table framework_competencies add column if not exists risk_category text default 'standard';

-- ── SKILL TIERING (Composite vs Simple) ─────────────────────
-- competency_skills already exists; add tiering + complexity metadata.
alter table competency_skills add column if not exists skill_tier   text default 'simple'
  check (skill_tier in ('composite','simple'));
alter table competency_skills add column if not exists parent_skill_id uuid references competency_skills(id) on delete set null;
alter table competency_skills add column if not exists complexity   int default 1 check (complexity between 1 and 5);
alter table competency_skills add column if not exists category     text;
alter table competency_skills add column if not exists code         text;

-- ── ASSESSMENT BLUEPRINT (per CPU) ──────────────────────────
-- Defines HOW a CPU is assessed: required methods, weightings, pass rule.
create table if not exists assessment_blueprints (
  id              uuid primary key default gen_random_uuid(),
  cpu_id          uuid not null references clinical_practice_units(id) on delete cascade,
  min_score       int default 4 check (min_score between 0 and 6),
  min_assessors   int default 1,
  consensus_rule  text default 'any' check (consensus_rule in ('any','majority','unanimous','weighted','lead')),
  reassessment_months int default 12,
  created_at      timestamptz default now(),
  unique (cpu_id)
);

-- Per-method configuration within a blueprint (weightings, required, critical)
create table if not exists blueprint_methods (
  id            uuid primary key default gen_random_uuid(),
  blueprint_id  uuid not null references assessment_blueprints(id) on delete cascade,
  method        text not null check (method in (
                  'self','knowledge','skills_checklist','direct_observation','simulation',
                  'osce','concurrent_audit','retrospective_audit','portfolio',
                  'peer','supervisor','interview')),
  weight        int default 0,       -- percentage contribution
  is_required   boolean default true,
  min_evidence  int default 1,
  created_at    timestamptz default now(),
  unique (blueprint_id, method)
);

-- ── EVIDENCE MATRIX (per CPU) ───────────────────────────────
-- The rulebook the Evidence Engine enforces: which evidence, how much,
-- validity, weighting, critical evidence, reassessment triggers.
create table if not exists evidence_matrix (
  id                uuid primary key default gen_random_uuid(),
  cpu_id            uuid not null references clinical_practice_units(id) on delete cascade,
  evidence_type     text not null,
  min_quantity      int default 1,
  weight            int default 0,           -- percentage
  validity_months   int default 12,
  is_critical       boolean default false,   -- must be present regardless of score
  min_assessors     int default 1,
  created_at        timestamptz default now(),
  unique (cpu_id, evidence_type)
);

-- ── CRITICAL FAILURE RULES (per CPU) ────────────────────────
-- Non-negotiable safety failures that block competency regardless of score.
create table if not exists critical_failure_rules (
  id          uuid primary key default gen_random_uuid(),
  cpu_id      uuid not null references clinical_practice_units(id) on delete cascade,
  description text not null,
  created_at  timestamptz default now()
);

-- ── COMPETENCY DECISION (formal governed object) ────────────
-- Book I Ch.10: the formal determination, distinct from raw scores.
create table if not exists competency_decisions (
  id              uuid primary key default gen_random_uuid(),
  cycle_id        uuid references competency_cycles(id) on delete cascade,
  nurse_id        uuid not null references profiles(id) on delete cascade,
  cpu_id          uuid references clinical_practice_units(id),
  competency_id   uuid references framework_competencies(id),
  framework_id    uuid references frameworks(id),
  outcome         text not null check (outcome in (
                    'competent','competent_with_conditions','provisionally_competent',
                    'requires_remediation','not_yet_competent','suspended','expired')),
  maturity        text check (maturity in (
                    'novice','advanced_beginner','competent','proficient','expert','mentor','authority')),
  decided_by      uuid references profiles(id),
  decided_by_name text,
  effective_date  date default current_date,
  expiry_date     date,
  evidence_summary text,
  critical_failure boolean default false,
  validated_by    uuid references profiles(id),
  validated_at    timestamptz,
  validation_outcome text check (validation_outcome in ('validated','returned','deferred','rejected')),
  version_num     int default 1,
  created_at      timestamptz default now()
);

create index if not exists idx_decisions_nurse on competency_decisions(nurse_id);
create index if not exists idx_decisions_cpu   on competency_decisions(cpu_id);
create index if not exists idx_practices_domain on practices(domain_id);
create index if not exists idx_cpu_practice     on clinical_practice_units(practice_id);
create index if not exists idx_comp_cpu         on framework_competencies(cpu_id);

-- ── RLS ─────────────────────────────────────────────────────
alter table practices               enable row level security;
alter table clinical_practice_units enable row level security;
alter table assessment_blueprints   enable row level security;
alter table blueprint_methods       enable row level security;
alter table evidence_matrix         enable row level security;
alter table critical_failure_rules  enable row level security;
alter table competency_decisions    enable row level security;

-- Content structure: authenticated read (mirrors frameworks policy)
do $$ begin
  create policy "Auth read practices" on practices for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Auth read cpus" on clinical_practice_units for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Auth read blueprints" on assessment_blueprints for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Auth read blueprint_methods" on blueprint_methods for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Auth read evidence_matrix" on evidence_matrix for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Auth read critical_failures" on critical_failure_rules for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

-- Decisions: nurse sees own; clinical roles see their hospital
do $$ begin
  create policy "Nurse reads own decisions" on competency_decisions for select
    using (nurse_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff read decisions" on competency_decisions for select
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('assessor','educator','hospital_admin','super_admin')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff write decisions" on competency_decisions for all
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('educator','hospital_admin','super_admin')));
exception when duplicate_object then null; end $$;

-- Content structure writes: super_admin only (master library authoring)
do $$ begin
  create policy "Super admin writes practices" on practices for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Super admin writes cpus" on clinical_practice_units for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Super admin writes blueprints" on assessment_blueprints for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Super admin writes blueprint_methods" on blueprint_methods for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Super admin writes evidence_matrix" on evidence_matrix for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Super admin writes critical_failures" on critical_failure_rules for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin'));
exception when duplicate_object then null; end $$;
