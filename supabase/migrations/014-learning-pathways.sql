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
