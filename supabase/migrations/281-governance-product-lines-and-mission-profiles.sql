-- 281 - PLAT-GOV-001 product lines + PLAT-GOV-MC-001 mission control profile registry
--
-- PART 1 of PLAT-GOV-001 section 18 step 1 and PLAT-GOV-MC-001 section 16 steps 1 and 3.
--
-- WHY A NEW TABLE AND NOT plat_products. plat_products already exists with 8 rows and is the ENGINE
-- catalogue - competency, mclip, lms, simulation, passport, coe, pce, practice - read by control-plane,
-- licensing, feature-flags and portfolio. GOV-001 section 2 calls that layer "platform engines" and lists
-- it separately from the four SaaS PRODUCT LINES. Overloading one table with both axes would conflate
-- exactly what the specification separates, and would break eleven existing readers. The word "practice"
-- appears in both catalogues and means different things in each - a module in one, a product line in the
-- other.
--
-- COMPETEN PLATFORM IS SEEDED AS A FOUNDATION ROW, NOT A PRODUCT. GOV-001 section 2 classifies it as the
-- technology foundation, and section 18 step 1 says to mark it so. Recording it as a row with a different
-- classification makes the distinction queryable instead of tribal.

create table if not exists plat_product_line (
  code               text primary key,
  name               text not null,
  classification     text not null default 'saas_product',
  primary_customer   text,
  is_active          boolean not null default true,
  sort               integer not null default 0,
  created_at         timestamptz not null default now()
);

alter table plat_product_line drop constraint if exists plat_product_line_name_present;
alter table plat_product_line add constraint plat_product_line_name_present check (btrim(name) <> '');

alter table plat_product_line drop constraint if exists plat_product_line_classification_known;
alter table plat_product_line add constraint plat_product_line_classification_known
  check (classification in ('saas_product', 'foundation'));

alter table plat_product_line enable row level security;

insert into plat_product_line (code, name, classification, primary_customer, sort) values
  ('platform',    'Competen Platform',    'foundation',   'Shared foundation - identity, security, data, capability engines and cross-product services', 0),
  ('enterprise',  'Competen Enterprise',  'saas_product', 'Hospitals, health systems, NGOs, universities and enterprise healthcare organisations',      10),
  ('individual',  'Competen Individual',  'saas_product', 'Students and healthcare professionals',                                                      20),
  ('practice',    'Competen Practice',    'saas_product', 'Independent practitioners and practices',                                                    30),
  ('recruitment', 'Competen Recruitment', 'saas_product', 'Employers and candidates',                                                                   40)
on conflict (code) do update set
  name = excluded.name,
  classification = excluded.classification,
  primary_customer = excluded.primary_customer,
  sort = excluded.sort;

-- WHICH PRODUCT LINE A POSITION GOVERNS. Nullable on purpose - GOV-001 level 1 roles such as Chief
-- Executive and Quality Council Member are HQ-level and govern no single product line. Only a level 2
-- Product Director binds to one.
alter table hq_position add column if not exists product_line_code text;
alter table hq_position drop constraint if exists hq_position_product_line_fk;
alter table hq_position add constraint hq_position_product_line_fk
  foreign key (product_line_code) references plat_product_line(code);

update hq_position set product_line_code = 'practice'
  where code = 'practice_product_director' and product_line_code is null;
update hq_position set product_line_code = 'platform'
  where code = 'platform_director' and product_line_code is null;

-- THE APPOINTMENT CARRIES THE PRODUCT TOO. GOV-001 section 6 requires product_id on the appointment, not
-- only on the role, because one identity may hold several appointments and the ACTIVE one decides the
-- context. It is nullable for every tenant office appointment that already exists in this table - the CMO,
-- QAW and HEX offices are not product governance.
alter table ogs_office_appointments add column if not exists product_line_code text;
alter table ogs_office_appointments drop constraint if exists ogs_appt_product_line_fk;
alter table ogs_office_appointments add constraint ogs_appt_product_line_fk
  foreign key (product_line_code) references plat_product_line(code);

update ogs_office_appointments a
   set product_line_code = p.product_line_code
  from hq_position p
 where a.role = p.code
   and p.product_line_code is not null
   and a.product_line_code is null;

create index if not exists idx_ogs_appt_product_line on ogs_office_appointments(product_line_code);

-- PART 2 - PLAT-GOV-MC-001 sections 9 and 10, the mission control configuration registry.
--
-- A PROFILE IS SELECTED BY GOVERNANCE CONTEXT, NEVER BY JOB TITLE - section 10. Resolution order is
-- ownership, then the product line the held position governs, then the fail-closed minimum.

create table if not exists hq_mission_profile (
  code               text primary key,
  name               text not null,
  governance_level   text not null,
  product_line_code  text references plat_product_line(code),
  priority           integer not null default 100,
  status             text not null default 'active',
  description        text,
  created_at         timestamptz not null default now()
);

alter table hq_mission_profile drop constraint if exists hq_mission_profile_level_known;
alter table hq_mission_profile add constraint hq_mission_profile_level_known
  check (governance_level in ('hq', 'product', 'tenant', 'operational'));

alter table hq_mission_profile drop constraint if exists hq_mission_profile_status_known;
alter table hq_mission_profile add constraint hq_mission_profile_status_known
  check (status in ('active', 'draft', 'retired'));

alter table hq_mission_profile enable row level security;

-- A WIDGET DECLARES THE CAPABILITY IT NEEDS, AND THE RENDERER MUST ASK AGAIN. Section 10 - "widgets must
-- independently enforce authorization, hiding a widget is not a security control". This column is what the
-- widget renderer tests, so a widget that reaches this table without a capability cannot be drawn.
create table if not exists hq_mission_widget (
  code                 text primary key,
  label                text not null,
  data_source          text not null,
  required_capability  text not null references hq_capability(code),
  size                 text not null default 'md',
  created_at           timestamptz not null default now()
);

alter table hq_mission_widget drop constraint if exists hq_mission_widget_size_known;
alter table hq_mission_widget add constraint hq_mission_widget_size_known
  check (size in ('sm', 'md', 'lg'));

alter table hq_mission_widget drop constraint if exists hq_mission_widget_source_present;
alter table hq_mission_widget add constraint hq_mission_widget_source_present check (btrim(data_source) <> '');

alter table hq_mission_widget enable row level security;

create table if not exists hq_profile_widget (
  profile_code  text not null references hq_mission_profile(code) on delete cascade,
  widget_code   text not null references hq_mission_widget(code) on delete cascade,
  sort          integer not null default 0,
  primary key (profile_code, widget_code)
);

alter table hq_profile_widget enable row level security;

-- ONLY WIDGETS WITH A DATA SOURCE THAT EXISTS TODAY ARE SEEDED. Each of the three below reads a table that
-- loadPracticeOps already reads - practice_workspace, provisioning_request and practice_platform_flags.
-- The operator licence queue is deliberately NOT seeded - migration 273 created its door but no engine
-- reads it yet, and a widget declaring a source nobody has written is a promise on a screen.
insert into hq_mission_widget (code, label, data_source, required_capability, size) values
  ('practice_total',             'Practices',            'practice.workspaces.total',    'hq.practice.operations.view', 'sm'),
  ('practice_provisioning_queue','Provisioning queue',   'practice.provisioning.pending','hq.practice.operations.view', 'md'),
  ('practice_launch_flags',      'Launch flags',         'practice.flags',               'hq.practice.operations.view', 'md')
on conflict (code) do update set
  label = excluded.label,
  data_source = excluded.data_source,
  required_capability = excluded.required_capability,
  size = excluded.size;

insert into hq_mission_profile (code, name, governance_level, product_line_code, priority, description) values
  ('hq_super_admin', 'Competen HQ Mission Control', 'hq', null, 10,
   'Platform owners and HQ appointees. Carries no widget rows yet - the existing Mission Control page renders for this profile, so seeding widgets here would describe a composition nothing consumes.'),
  ('product_practice', 'Competen Practice Product Mission Control', 'product', 'practice', 20,
   'Practice Product Director. Composed from the practice widgets below rather than the platform estate command centre, which measures a different product.'),
  ('hq_minimal', 'Competen HQ (minimum safe view)', 'hq', null, 900,
   'The fail-closed fallback required by PLAT-GOV-MC-001 section 10. Carries no widgets by design - an unresolved or invalid configuration must land somewhere safe rather than compose something arbitrary.')
on conflict (code) do update set
  name = excluded.name,
  governance_level = excluded.governance_level,
  product_line_code = excluded.product_line_code,
  priority = excluded.priority,
  description = excluded.description;

insert into hq_profile_widget (profile_code, widget_code, sort) values
  ('product_practice', 'practice_total',              10),
  ('product_practice', 'practice_provisioning_queue', 20),
  ('product_practice', 'practice_launch_flags',       30)
on conflict (profile_code, widget_code) do update set sort = excluded.sort;

notify pgrst, 'reload schema';
