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
