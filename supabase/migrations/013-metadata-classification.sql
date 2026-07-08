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
