-- 264: Competen HQ -- spaces, positions, the platform capability catalogue, and OBSERVE mode.
--
-- PLAT-ARCH-SURVEY-001 s2, step 5 of s10. This migration adds NO route and renames NOTHING. It supplies
-- the data the new per-page guard (src/lib/hq/context.ts) resolves against, so that every /super-admin
-- page can carry its own scoped check while the URL stays exactly where it is.
--
-- THE MODEL, and why it is shaped this way:
--   space       -- a CLOSED set of five, CHECK-constrained. A CEO and a CFO occupy the same Executive
--                  space and differ only by what is granted to them, so the space is never the position.
--   position    -- a ROW, not an enum value. Job titles are data because they change.
--   capability  -- the entitlement, copied in shape from practice_role_assignment: time-bound via
--                  effective_from / effective_to, and source-attributed.
--   appointment -- REUSED, not rebuilt. ogs_office_appointments already exists, already carries dates and
--                  status, and already gates CMO / QAW / HEX. This migration seeds five ogs_offices rows
--                  (the table has zero rows today) and appoints nobody.
--
-- super_admin IS NOT TOUCHED. It stays the RLS anchor (current_user_is_super_admin, search_path pinned in
-- 252) and becomes the break-glass owner. No policy, function or role string here depends on changing it.
-- Nothing below can lock an owner out: an owner short-circuits the guard before any of these tables is read.
--
-- OBSERVE BEFORE ENFORCE. hq_config.mode ships as 'observe'. In observe mode the position model RECORDS
-- what it would have refused into hq_access_observation and refuses nothing. The hard gate that IS always
-- enforced -- owner, or a live HQ appointment -- is exactly today's rule, so observe mode is never wider
-- than the layout it replaces.
--
-- House rules: plain idempotent statements, ASCII only, no PL/pgSQL do-blocks, drop-then-add for
-- constraints, RLS on every table, no semicolon anywhere except ending a statement.

-- 1. The platform capability catalogue. There has never been one on this plane -- 222 of 321 live gates
--    are a string comparison against a role name, and every capability code in the product today is
--    practice-scoped.
create table if not exists hq_capability (
  code        text primary key,
  space       text not null,
  label       text not null,
  description text,
  created_at  timestamptz default now()
);
alter table hq_capability drop constraint if exists hq_capability_space_check;
alter table hq_capability add constraint hq_capability_space_check
  check (space in ('executive', 'platform', 'practice', 'learning', 'quality'));
alter table hq_capability drop constraint if exists hq_capability_code_check;
alter table hq_capability add constraint hq_capability_code_check check (btrim(code) <> '');
alter table hq_capability drop constraint if exists hq_capability_label_check;
alter table hq_capability add constraint hq_capability_label_check check (btrim(label) <> '');
create index if not exists idx_hq_capability_space on hq_capability (space);
alter table hq_capability enable row level security;
drop policy if exists hq_capability_read on hq_capability;
create policy hq_capability_read on hq_capability for select to authenticated using (true);

-- 2. Positions. Rows, so a new office holder is an insert and not a deployment.
create table if not exists hq_position (
  code        text primary key,
  space       text not null,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz default now()
);
alter table hq_position drop constraint if exists hq_position_space_check;
alter table hq_position add constraint hq_position_space_check
  check (space in ('executive', 'platform', 'practice', 'learning', 'quality'));
alter table hq_position drop constraint if exists hq_position_code_check;
alter table hq_position add constraint hq_position_code_check check (btrim(code) <> '');
alter table hq_position drop constraint if exists hq_position_name_check;
alter table hq_position add constraint hq_position_name_check check (btrim(name) <> '');
create index if not exists idx_hq_position_space on hq_position (space);
alter table hq_position enable row level security;
drop policy if exists hq_position_read on hq_position;
create policy hq_position_read on hq_position for select to authenticated using (true);

-- 3. The grant. One row per position-capability pair. Revocation sets effective_to rather than deleting,
--    so a withdrawn grant stays readable -- the unique index is deliberately NOT partial, because a
--    partial index is not a usable ON CONFLICT target and that trap has already cost this codebase two
--    silent write failures.
create table if not exists hq_position_capability (
  id              uuid primary key default gen_random_uuid(),
  position_code   text not null references hq_position(code) on delete cascade,
  capability_code text not null references hq_capability(code) on delete cascade,
  source          text not null default 'position_default',
  effective_from  timestamptz not null default now(),
  effective_to    timestamptz,
  granted_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz default now()
);
alter table hq_position_capability drop constraint if exists hq_position_capability_source_check;
alter table hq_position_capability add constraint hq_position_capability_source_check
  check (source in ('position_default', 'explicit_grant', 'delegation'));
alter table hq_position_capability drop constraint if exists hq_position_capability_window_check;
alter table hq_position_capability add constraint hq_position_capability_window_check
  check (effective_to is null or effective_to > effective_from);
create unique index if not exists uq_hq_position_capability on hq_position_capability (position_code, capability_code);
create index if not exists idx_hq_position_capability_pos on hq_position_capability (position_code);
alter table hq_position_capability enable row level security;
drop policy if exists hq_position_capability_read on hq_position_capability;
create policy hq_position_capability_read on hq_position_capability for select to authenticated using (true);

-- 4. The observe-mode ledger. This is the whole point of shipping in observe: a refusal that was not made
--    is written down so the map can be corrected before it starts costing anyone their access.
create table if not exists hq_access_observation (
  id          uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  user_id     uuid references profiles(id) on delete set null,
  route       text not null,
  capability  text,
  decision    text not null,
  mode        text not null,
  positions   text[],
  reason      text
);
alter table hq_access_observation drop constraint if exists hq_access_observation_decision_check;
alter table hq_access_observation add constraint hq_access_observation_decision_check
  check (decision in ('allow', 'allow_owner', 'would_deny', 'deny'));
alter table hq_access_observation drop constraint if exists hq_access_observation_mode_check;
alter table hq_access_observation add constraint hq_access_observation_mode_check
  check (mode in ('observe', 'enforce'));
alter table hq_access_observation drop constraint if exists hq_access_observation_route_check;
alter table hq_access_observation add constraint hq_access_observation_route_check check (btrim(route) <> '');
create index if not exists idx_hq_observation_time on hq_access_observation (occurred_at desc);
create index if not exists idx_hq_observation_user on hq_access_observation (user_id);
alter table hq_access_observation enable row level security;
drop policy if exists hq_access_observation_read on hq_access_observation;
create policy hq_access_observation_read on hq_access_observation for select to authenticated using (true);

-- 5. The mode switch. A single row, so moving to enforcement is a data change a human makes deliberately
--    after reading the ledger -- not a deploy, and not a default that arrives with a release.
create table if not exists hq_config (
  id         text primary key default 'singleton',
  mode       text not null default 'observe',
  updated_at timestamptz default now(),
  updated_by uuid references profiles(id) on delete set null
);
alter table hq_config drop constraint if exists hq_config_singleton_check;
alter table hq_config add constraint hq_config_singleton_check check (id = 'singleton');
alter table hq_config drop constraint if exists hq_config_mode_check;
alter table hq_config add constraint hq_config_mode_check check (mode in ('observe', 'enforce'));
alter table hq_config enable row level security;
drop policy if exists hq_config_read on hq_config;
create policy hq_config_read on hq_config for select to authenticated using (true);
insert into hq_config (id, mode)
select 'singleton', 'observe'
where not exists (select 1 from hq_config where id = 'singleton');

-- 6. The CHECK profiles.platform_role has never had. Migration 040 documented an 11-value vocabulary in a
--    column COMMENT and comments do not reject writes, so any string has been accepted since.
--    PROBED LIVE BEFORE WRITING THIS: 49 profiles, 48 with platform_role null, ONE holding
--    'content_manager', and platform_roles null on all 49. Every value below is in the live PlatformRole
--    union in src/lib/roles.ts, which includes the two documented back-compat aliases
--    (platform_super_admin -> platform_operations, developer -> engineer). Refusing an alias here would
--    reject data the application's own type already admits.
alter table profiles drop constraint if exists profiles_platform_role_check;
alter table profiles add constraint profiles_platform_role_check check (
  platform_role is null or platform_role in (
    'platform_owner', 'platform_operations', 'platform_super_admin', 'customer_success', 'support',
    'product_manager', 'engineer', 'developer', 'ai_operator', 'finance', 'content_manager',
    'quality_officer', 'security_operator'
  )
);
alter table profiles drop constraint if exists profiles_platform_roles_check;
alter table profiles add constraint profiles_platform_roles_check check (
  platform_roles is null or platform_roles <@ array[
    'platform_owner', 'platform_operations', 'platform_super_admin', 'customer_success', 'support',
    'product_manager', 'engineer', 'developer', 'ai_operator', 'finance', 'content_manager',
    'quality_officer', 'security_operator'
  ]::text[]
);
comment on column profiles.platform_role is 'Landlord PLANE discriminator. The HQ hierarchy lives in hq_position plus ogs_office_appointments, not here. CHECK-constrained by migration 264. NULL means a tenant-plane user.';

-- 7. The five HQ spaces, seeded as ogs_offices rows. The table has ZERO rows today and its appointment
--    machinery is already load-bearing for three workspaces, so this reuses it rather than adding a
--    seventh entitlement store.
--    office_type is deliberately prefixed 'hq_' so these enterprise offices can never be matched by the
--    tenant workspace matchers in src/lib/ogs/office.ts -- an unprefixed 'executive' office would have
--    bound the Hospital Executive workspace to an HQ office and turned an HQ appointment into a tenant
--    grant. resolveOffices() filters the prefix out for exactly that reason.
--    NOBODY IS APPOINTED. ogs_office_appointments stays empty until a human decides otherwise.
insert into ogs_offices (hospital_id, organisation_id, office_type, name, code, scope_type, status, authority_source, quorum, established_at, next_review_date, charter_version, is_active)
select null, null, 'hq_executive', 'HQ Executive Space', 'executive', 'enterprise', 'active', 'Platform ownership', 1, current_date, (current_date + 365), 'v1.0', true
where not exists (select 1 from ogs_offices o where o.office_type = 'hq_executive');
insert into ogs_offices (hospital_id, organisation_id, office_type, name, code, scope_type, status, authority_source, quorum, established_at, next_review_date, charter_version, is_active)
select null, null, 'hq_platform', 'HQ Platform Space', 'platform', 'enterprise', 'active', 'Platform ownership', 1, current_date, (current_date + 365), 'v1.0', true
where not exists (select 1 from ogs_offices o where o.office_type = 'hq_platform');
insert into ogs_offices (hospital_id, organisation_id, office_type, name, code, scope_type, status, authority_source, quorum, established_at, next_review_date, charter_version, is_active)
select null, null, 'hq_practice', 'HQ Practice Space', 'practice', 'enterprise', 'active', 'Platform ownership', 1, current_date, (current_date + 365), 'v1.0', true
where not exists (select 1 from ogs_offices o where o.office_type = 'hq_practice');
insert into ogs_offices (hospital_id, organisation_id, office_type, name, code, scope_type, status, authority_source, quorum, established_at, next_review_date, charter_version, is_active)
select null, null, 'hq_learning', 'HQ Learning Space', 'learning', 'enterprise', 'active', 'Platform ownership', 1, current_date, (current_date + 365), 'v1.0', true
where not exists (select 1 from ogs_offices o where o.office_type = 'hq_learning');
insert into ogs_offices (hospital_id, organisation_id, office_type, name, code, scope_type, status, authority_source, quorum, established_at, next_review_date, charter_version, is_active)
select null, null, 'hq_quality', 'HQ Quality Space', 'quality', 'enterprise', 'active', 'Platform ownership', 1, current_date, (current_date + 365), 'v1.0', true
where not exists (select 1 from ogs_offices o where o.office_type = 'hq_quality');

-- 8. The capability catalogue -- one code per /super-admin module, so every one of the 204 page patterns
--    resolves to a declared capability and a route nobody mapped resolves to NULL, which the guard denies.
insert into hq_capability (code, space, label, description) values
  ('hq.executive.command_centre.view', 'executive', 'Command Centre',            'Platform command centre and executive overview'),
  ('hq.executive.priorities.view',     'executive', 'Priority and Execution',    'Objectives, priorities, campaigns and approvals'),
  ('hq.executive.reports.view',        'executive', 'Platform Reports',          'Cross-tenant reporting'),
  ('hq.executive.performance.view',    'executive', 'Performance Management',    'Competency-to-outcome performance platform'),
  ('hq.executive.enterprise.view',     'executive', 'Enterprise Governance',     'Enterprise-level governance surfaces'),
  ('hq.platform.home.view',            'platform',  'HQ Home',                   'The HQ landing surface, granted to every position'),
  ('hq.platform.ai.view',              'platform',  'AI and Intelligence',       'AI platform, AI services and the assistant'),
  ('hq.platform.operations.view',      'platform',  'Platform Operations',       'Platform-ops consoles, configuration and registry'),
  ('hq.platform.system.view',          'platform',  'System and Security',       'System, security and infrastructure surfaces'),
  ('hq.platform.users.view',           'platform',  'User Administration',       'Platform-wide user administration'),
  ('hq.platform.tenants.view',         'platform',  'Tenant Administration',     'Hospitals and organisations'),
  ('hq.platform.settings.view',        'platform',  'Platform Settings',         'Global platform configuration'),
  ('hq.platform.workflows.view',       'platform',  'Workflow Administration',   'Platform workflow definitions'),
  ('hq.platform.metadata.view',        'platform',  'Metadata Administration',   'Platform metadata and reference data'),
  ('hq.platform.audit.view',           'platform',  'Global Audit Centre',       'Platform-plane audit only. NOT practice_audit_event, whose payloads carry clinical content. See migration 266.'),
  ('hq.practice.operations.view',      'practice',  'Practice Product Ops',      'Competen Practice pilot gate and product operations'),
  ('hq.learning.competencies.view',    'learning',  'Competency Library',        'Master competency library'),
  ('hq.learning.content.view',         'learning',  'Content and Frameworks',    'Frameworks, content authoring and import'),
  ('hq.learning.studio.view',          'learning',  'Competency Studio',         'Authoring and assessment studio'),
  ('hq.learning.delivery.view',        'learning',  'Delivery Platform',         'Competency delivery runtime'),
  ('hq.learning.knowledge.view',       'learning',  'Knowledge Platform',        'Clinical knowledge platform and knowledge graph'),
  ('hq.learning.assessment.view',      'learning',  'Assessment Methods',        'Assessment methods and scoring models'),
  ('hq.learning.schedules.view',       'learning',  'Schedules',                 'Platform assessment schedules'),
  ('hq.learning.import.view',          'learning',  'Content Import',            'Bulk content import'),
  ('hq.quality.assurance.view',        'quality',   'Assurance Platform',        'Competency assurance platform'),
  ('hq.quality.intelligence.view',     'quality',   'Quality Intelligence',      'Quality intelligence engine'),
  ('hq.quality.governance.view',       'quality',   'Governance and Compliance', 'Governance, compliance and committees'),
  ('hq.quality.regulation.view',       'quality',   'Governance and Regulation', 'Competency governance and regulation'),
  ('hq.quality.policy.view',           'quality',   'Policy Manager',            'Platform policy management')
on conflict (code) do nothing;

-- 9. Six seed positions. Two of them share the Executive space and differ ONLY by their grants, which is
--    the decision this whole model exists to express.
insert into hq_position (code, space, name, description) values
  ('chief_executive',           'executive', 'Chief Executive',            'Full Executive space'),
  ('chief_financial_officer',   'executive', 'Chief Financial Officer',    'Executive space, reporting and performance only. Same space as the CEO, different grants'),
  ('platform_director',         'platform',  'Platform Director',          'Full Platform space'),
  ('practice_product_director', 'practice',  'Practice Product Director',  'Competen Practice product operations'),
  ('learning_product_director', 'learning',  'Learning Product Director',  'Full Learning space'),
  ('quality_council_member',    'quality',   'Quality Council Member',     'Full Quality space')
on conflict (code) do nothing;

-- 10. Grants. Every position gets hq.platform.home.view so an appointed person can always reach the HQ
--     landing page -- a position that can sign in and see nothing at all is a support ticket, not a control.
insert into hq_position_capability (position_code, capability_code, source) values
  ('chief_executive',           'hq.platform.home.view',            'position_default'),
  ('chief_executive',           'hq.executive.command_centre.view', 'position_default'),
  ('chief_executive',           'hq.executive.priorities.view',     'position_default'),
  ('chief_executive',           'hq.executive.reports.view',        'position_default'),
  ('chief_executive',           'hq.executive.performance.view',    'position_default'),
  ('chief_executive',           'hq.executive.enterprise.view',     'position_default'),
  ('chief_financial_officer',   'hq.platform.home.view',            'position_default'),
  ('chief_financial_officer',   'hq.executive.reports.view',        'position_default'),
  ('chief_financial_officer',   'hq.executive.performance.view',    'position_default'),
  ('chief_financial_officer',   'hq.executive.enterprise.view',     'position_default'),
  ('platform_director',         'hq.platform.home.view',            'position_default'),
  ('platform_director',         'hq.platform.ai.view',              'position_default'),
  ('platform_director',         'hq.platform.operations.view',      'position_default'),
  ('platform_director',         'hq.platform.system.view',          'position_default'),
  ('platform_director',         'hq.platform.users.view',           'position_default'),
  ('platform_director',         'hq.platform.tenants.view',         'position_default'),
  ('platform_director',         'hq.platform.settings.view',        'position_default'),
  ('platform_director',         'hq.platform.workflows.view',       'position_default'),
  ('platform_director',         'hq.platform.metadata.view',        'position_default'),
  ('platform_director',         'hq.platform.audit.view',           'position_default'),
  ('practice_product_director', 'hq.platform.home.view',            'position_default'),
  ('practice_product_director', 'hq.practice.operations.view',      'position_default'),
  ('learning_product_director', 'hq.platform.home.view',            'position_default'),
  ('learning_product_director', 'hq.learning.competencies.view',    'position_default'),
  ('learning_product_director', 'hq.learning.content.view',         'position_default'),
  ('learning_product_director', 'hq.learning.studio.view',          'position_default'),
  ('learning_product_director', 'hq.learning.delivery.view',        'position_default'),
  ('learning_product_director', 'hq.learning.knowledge.view',       'position_default'),
  ('learning_product_director', 'hq.learning.assessment.view',      'position_default'),
  ('learning_product_director', 'hq.learning.schedules.view',       'position_default'),
  ('learning_product_director', 'hq.learning.import.view',          'position_default'),
  ('quality_council_member',    'hq.platform.home.view',            'position_default'),
  ('quality_council_member',    'hq.quality.assurance.view',        'position_default'),
  ('quality_council_member',    'hq.quality.intelligence.view',     'position_default'),
  ('quality_council_member',    'hq.quality.governance.view',       'position_default'),
  ('quality_council_member',    'hq.quality.regulation.view',       'position_default'),
  ('quality_council_member',    'hq.quality.policy.view',           'position_default')
on conflict (position_code, capability_code) do nothing;

notify pgrst, 'reload schema';
