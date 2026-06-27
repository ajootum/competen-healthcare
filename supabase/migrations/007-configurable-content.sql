-- ============================================================
-- PHASE 2: Fully Configurable Content Engine
-- All clinical content configurable through admin UI
-- ============================================================

-- ── PERFORMANCE CRITERIA (under competencies) ──────────────
create table if not exists performance_criteria (
  id             uuid primary key default gen_random_uuid(),
  competency_id  uuid not null references framework_competencies(id) on delete cascade,
  criterion      text not null,
  description    text,
  sort_order     int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz default now()
);

-- ── SKILLS (under competencies) ────────────────────────────
create table if not exists competency_skills (
  id             uuid primary key default gen_random_uuid(),
  competency_id  uuid not null references framework_competencies(id) on delete cascade,
  name           text not null,
  description    text,
  sort_order     int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz default now()
);

-- ── CHECKLISTS (under skills) ──────────────────────────────
create table if not exists skill_checklists (
  id          uuid primary key default gen_random_uuid(),
  skill_id    uuid not null references competency_skills(id) on delete cascade,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz default now()
);

-- ── CHECKLIST ITEMS ────────────────────────────────────────
create table if not exists checklist_items (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references skill_checklists(id) on delete cascade,
  item         text not null,
  description  text,
  is_critical  boolean not null default false,  -- must pass
  sort_order   int not null default 0,
  created_at   timestamptz default now()
);

-- ── SCORING SCALES ─────────────────────────────────────────
create table if not exists scoring_scales (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  min_score   int not null default 0,
  max_score   int not null default 6,
  is_default  boolean not null default false,
  created_at  timestamptz default now()
);

create table if not exists scoring_levels (
  id          uuid primary key default gen_random_uuid(),
  scale_id    uuid not null references scoring_scales(id) on delete cascade,
  score       int not null,
  label       text not null,
  description text,
  color       text not null default '#6b7280',
  is_passing  boolean not null default false,
  created_at  timestamptz default now(),
  unique (scale_id, score)
);

-- Assign a scoring scale to a framework (optional; falls back to default)
create table if not exists framework_scoring (
  id               uuid primary key default gen_random_uuid(),
  framework_id     uuid not null references frameworks(id) on delete cascade unique,
  scale_id         uuid not null references scoring_scales(id),
  pass_threshold   int not null default 3,
  created_at       timestamptz default now()
);

-- ── ASSESSMENT METHOD CONFIGS ──────────────────────────────
create table if not exists assessment_method_configs (
  id              uuid primary key default gen_random_uuid(),
  -- scope: applies to framework OR specific competency (one must be set)
  framework_id    uuid references frameworks(id) on delete cascade,
  competency_id   uuid references framework_competencies(id) on delete cascade,
  method          text not null check (method in (
                    'knowledge','direct_observation','simulation',
                    'osce','concurrent_audit','retrospective_audit','logbook'
                  )),
  is_required     boolean not null default false,
  min_assessors   int not null default 1,
  weight          numeric not null default 1,   -- for weighted average
  settings        jsonb not null default '{}',  -- method-specific config
  is_active       boolean not null default true,
  created_at      timestamptz default now()
);

-- ── REASSESSMENT SCHEDULES ─────────────────────────────────
create table if not exists reassessment_schedules (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  framework_id          uuid references frameworks(id) on delete cascade,
  cycle_type            text check (cycle_type in ('orientation','probation','annual','remediation','specialty')),
  frequency_months      int not null,           -- e.g. 12 = annual
  trigger_on_fail       boolean not null default true,
  trigger_on_expiry     boolean not null default true,
  trigger_on_role_change boolean not null default false,
  grace_period_days     int not null default 30,
  auto_create_cycle     boolean not null default false,
  is_active             boolean not null default true,
  created_at            timestamptz default now()
);

-- ── POLICY DOCUMENTS ───────────────────────────────────────
create table if not exists policies (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  content         text,                         -- rich text / markdown
  policy_type     text not null default 'clinical'
                    check (policy_type in ('clinical','hr','safety','governance','infection_control','quality')),
  version         text not null default '1.0',
  effective_date  date,
  review_date     date,
  -- scope (null = global)
  hospital_id     uuid references hospitals(id),
  framework_id    uuid references frameworks(id),
  department_id   uuid references departments(id),
  is_active       boolean not null default true,
  created_by      uuid references profiles(id),
  approved_by     uuid references profiles(id),
  created_at      timestamptz default now()
);

-- ── WORKFLOW TEMPLATES ─────────────────────────────────────
create table if not exists workflow_templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  trigger_type    text not null check (trigger_type in (
                    'assessment_complete','cycle_end',
                    'score_below_threshold','expiry_approaching',
                    'validation_required','policy_review_due'
                  )),
  steps           jsonb not null default '[]',
  -- example step: {"order":1,"role":"educator","action":"validate","notify":true,"deadline_days":7}
  hospital_id     uuid references hospitals(id),  -- null = global template
  is_active       boolean not null default true,
  created_at      timestamptz default now()
);

-- ── REPORT TEMPLATES ───────────────────────────────────────
create table if not exists report_templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  report_type     text not null check (report_type in (
                    'competency_summary','workforce_analysis','cycle_completion',
                    'domain_scores','framework_scores','policy_compliance',
                    'assessor_activity','educator_validation'
                  )),
  columns         jsonb not null default '[]',  -- [{key, label, type}]
  filters         jsonb not null default '{}',  -- default filter values
  group_by        text,
  sort_by         text,
  is_global       boolean not null default true,
  hospital_id     uuid references hospitals(id),
  is_active       boolean not null default true,
  created_at      timestamptz default now()
);

-- ── SEED DEFAULT SCORING SCALE (0-6 current system) ───────
insert into scoring_scales (id, name, description, min_score, max_score, is_default)
values ('00000000-0000-0000-0000-000000000001', 'Benner 0-6 Scale', 'Standard clinical competency scale based on Benner novice-to-expert model', 0, 6, true)
on conflict do nothing;

insert into scoring_levels (scale_id, score, label, description, color, is_passing) values
  ('00000000-0000-0000-0000-000000000001', 0, 'Training Required',    'No exposure; formal training needed before practice', '#ef4444', false),
  ('00000000-0000-0000-0000-000000000001', 1, 'Novice',               'Limited exposure; requires direct supervision', '#f97316', false),
  ('00000000-0000-0000-0000-000000000001', 2, 'Advanced Beginner',    'Some experience; requires close supervision', '#eab308', false),
  ('00000000-0000-0000-0000-000000000001', 3, 'Competent',            'Meets standard; can perform independently', '#14b8a6', true),
  ('00000000-0000-0000-0000-000000000001', 4, 'Competent+',           'Exceeds standard; occasional supervision only', '#0d9488', true),
  ('00000000-0000-0000-0000-000000000001', 5, 'Proficient',           'Well above standard; can guide others', '#3b82f6', true),
  ('00000000-0000-0000-0000-000000000001', 6, 'Expert',               'Mastery level; recognised clinical leader', '#8b5cf6', true)
on conflict do nothing;

-- ── SEED DEFAULT REASSESSMENT SCHEDULES ────────────────────
insert into reassessment_schedules (name, cycle_type, frequency_months, trigger_on_fail, trigger_on_expiry, grace_period_days, is_active) values
  ('Annual Review',           'annual',      12, true,  true,  30, true),
  ('Orientation (90-day)',    'orientation',  3, true,  false, 14, true),
  ('Probation (6-month)',     'probation',    6, true,  false, 14, true),
  ('Remediation (30-day)',    'remediation',  1, false, false,  7, true),
  ('Specialty (6-month)',     'specialty',    6, true,  true,  30, true)
on conflict do nothing;

-- ── SEED DEFAULT REPORT TEMPLATES ──────────────────────────
insert into report_templates (name, description, report_type, columns, is_global) values
  ('Competency Summary', 'Per-nurse competency scores across all frameworks', 'competency_summary',
   '[{"key":"nurse_name","label":"Nurse","type":"text"},{"key":"framework","label":"Framework","type":"text"},{"key":"domain","label":"Domain","type":"text"},{"key":"score","label":"Score","type":"number"},{"key":"level","label":"Level","type":"badge"},{"key":"assessed_at","label":"Date","type":"date"}]',
   true),
  ('Workforce Analysis', 'Hospital-wide competency coverage and readiness', 'workforce_analysis',
   '[{"key":"department","label":"Department","type":"text"},{"key":"total_nurses","label":"Nurses","type":"number"},{"key":"on_cycle","label":"On Cycle","type":"number"},{"key":"avg_score","label":"Avg Score","type":"number"},{"key":"competent_pct","label":"% Competent","type":"percent"}]',
   true),
  ('Cycle Completion', 'Assessment cycle progress and completion rates', 'cycle_completion',
   '[{"key":"nurse_name","label":"Nurse","type":"text"},{"key":"cycle_type","label":"Cycle","type":"badge"},{"key":"start_date","label":"Started","type":"date"},{"key":"end_date","label":"Due","type":"date"},{"key":"progress_pct","label":"Progress","type":"percent"},{"key":"status","label":"Status","type":"badge"}]',
   true),
  ('Assessor Activity', 'Assessment activity per assessor', 'assessor_activity',
   '[{"key":"assessor_name","label":"Assessor","type":"text"},{"key":"assessments_count","label":"Assessments","type":"number"},{"key":"nurses_assessed","label":"Nurses","type":"number"},{"key":"avg_score_given","label":"Avg Score","type":"number"},{"key":"last_activity","label":"Last Active","type":"date"}]',
   true)
on conflict do nothing;

-- ── RLS ────────────────────────────────────────────────────
alter table performance_criteria      enable row level security;
alter table competency_skills         enable row level security;
alter table skill_checklists          enable row level security;
alter table checklist_items           enable row level security;
alter table scoring_scales            enable row level security;
alter table scoring_levels            enable row level security;
alter table framework_scoring         enable row level security;
alter table assessment_method_configs enable row level security;
alter table reassessment_schedules    enable row level security;
alter table policies                  enable row level security;
alter table workflow_templates        enable row level security;
alter table report_templates          enable row level security;

-- Authenticated users can read all content
create policy "Authenticated read criteria"      on performance_criteria      for select using (auth.role()='authenticated');
create policy "Authenticated read skills"        on competency_skills         for select using (auth.role()='authenticated');
create policy "Authenticated read checklists"    on skill_checklists          for select using (auth.role()='authenticated');
create policy "Authenticated read items"         on checklist_items           for select using (auth.role()='authenticated');
create policy "Authenticated read scales"        on scoring_scales            for select using (auth.role()='authenticated');
create policy "Authenticated read levels"        on scoring_levels            for select using (auth.role()='authenticated');
create policy "Authenticated read fw scoring"    on framework_scoring         for select using (auth.role()='authenticated');
create policy "Authenticated read methods"       on assessment_method_configs for select using (auth.role()='authenticated');
create policy "Authenticated read schedules"     on reassessment_schedules    for select using (auth.role()='authenticated');
create policy "Authenticated read policies"      on policies                  for select using (auth.role()='authenticated');
create policy "Authenticated read workflows"     on workflow_templates        for select using (auth.role()='authenticated');
create policy "Authenticated read reports"       on report_templates          for select using (auth.role()='authenticated');

-- Super admin can manage all
create policy "Super admin manages criteria"     on performance_criteria      for all using (current_user_is_super_admin());
create policy "Super admin manages skills"       on competency_skills         for all using (current_user_is_super_admin());
create policy "Super admin manages checklists"   on skill_checklists          for all using (current_user_is_super_admin());
create policy "Super admin manages items"        on checklist_items           for all using (current_user_is_super_admin());
create policy "Super admin manages scales"       on scoring_scales            for all using (current_user_is_super_admin());
create policy "Super admin manages levels"       on scoring_levels            for all using (current_user_is_super_admin());
create policy "Super admin manages fw scoring"   on framework_scoring         for all using (current_user_is_super_admin());
create policy "Super admin manages methods"      on assessment_method_configs for all using (current_user_is_super_admin());
create policy "Super admin manages schedules"    on reassessment_schedules    for all using (current_user_is_super_admin());
create policy "Super admin manages policies"     on policies                  for all using (current_user_is_super_admin());
create policy "Super admin manages workflows"    on workflow_templates        for all using (current_user_is_super_admin());
create policy "Super admin manages reports"      on report_templates          for all using (current_user_is_super_admin());

-- Hospital admins can manage their own policies and workflows
create policy "Hospital admin manages policies"
  on policies for all
  using (
    hospital_id is not null
    and current_user_is_hospital_admin_for(hospital_id)
  );

create policy "Hospital admin manages workflows"
  on workflow_templates for all
  using (
    hospital_id is not null
    and current_user_is_hospital_admin_for(hospital_id)
  );
