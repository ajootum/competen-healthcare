-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql and SQL function bodies between dollar quotes. A runner that
-- splits on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 890: UNIVERSAL ASSESSMENT ENGINE, CORE DEFINITIONS AND GOVERNANCE (Checklist Studio, slice S1a)
--
-- Owner-approved Checklist Studio (Option B plus the architectural amendment, 2 Nov 2026). Design of record:
-- the coordinator design for Assessment Studio Phase 1 (3 Nov 2026), sections 0, 2 and 5. Staging first.
-- Production needs its own owner GO and is applied by the owner by hand.
--
-- UNIVERSAL BY RULE. This file knows nothing about any profession, framework, learner or proficiency model.
-- Every domain notion (what a subject is, what a method is, what a purpose is, what an outcome is, what a
-- criterion maps to) is a row in a registry or a typed text value, never a column or a CHECK list. Product
-- adapters (a later migration) seed registry rows and own interpretation. The only references to a domain
-- authority are the call to the existing function competency_appointment_holds in the later capture migration
-- and the existing capability named in the review guard below. A harness strips comments and bans domain
-- words from this DDL.
--
-- DEPENDS ON 264 (hq_capability, hq_position, hq_position_capability), 281 (plat_product_line), 641
-- (individual_holds_capability), 640 (hq_sod_required_approvals), 013 (taxonomy_terms), 006 (organisations)
-- and profiles. APPLY BEFORE 891 and 892. Additive. Re-running it is a no-op. It appoints NOBODY and ends NO
-- grant.
--
-- WHAT IT ADDS.
--   1. Six capabilities in the quality space and five positions. NOBODY is appointed. No new exclusion pair:
--      independence is enforced per version and per decision in the database (the 640 approach).
--   2. Registries as rows: asmt_mapping_kind, asmt_method, asmt_purpose, asmt_instrument_family (with a code
--      counter and asmt_assign_catalogue_code, the shared master record contract with the catalogue
--      workstream). The core seeds none.
--   3. Definitions with owner and visibility columns: asmt_instrument, asmt_response_scale,
--      asmt_rule_template, asmt_layout_template. Each has versions with the same lifecycle columns.
--   4. Version content: groups, sections, items, extra fields of an item, mappings, allowed layouts, tags,
--      scale levels and scale states.
--   5. Governance: one generic lifecycle guard on every version table (draft, in_review, approved, published,
--      retired) with item level independence, a child freeze guard, a review decision independence guard,
--      an append-only event trail and review trail, and asmt_duplicate_version.
--
-- LIFECYCLE. draft -> in_review (only by an author or editor) -> approved (only when the independent approvals
-- on the CURRENT content hash reach hq_sod_required_approvals for the risk, nobody rejected, and the domain
-- review is done when required) -> published (only by a holder of the publish capability who never authored,
-- edited or submitted this or any earlier version of the same definition) -> retired. A published version is
-- frozen. Publishing version N retires version N-1. A change is a new draft made by asmt_duplicate_version.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last. RLS on every table, no policy here (service role only until a later policy says so).
--
-- ROLLBACK (staging): PENDING-39/ROLLBACK-890.sql
-- ====================================================================================================


-- ---- 1. capabilities and positions (nobody appointed) --------------------------------------------------

insert into hq_capability (code, space, label, description) values
  ('hq.assessment.studio.view', 'quality', 'Checklist Studio view',
   'See the Checklist Studio library, versions and history. Does not allow any change'),
  ('hq.assessment.instrument.author', 'quality', 'Checklist authoring',
   'Create, edit, duplicate and submit draft checklists, scales and templates. Never approves or publishes what the holder authored, edited or submitted'),
  ('hq.assessment.instrument.review', 'quality', 'Checklist review',
   'Record an independent review decision on a checklist version put forward for approval. Never on a version the holder authored, edited or submitted'),
  ('hq.assessment.instrument.publish', 'quality', 'Checklist publication',
   'Publish or retire an approved checklist, scale or template version. Never one the holder authored, edited or submitted'),
  ('hq.assessment.assessor.assign', 'quality', 'Assessor assignment',
   'Grant a named assessor the right to assess a named subject with a named checklist. Never to oneself and never for oneself'),
  ('hq.assessment.instrument.assess', 'quality', 'Checklist assessment',
   'Complete an assessment of another person or unit with a published checklist, where granted and accepted')
on conflict (code) do nothing;

insert into hq_position (code, space, name, description) values
  ('assessment_studio_author', 'quality', 'Checklist Studio Author',
   'Creates and edits draft checklists, scales and templates and puts them forward for review'),
  ('assessment_studio_reviewer', 'quality', 'Checklist Studio Reviewer',
   'Records independent review decisions on checklist versions put forward for approval'),
  ('assessment_studio_publisher', 'quality', 'Checklist Studio Publisher',
   'Publishes and retires approved checklist versions. Never one they authored, edited or submitted'),
  ('assessment_coordinator', 'quality', 'Assessment Coordinator',
   'Grants named assessors the right to assess named subjects with named checklists'),
  ('checklist_assessor', 'quality', 'Checklist Assessor',
   'Completes assessments of other people or units with published checklists, where a grant has been accepted')
on conflict (code) do nothing;

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values
  ('assessment_studio_author', 'hq.platform.home.view'),
  ('assessment_studio_author', 'hq.assessment.studio.view'),
  ('assessment_studio_author', 'hq.assessment.instrument.author'),
  ('assessment_studio_reviewer', 'hq.platform.home.view'),
  ('assessment_studio_reviewer', 'hq.assessment.studio.view'),
  ('assessment_studio_reviewer', 'hq.assessment.instrument.review'),
  ('assessment_studio_publisher', 'hq.platform.home.view'),
  ('assessment_studio_publisher', 'hq.assessment.studio.view'),
  ('assessment_studio_publisher', 'hq.assessment.instrument.publish'),
  ('assessment_coordinator', 'hq.platform.home.view'),
  ('assessment_coordinator', 'hq.assessment.studio.view'),
  ('assessment_coordinator', 'hq.assessment.assessor.assign'),
  ('checklist_assessor', 'hq.platform.home.view'),
  ('checklist_assessor', 'hq.assessment.instrument.assess')
) as c(position_code, code)
join (select code from hq_position) p on p.code = c.position_code
where exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code
  );


-- ---- 2. registries (rows, never CHECK lists) -----------------------------------------------------------

-- True when every element of the list matches the pattern. Used by CHECK constraints on text lists.
create or replace function public.asmt_all_match(p_values text[], p_pattern text)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select not exists (select 1 from unnest(p_values) v where v is null or v !~ p_pattern)
$$;

create table if not exists asmt_mapping_kind (
  code        text primary key,
  label       text not null,
  created_at  timestamptz not null default now(),
  constraint asmt_mapping_kind_code_check check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint asmt_mapping_kind_label_check check (btrim(label) <> '')
);
alter table asmt_mapping_kind enable row level security;

create table if not exists asmt_purpose (
  code        text primary key,
  label       text not null,
  publishable boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint asmt_purpose_code_check check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint asmt_purpose_label_check check (btrim(label) <> '')
);
alter table asmt_purpose enable row level security;

create table if not exists asmt_method (
  code              text primary key,
  label             text not null,
  owner_scope       text not null default 'holdings',
  owner_product_line text references plat_product_line(code),
  owner_organisation_id uuid references organisations(id),
  owner_user_id     uuid references profiles(id),
  owner_instrument_id uuid,
  visibility        text not null default 'adoptable',
  created_at        timestamptz not null default now(),
  constraint asmt_method_code_check check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint asmt_method_label_check check (btrim(label) <> ''),
  constraint asmt_method_visibility_check check (visibility in ('private', 'owner', 'adoptable')),
  constraint asmt_method_owner_check check (
    owner_scope in ('holdings', 'product', 'organisation', 'individual', 'instrument')
    and num_nonnulls(owner_product_line, owner_organisation_id, owner_user_id, owner_instrument_id) = case when owner_scope = 'holdings' then 0 else 1 end
    and (owner_scope = 'holdings'
         or (owner_scope = 'product' and owner_product_line is not null)
         or (owner_scope = 'organisation' and owner_organisation_id is not null)
         or (owner_scope = 'individual' and owner_user_id is not null)
         or (owner_scope = 'instrument' and owner_instrument_id is not null)))
);
alter table asmt_method enable row level security;


-- ---- 3. definitions: instrument, scale, rule template, layout template ----------------------------------

-- Catalogue families. Rows are configured in HQ. The core seeds none. The catalogue migration seeds its own.
create table if not exists asmt_instrument_family (
  code        text primary key,
  label       text not null,
  is_active   boolean not null default true,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  constraint asmt_instrument_family_code_check check (code ~ '^[A-Z]{1,6}$'),
  constraint asmt_instrument_family_label_check check (btrim(label) <> '')
);
alter table asmt_instrument_family enable row level security;

create table if not exists asmt_instrument_family_counter (
  family_code text primary key references asmt_instrument_family(code),
  next_no     int not null default 1,
  constraint asmt_instrument_family_counter_check check (next_no >= 1)
);
alter table asmt_instrument_family_counter enable row level security;

create table if not exists asmt_instrument (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  kind          text not null,
  family_code   text references asmt_instrument_family(code),
  description   text,
  owner_scope   text not null default 'holdings',
  owner_product_line text references plat_product_line(code),
  owner_organisation_id uuid references organisations(id),
  owner_user_id uuid references profiles(id),
  owner_instrument_id uuid references asmt_instrument(id),
  visibility    text not null default 'owner',
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint asmt_instrument_code_check check (code ~ '^[A-Z][A-Z0-9-]{2,40}$'),
  constraint asmt_instrument_name_check check (btrim(name) <> ''),
  constraint asmt_instrument_kind_check check (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint asmt_instrument_visibility_check check (visibility in ('private', 'owner', 'adoptable')),
  constraint asmt_instrument_owner_check check (
    owner_scope in ('holdings', 'product', 'organisation', 'individual')
    and num_nonnulls(owner_product_line, owner_organisation_id, owner_user_id, owner_instrument_id) = case when owner_scope = 'holdings' then 0 else 1 end
    and (owner_scope = 'holdings'
         or (owner_scope = 'product' and owner_product_line is not null)
         or (owner_scope = 'organisation' and owner_organisation_id is not null)
         or (owner_scope = 'individual' and owner_user_id is not null)))
);
alter table asmt_instrument enable row level security;

create table if not exists asmt_response_scale (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  owner_scope   text not null default 'holdings',
  owner_product_line text references plat_product_line(code),
  owner_organisation_id uuid references organisations(id),
  owner_user_id uuid references profiles(id),
  owner_instrument_id uuid references asmt_instrument(id),
  visibility    text not null default 'owner',
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint asmt_response_scale_code_check check (code ~ '^[A-Z][A-Z0-9-]{2,40}$'),
  constraint asmt_response_scale_name_check check (btrim(name) <> ''),
  constraint asmt_response_scale_visibility_check check (visibility in ('private', 'owner', 'adoptable')),
  constraint asmt_response_scale_owner_check check (
    owner_scope in ('holdings', 'product', 'organisation', 'individual', 'instrument')
    and num_nonnulls(owner_product_line, owner_organisation_id, owner_user_id, owner_instrument_id) = case when owner_scope = 'holdings' then 0 else 1 end
    and (owner_scope = 'holdings'
         or (owner_scope = 'product' and owner_product_line is not null)
         or (owner_scope = 'organisation' and owner_organisation_id is not null)
         or (owner_scope = 'individual' and owner_user_id is not null)
         or (owner_scope = 'instrument' and owner_instrument_id is not null)))
);
alter table asmt_response_scale enable row level security;

create table if not exists asmt_rule_template (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  owner_scope   text not null default 'holdings',
  owner_product_line text references plat_product_line(code),
  owner_organisation_id uuid references organisations(id),
  owner_user_id uuid references profiles(id),
  owner_instrument_id uuid references asmt_instrument(id),
  visibility    text not null default 'owner',
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint asmt_rule_template_code_check check (code ~ '^[A-Z][A-Z0-9-]{2,40}$'),
  constraint asmt_rule_template_name_check check (btrim(name) <> ''),
  constraint asmt_rule_template_visibility_check check (visibility in ('private', 'owner', 'adoptable')),
  constraint asmt_rule_template_owner_check check (
    owner_scope in ('holdings', 'product', 'organisation', 'individual', 'instrument')
    and num_nonnulls(owner_product_line, owner_organisation_id, owner_user_id, owner_instrument_id) = case when owner_scope = 'holdings' then 0 else 1 end
    and (owner_scope = 'holdings'
         or (owner_scope = 'product' and owner_product_line is not null)
         or (owner_scope = 'organisation' and owner_organisation_id is not null)
         or (owner_scope = 'individual' and owner_user_id is not null)
         or (owner_scope = 'instrument' and owner_instrument_id is not null)))
);
alter table asmt_rule_template enable row level security;

create table if not exists asmt_layout_template (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  owner_scope   text not null default 'holdings',
  owner_product_line text references plat_product_line(code),
  owner_organisation_id uuid references organisations(id),
  owner_user_id uuid references profiles(id),
  owner_instrument_id uuid references asmt_instrument(id),
  visibility    text not null default 'owner',
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint asmt_layout_template_code_check check (code ~ '^[A-Z][A-Z0-9-]{2,40}$'),
  constraint asmt_layout_template_name_check check (btrim(name) <> ''),
  constraint asmt_layout_template_visibility_check check (visibility in ('private', 'owner', 'adoptable')),
  constraint asmt_layout_template_owner_check check (
    owner_scope in ('holdings', 'product', 'organisation', 'individual', 'instrument')
    and num_nonnulls(owner_product_line, owner_organisation_id, owner_user_id, owner_instrument_id) = case when owner_scope = 'holdings' then 0 else 1 end
    and (owner_scope = 'holdings'
         or (owner_scope = 'product' and owner_product_line is not null)
         or (owner_scope = 'organisation' and owner_organisation_id is not null)
         or (owner_scope = 'individual' and owner_user_id is not null)
         or (owner_scope = 'instrument' and owner_instrument_id is not null)))
);
alter table asmt_layout_template enable row level security;


-- ---- 4. the append-only trails (events and review decisions) ---------------------------------------------

create table if not exists asmt_definition_event (
  id             uuid primary key default gen_random_uuid(),
  subject_table  text not null,
  subject_id     uuid not null,
  event          text not null,
  actor_id       uuid,
  appointment_id uuid,
  reason         text,
  content_hash   text,
  detail         jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  constraint asmt_definition_event_table_check check (subject_table ~ '^asmt_[a-z_]{3,60}$'),
  constraint asmt_definition_event_event_check check (event ~ '^[a-z][a-z_]{2,40}$'),
  constraint asmt_definition_event_detail_check check (jsonb_typeof(detail) = 'object')
);
create index if not exists idx_asmt_definition_event_subject on asmt_definition_event (subject_table, subject_id, created_at);
alter table asmt_definition_event enable row level security;

create table if not exists asmt_review_decision (
  id             uuid primary key default gen_random_uuid(),
  version_table  text not null,
  version_id     uuid not null,
  review_kind    text not null,
  reviewer_id    uuid not null,
  appointment_id uuid,
  decision       text not null,
  content_hash   text not null,
  rationale      text,
  created_at     timestamptz not null default now(),
  constraint asmt_review_decision_table_check check (version_table in (
    'asmt_instrument_version', 'asmt_response_scale_version', 'asmt_rule_template_version',
    'asmt_layout_template_version', 'asmt_progression_rule_version')),
  constraint asmt_review_decision_kind_check check (review_kind in ('governance', 'domain')),
  constraint asmt_review_decision_decision_check check (decision in ('approved', 'rejected', 'changes_requested')),
  constraint asmt_review_decision_rationale_check check (decision = 'approved' or char_length(btrim(coalesce(rationale, ''))) between 3 and 4000)
);
create unique index if not exists ux_asmt_review_decision_once
  on asmt_review_decision (version_table, version_id, review_kind, reviewer_id, content_hash);
create index if not exists idx_asmt_review_decision_version on asmt_review_decision (version_table, version_id);
alter table asmt_review_decision enable row level security;


-- ---- 5. versions: response scale, rule template, layout template ------------------------------------------

create table if not exists asmt_response_scale_version (
  id            uuid primary key default gen_random_uuid(),
  scale_id      uuid not null references asmt_response_scale(id),
  version_no    int not null,
  state         text not null default 'draft',
  content_hash  text,
  authored_by   uuid[] not null,
  edited_by     uuid[] not null default '{}',
  last_edited_by uuid,
  submitted_by  uuid,
  submitted_at  timestamptz,
  published_by  uuid,
  published_at  timestamptz,
  retired_by    uuid,
  retired_at    timestamptz,
  duplicated_from_version_id uuid,
  adopted_from_version_id uuid,
  created_at    timestamptz not null default now(),
  scale_kind    text not null default 'rating',
  source_kind   text,
  source_ref    uuid,
  description   text,
  unique (scale_id, version_no),
  constraint asmt_response_scale_version_life_check check (
    state in ('draft', 'in_review', 'approved', 'published', 'retired')
    and cardinality(authored_by) >= 1
    and version_no >= 1
    and (state = 'draft' or (submitted_by is not null and content_hash is not null))
    and (state not in ('published', 'retired') or (published_by is not null and published_at is not null))
    and (state in ('published', 'retired') or (published_by is null and published_at is null))
    and (state <> 'retired' or (retired_by is not null and retired_at is not null))
    and (state = 'retired' or (retired_by is null and retired_at is null))),
  constraint asmt_response_scale_version_kind_check check (scale_kind in ('rating', 'stage')),
  constraint asmt_response_scale_version_source_check check (source_kind is null or source_kind ~ '^[a-z][a-z0-9_]{1,40}$')
);
alter table asmt_response_scale_version enable row level security;

create table if not exists asmt_rule_template_version (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references asmt_rule_template(id),
  version_no    int not null,
  state         text not null default 'draft',
  content_hash  text,
  authored_by   uuid[] not null,
  edited_by     uuid[] not null default '{}',
  last_edited_by uuid,
  submitted_by  uuid,
  submitted_at  timestamptz,
  published_by  uuid,
  published_at  timestamptz,
  retired_by    uuid,
  retired_at    timestamptz,
  duplicated_from_version_id uuid,
  adopted_from_version_id uuid,
  created_at    timestamptz not null default now(),
  rules         jsonb not null default '{}',
  rules_hash    text,
  tests         jsonb not null default '[]',
  description   text,
  unique (template_id, version_no),
  constraint asmt_rule_template_version_life_check check (
    state in ('draft', 'in_review', 'approved', 'published', 'retired')
    and cardinality(authored_by) >= 1
    and version_no >= 1
    and (state = 'draft' or (submitted_by is not null and content_hash is not null))
    and (state not in ('published', 'retired') or (published_by is not null and published_at is not null))
    and (state in ('published', 'retired') or (published_by is null and published_at is null))
    and (state <> 'retired' or (retired_by is not null and retired_at is not null))
    and (state = 'retired' or (retired_by is null and retired_at is null))),
  constraint asmt_rule_template_version_shape_check check (jsonb_typeof(rules) = 'object' and jsonb_typeof(tests) = 'array')
);
alter table asmt_rule_template_version enable row level security;

create table if not exists asmt_layout_template_version (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references asmt_layout_template(id),
  version_no    int not null,
  state         text not null default 'draft',
  content_hash  text,
  authored_by   uuid[] not null,
  edited_by     uuid[] not null default '{}',
  last_edited_by uuid,
  submitted_by  uuid,
  submitted_at  timestamptz,
  published_by  uuid,
  published_at  timestamptz,
  retired_by    uuid,
  retired_at    timestamptz,
  duplicated_from_version_id uuid,
  adopted_from_version_id uuid,
  created_at    timestamptz not null default now(),
  presentation  text not null,
  layout        jsonb not null default '{}',
  description   text,
  unique (template_id, version_no),
  constraint asmt_layout_template_version_life_check check (
    state in ('draft', 'in_review', 'approved', 'published', 'retired')
    and cardinality(authored_by) >= 1
    and version_no >= 1
    and (state = 'draft' or (submitted_by is not null and content_hash is not null))
    and (state not in ('published', 'retired') or (published_by is not null and published_at is not null))
    and (state in ('published', 'retired') or (published_by is null and published_at is null))
    and (state <> 'retired' or (retired_by is not null and retired_at is not null))
    and (state = 'retired' or (retired_by is null and retired_at is null))),
  constraint asmt_layout_template_version_presentation_check check (presentation in (
    'standard_checklist', 'guided_assessment', 'audit_inspection', 'assessment_form', 'matrix')),
  constraint asmt_layout_template_version_shape_check check (jsonb_typeof(layout) = 'object')
);
alter table asmt_layout_template_version enable row level security;


-- ---- 6. the instrument version and its content -------------------------------------------------------------

create table if not exists asmt_instrument_version (
  id            uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references asmt_instrument(id),
  version_no    int not null,
  state         text not null default 'draft',
  content_hash  text,
  authored_by   uuid[] not null,
  edited_by     uuid[] not null default '{}',
  last_edited_by uuid,
  submitted_by  uuid,
  submitted_at  timestamptz,
  published_by  uuid,
  published_at  timestamptz,
  retired_by    uuid,
  retired_at    timestamptz,
  duplicated_from_version_id uuid,
  adopted_from_version_id uuid,
  created_at    timestamptz not null default now(),
  title         text,
  summary       text,
  purpose_code  text not null references asmt_purpose(code),
  method_codes  text[] not null default '{}',
  requires_domain_review boolean not null default false,
  risk          text not null default 'standard',
  scoring       jsonb not null default '{}',
  scoring_hash  text,
  scoring_template_version_id uuid references asmt_rule_template_version(id),
  scoring_tests jsonb not null default '[]',
  default_layout_version_id uuid references asmt_layout_template_version(id),
  assess_capability text references hq_capability(code),
  assign_capability text references hq_capability(code),
  respondent_roles text[] not null default '{self}',
  delivery_modes text[] not null default '{}',
  evidence_policy jsonb not null default '{}',
  effective_from date,
  review_due    date,
  unique (instrument_id, version_no),
  unique (id, instrument_id),
  constraint asmt_instrument_version_life_check check (
    state in ('draft', 'in_review', 'approved', 'published', 'retired')
    and cardinality(authored_by) >= 1
    and version_no >= 1
    and (state = 'draft' or (submitted_by is not null and content_hash is not null))
    and (state not in ('published', 'retired') or (published_by is not null and published_at is not null))
    and (state in ('published', 'retired') or (published_by is null and published_at is null))
    and (state <> 'retired' or (retired_by is not null and retired_at is not null))
    and (state = 'retired' or (retired_by is null and retired_at is null))),
  constraint asmt_instrument_version_risk_check check (risk in ('standard', 'high')),
  constraint asmt_instrument_version_roles_check check (
    cardinality(respondent_roles) >= 1 and respondent_roles <@ array['self', 'assessor', 'auditor']),
  constraint asmt_instrument_version_modes_check check (public.asmt_all_match(delivery_modes, '^[a-z_]{3,40}$')),
  constraint asmt_instrument_version_json_check check (
    jsonb_typeof(scoring) = 'object' and jsonb_typeof(scoring_tests) = 'array' and jsonb_typeof(evidence_policy) = 'object')
);
create index if not exists idx_asmt_instrument_version_instrument on asmt_instrument_version (instrument_id, state);
alter table asmt_instrument_version enable row level security;

create table if not exists asmt_group (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references asmt_instrument_version(id) on delete cascade,
  code        text not null,
  label       text not null,
  weight      numeric not null default 1,
  position    int not null default 0,
  source_ref  text,
  updated_by  uuid,
  unique (version_id, code),
  constraint asmt_group_code_check check (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,40}$'),
  constraint asmt_group_label_check check (btrim(label) <> ''),
  constraint asmt_group_weight_check check (weight >= 0)
);
alter table asmt_group enable row level security;

create table if not exists asmt_section (
  id                uuid primary key default gen_random_uuid(),
  version_id        uuid not null references asmt_instrument_version(id) on delete cascade,
  stable_key        uuid not null default gen_random_uuid(),
  parent_section_id uuid,
  title             text not null,
  guidance          text,
  weight            numeric not null default 1,
  position          int not null default 0,
  updated_by        uuid,
  unique (version_id, stable_key),
  unique (id, version_id),
  foreign key (parent_section_id, version_id) references asmt_section (id, version_id),
  constraint asmt_section_title_check check (btrim(title) <> ''),
  constraint asmt_section_weight_check check (weight >= 0)
);
alter table asmt_section enable row level security;

create table if not exists asmt_item (
  id              uuid primary key default gen_random_uuid(),
  version_id      uuid not null references asmt_instrument_version(id) on delete cascade,
  section_id      uuid,
  stable_key      uuid not null default gen_random_uuid(),
  code            text,
  prompt          text not null,
  guidance        text,
  expected_performance jsonb not null default '[]',
  response_type   text not null,
  scale_version_id uuid references asmt_response_scale_version(id),
  config          jsonb not null default '{}',
  group_code      text,
  method_codes    text[] not null default '{}',
  method_rule     text not null default 'any',
  mandatory       boolean not null default false,
  critical        boolean not null default false,
  critical_requirements text[] not null default '{}',
  evidence_requirement jsonb not null default '{}',
  weight          numeric not null default 1,
  references_text text,
  position        int not null default 0,
  updated_by      uuid,
  unique (version_id, stable_key),
  unique (id, version_id),
  foreign key (section_id, version_id) references asmt_section (id, version_id),
  foreign key (version_id, group_code) references asmt_group (version_id, code),
  constraint asmt_item_prompt_check check (btrim(prompt) <> ''),
  constraint asmt_item_type_check check (response_type in (
    'rating_scale', 'yes_no', 'pass_fail', 'achieved', 'numeric_rating', 'multiple_choice',
    'free_text', 'datetime', 'measurement', 'na', 'evidence')),
  constraint asmt_item_scale_check check ((response_type = 'rating_scale') = (scale_version_id is not null)),
  constraint asmt_item_method_rule_check check (method_rule in ('any', 'all')),
  constraint asmt_item_critical_check check (not critical or mandatory),
  constraint asmt_item_critical_requirements_check check (
    critical_requirements <@ array['must_be_satisfactory', 'must_be_observed', 'auto_fail', 'reassess']
    and (critical or critical_requirements = '{}')),
  constraint asmt_item_json_check check (
    jsonb_typeof(config) = 'object' and jsonb_typeof(expected_performance) = 'array' and jsonb_typeof(evidence_requirement) = 'object'),
  constraint asmt_item_weight_check check (weight >= 0)
);
create index if not exists idx_asmt_item_version on asmt_item (version_id, position);
alter table asmt_item enable row level security;

-- Extra fields of an item. The item response_type is the PRIMARY scored field. These capture findings,
-- notes, reasons and secondary values that an item needs beside it. They are never scored by the database.
create table if not exists asmt_item_field (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references asmt_instrument_version(id) on delete cascade,
  item_id       uuid not null,
  field_key     text not null,
  label         text not null,
  response_type text not null,
  scale_version_id uuid references asmt_response_scale_version(id),
  config        jsonb not null default '{}',
  required      boolean not null default false,
  position      int not null default 0,
  updated_by    uuid,
  unique (item_id, field_key),
  foreign key (item_id, version_id) references asmt_item (id, version_id) on delete cascade,
  constraint asmt_item_field_key_check check (field_key ~ '^[a-z][a-z0-9_]{1,40}$' and field_key <> 'primary'),
  constraint asmt_item_field_label_check check (btrim(label) <> ''),
  constraint asmt_item_field_type_check check (response_type in (
    'rating_scale', 'yes_no', 'pass_fail', 'achieved', 'numeric_rating', 'multiple_choice',
    'free_text', 'datetime', 'measurement', 'na', 'evidence')),
  constraint asmt_item_field_scale_check check ((response_type = 'rating_scale') = (scale_version_id is not null)),
  constraint asmt_item_field_json_check check (jsonb_typeof(config) = 'object')
);
alter table asmt_item_field enable row level security;

create table if not exists asmt_mapping (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references asmt_instrument_version(id) on delete cascade,
  item_id       uuid,
  section_id    uuid,
  kind          text not null references asmt_mapping_kind(code),
  ref_id        uuid,
  ref_code      text,
  ref_version   text,
  ref_hash      text,
  ref_snapshot  jsonb not null default '{}',
  relation      text not null default 'assesses',
  updated_by    uuid,
  foreign key (item_id, version_id) references asmt_item (id, version_id) on delete cascade,
  foreign key (section_id, version_id) references asmt_section (id, version_id) on delete cascade,
  constraint asmt_mapping_relation_check check (relation in ('assesses', 'derived_from', 'references')),
  constraint asmt_mapping_snapshot_check check (jsonb_typeof(ref_snapshot) = 'object'),
  constraint asmt_mapping_target_check check (item_id is null or section_id is null)
);
create index if not exists idx_asmt_mapping_version on asmt_mapping (version_id);
create index if not exists idx_asmt_mapping_ref on asmt_mapping (kind, ref_id);
alter table asmt_mapping enable row level security;

create table if not exists asmt_version_layout (
  version_id        uuid not null references asmt_instrument_version(id) on delete cascade,
  layout_version_id uuid not null references asmt_layout_template_version(id),
  updated_by        uuid,
  primary key (version_id, layout_version_id)
);
alter table asmt_version_layout enable row level security;

create table if not exists asmt_version_tag (
  version_id  uuid not null references asmt_instrument_version(id) on delete cascade,
  term_id     uuid not null references taxonomy_terms(id),
  updated_by  uuid,
  primary key (version_id, term_id)
);
alter table asmt_version_tag enable row level security;

create table if not exists asmt_response_scale_level (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references asmt_response_scale_version(id) on delete cascade,
  code          text not null,
  label         text not null,
  description   text,
  ordinal       int not null,
  numeric_value numeric,
  satisfactory  boolean,
  colour_token  text,
  source_level_id uuid,
  updated_by    uuid,
  unique (version_id, code),
  unique (version_id, ordinal),
  constraint asmt_response_scale_level_code_check check (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,40}$'),
  constraint asmt_response_scale_level_label_check check (btrim(label) <> '')
);
alter table asmt_response_scale_level enable row level security;

-- Absence is a state, never a level. A scale may offer any of these.
create table if not exists asmt_response_scale_state (
  version_id  uuid not null references asmt_response_scale_version(id) on delete cascade,
  state       text not null,
  label       text not null,
  updated_by  uuid,
  primary key (version_id, state),
  constraint asmt_response_scale_state_check check (state in (
    'not_assessed', 'not_observed', 'not_applicable', 'unable_to_demonstrate', 'unable_to_determine')),
  constraint asmt_response_scale_state_label_check check (btrim(label) <> '')
);
alter table asmt_response_scale_state enable row level security;


-- ---- 7. helper functions ---------------------------------------------------------------------------------

create or replace function public.asmt_version_parent_col(p_table text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case p_table
    when 'asmt_instrument_version' then 'instrument_id'
    when 'asmt_response_scale_version' then 'scale_id'
    when 'asmt_rule_template_version' then 'template_id'
    when 'asmt_layout_template_version' then 'template_id'
    when 'asmt_progression_rule_version' then 'rule_set_id'
    else null end
$$;

create or replace function public.asmt_jsonb_pick(p_json jsonb, p_keys text[])
returns jsonb
language sql
immutable
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_object_agg(k, p_json -> k), '{}'::jsonb) from unnest(p_keys) as k
$$;

-- Everyone who authored, edited or submitted this version or ANY version of the same definition.
create or replace function public.asmt_version_people(p_table text, p_id uuid)
returns uuid[]
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_pcol text := public.asmt_version_parent_col(p_table);
  v_res uuid[];
begin
  if v_pcol is null then
    raise exception 'asmt_version_people: % is not a version table', p_table;
  end if;
  execute format($f$
    with vs as (
      select id, authored_by, edited_by, submitted_by from %1$I
       where %2$I = (select %2$I from %1$I where id = $1))
    select coalesce(array_agg(distinct x), '{}'::uuid[]) from (
      select unnest(authored_by || edited_by) as x from vs
      union all select submitted_by from vs
      union all select e.actor_id from asmt_definition_event e
       where e.subject_table = $2 and e.subject_id in (select id from vs)
         and e.event in ('created', 'duplicated', 'submitted')
    ) s where x is not null$f$, p_table, v_pcol)
    into v_res using p_id, p_table;
  return coalesce(v_res, '{}'::uuid[]);
end;
$$;

-- The hash that approvals attach to. Computed when a version is put forward for review. The content is
-- frozen from then on, so the hash cannot drift.
create or replace function public.asmt_version_content_hash(p_table text, p_id uuid, p_row jsonb)
returns text
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_body jsonb := p_row - array['id', 'created_at', 'version_no', 'state', 'content_hash', 'authored_by', 'edited_by',
    'last_edited_by', 'submitted_by', 'submitted_at', 'published_by', 'published_at', 'retired_by', 'retired_at',
    'duplicated_from_version_id', 'adopted_from_version_id'];
  v_children jsonb := '{}'::jsonb;
begin
  if p_table = 'asmt_instrument_version' then
    v_children := jsonb_build_object(
      'groups', (select coalesce(jsonb_agg(to_jsonb(x) - 'updated_by' order by x.id), '[]'::jsonb) from asmt_group x where x.version_id = p_id),
      'sections', (select coalesce(jsonb_agg(to_jsonb(x) - 'updated_by' order by x.id), '[]'::jsonb) from asmt_section x where x.version_id = p_id),
      'items', (select coalesce(jsonb_agg(to_jsonb(x) - 'updated_by' order by x.id), '[]'::jsonb) from asmt_item x where x.version_id = p_id),
      'fields', (select coalesce(jsonb_agg(to_jsonb(x) - 'updated_by' order by x.id), '[]'::jsonb) from asmt_item_field x where x.version_id = p_id),
      'mappings', (select coalesce(jsonb_agg(to_jsonb(x) - 'updated_by' order by x.id), '[]'::jsonb) from asmt_mapping x where x.version_id = p_id),
      'layouts', (select coalesce(jsonb_agg(x.layout_version_id order by x.layout_version_id), '[]'::jsonb) from asmt_version_layout x where x.version_id = p_id),
      'tags', (select coalesce(jsonb_agg(x.term_id order by x.term_id), '[]'::jsonb) from asmt_version_tag x where x.version_id = p_id));
  elsif p_table = 'asmt_response_scale_version' then
    v_children := jsonb_build_object(
      'levels', (select coalesce(jsonb_agg(to_jsonb(x) - 'updated_by' order by x.id), '[]'::jsonb) from asmt_response_scale_level x where x.version_id = p_id),
      'states', (select coalesce(jsonb_agg(to_jsonb(x) - 'updated_by' order by x.state), '[]'::jsonb) from asmt_response_scale_state x where x.version_id = p_id));
  end if;
  return encode(sha256(convert_to((v_body || jsonb_build_object('children', v_children))::text, 'UTF8')), 'hex');
end;
$$;

-- Problems with the config of an item or an item field, or null when it is sound.
create or replace function public.asmt_field_config_problem(p_type text, p_config jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  v_opt jsonb;
  v_codes text[] := '{}';
  v_code text;
  v_credit text;
  v_state text;
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    return 'config must be an object';
  end if;
  if p_config ? 'allowedStates' then
    if jsonb_typeof(p_config -> 'allowedStates') <> 'array' then return 'allowedStates must be a list'; end if;
    for v_state in select jsonb_array_elements_text(p_config -> 'allowedStates') loop
      if v_state not in ('not_assessed', 'not_observed', 'not_applicable', 'unable_to_demonstrate', 'unable_to_determine') then
        return 'allowedStates has an unknown state ' || v_state;
      end if;
    end loop;
  end if;
  if p_config ? 'naReasonRequired' and jsonb_typeof(p_config -> 'naReasonRequired') <> 'boolean' then
    return 'naReasonRequired must be true or false';
  end if;
  if p_config ? 'stateLabels' and jsonb_typeof(p_config -> 'stateLabels') <> 'object' then
    return 'stateLabels must be an object';
  end if;
  if p_type = 'multiple_choice' then
    if jsonb_typeof(p_config -> 'options') is distinct from 'array' or jsonb_array_length(p_config -> 'options') < 1 then
      return 'multiple_choice needs a non-empty options list';
    end if;
    if coalesce(p_config ->> 'select', 'single') not in ('single', 'multi') then
      return 'select must be single or multi';
    end if;
    for v_opt in select jsonb_array_elements(p_config -> 'options') loop
      if jsonb_typeof(v_opt) <> 'object' then return 'each option must be an object'; end if;
      v_code := v_opt ->> 'code';
      if v_code is null or v_code !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,40}$' then return 'each option needs a code'; end if;
      if v_code = any(v_codes) then return 'option code ' || v_code || ' is repeated'; end if;
      v_codes := v_codes || v_code;
      if btrim(coalesce(v_opt ->> 'label', '')) = '' then return 'option ' || v_code || ' needs a label'; end if;
      if v_opt ? 'satisfactory' and jsonb_typeof(v_opt -> 'satisfactory') not in ('boolean', 'null') then
        return 'option ' || v_code || ' satisfactory must be true, false or null';
      end if;
      if v_opt ? 'credit' and jsonb_typeof(v_opt -> 'credit') <> 'null' then
        if jsonb_typeof(v_opt -> 'credit') <> 'number' then return 'option ' || v_code || ' credit must be a number'; end if;
        v_credit := v_opt ->> 'credit';
        if v_credit::numeric < 0 or v_credit::numeric > 1 then return 'option ' || v_code || ' credit must be between 0 and 1'; end if;
      end if;
    end loop;
  elsif p_type in ('numeric_rating', 'measurement') then
    if p_config ? 'min' and jsonb_typeof(p_config -> 'min') <> 'number' then return 'min must be a number'; end if;
    if p_config ? 'max' and jsonb_typeof(p_config -> 'max') <> 'number' then return 'max must be a number'; end if;
    if p_config ? 'min' and p_config ? 'max' and (p_config ->> 'min')::numeric > (p_config ->> 'max')::numeric then
      return 'min is above max';
    end if;
    if p_config ? 'satisfactoryMin' and jsonb_typeof(p_config -> 'satisfactoryMin') <> 'number' then return 'satisfactoryMin must be a number'; end if;
    if p_config ? 'satisfactoryMax' and jsonb_typeof(p_config -> 'satisfactoryMax') <> 'number' then return 'satisfactoryMax must be a number'; end if;
  elsif p_type = 'evidence' then
    if p_config ? 'minCount' and (jsonb_typeof(p_config -> 'minCount') <> 'number' or (p_config ->> 'minCount')::numeric < 0) then
      return 'minCount must be a number from zero';
    end if;
  elsif p_type = 'free_text' then
    if p_config ? 'maxLength' and (jsonb_typeof(p_config -> 'maxLength') <> 'number' or (p_config ->> 'maxLength')::numeric < 1) then
      return 'maxLength must be a positive number';
    end if;
  end if;
  return null;
end;
$$;


-- ---- 8. the generic lifecycle guard (dispatches on tg_table_name, modelled on 640 hq_sod_publication_guard) ----

create or replace function public.asmt_version_lifecycle_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_pcol text := public.asmt_version_parent_col(tg_table_name);
  v_life constant text[] := array['id', 'created_at', 'version_no', 'state', 'content_hash', 'authored_by', 'edited_by',
    'last_edited_by', 'submitted_by', 'submitted_at', 'published_by', 'published_at', 'retired_by', 'retired_at',
    'duplicated_from_version_id', 'adopted_from_version_id'];
  v_fixed constant text[] := array['id', 'created_at', 'version_no', 'state', 'content_hash', 'authored_by',
    'submitted_by', 'submitted_at', 'published_by', 'published_at', 'retired_by', 'retired_at',
    'duplicated_from_version_id', 'adopted_from_version_id'];
  v_publish constant text := 'hq.assessment.instrument.publish';
  v_new jsonb;
  v_old jsonb;
  v_allowed text[];
  v_no int;
  v_need int;
  v_n int;
  v_risk text;
begin
  if v_pcol is null then
    raise exception 'asmt lifecycle: % is not a version table', tg_table_name;
  end if;

  if tg_op = 'DELETE' then
    if old.state = 'draft' then
      return old;
    end if;
    raise exception '%: a % version is kept as history. Only a draft can be deleted', tg_table_name, old.state;
  end if;

  if tg_op = 'INSERT' then
    if new.state is distinct from 'draft' then
      raise exception '%: a new version always starts as a draft. Use asmt_duplicate_version to change a published one', tg_table_name;
    end if;
    if new.published_by is not null or new.retired_by is not null or new.submitted_by is not null or new.content_hash is not null then
      raise exception '%: a new draft cannot carry submission, publication or retirement', tg_table_name;
    end if;
    if new.version_no is null then
      execute format('select coalesce(max(version_no), 0) + 1 from %I where %I = $1', tg_table_name, v_pcol)
        into v_no using (to_jsonb(new) ->> v_pcol)::uuid;
      new.version_no := v_no;
    end if;
    new.edited_by := '{}';
    return new;
  end if;

  -- UPDATE
  v_new := to_jsonb(new);
  v_old := to_jsonb(old);

  if old.state = 'retired' then
    raise exception '%: a retired version is final and cannot change', tg_table_name;
  end if;

  if old.state = 'published' then
    if new.state is distinct from 'retired' then
      raise exception '%: a published version is frozen. The only change is retirement. Make a new draft with asmt_duplicate_version', tg_table_name;
    end if;
    if new.retired_by is null then
      raise exception '%: a retirement must record who retired it', tg_table_name;
    end if;
    new.retired_at := coalesce(new.retired_at, now());
    v_new := to_jsonb(new);
    if (v_new - array['state', 'retired_by', 'retired_at']) is distinct from (v_old - array['state', 'retired_by', 'retired_at']) then
      raise exception '%: a published version is frozen. Retirement changes nothing else', tg_table_name;
    end if;
    if not public.individual_holds_capability(new.retired_by, v_publish) then
      raise exception '%: not authorised. Retiring a version needs the publish capability', tg_table_name;
    end if;
    return new;
  end if;

  if old.state = 'draft' then
    if new.state = 'draft' then
      if public.asmt_jsonb_pick(v_new, v_fixed) is distinct from public.asmt_jsonb_pick(v_old, v_fixed) then
        raise exception '%: lifecycle columns of a draft change only by a transition', tg_table_name;
      end if;
      if not (new.edited_by @> old.edited_by) then
        raise exception '%: the list of editors only grows', tg_table_name;
      end if;
      if (v_new - v_life) is distinct from (v_old - v_life) then
        if new.last_edited_by is null then
          raise exception '%: an edit must name who edited (last_edited_by)', tg_table_name;
        end if;
        if not (new.last_edited_by = any(new.authored_by) or new.last_edited_by = any(new.edited_by)) then
          new.edited_by := new.edited_by || new.last_edited_by;
        end if;
      end if;
      return new;
    elsif new.state = 'in_review' then
      if new.submitted_by is null
         or not (new.submitted_by = any(new.authored_by) or new.submitted_by = any(new.edited_by)) then
        raise exception '%: only an author or editor of the draft can put it forward for review', tg_table_name;
      end if;
      if (v_new - v_life - 'risk') is distinct from (v_old - v_life - 'risk') then
        raise exception '%: content cannot change in the same step as submission', tg_table_name;
      end if;
      if tg_table_name = 'asmt_instrument_version' then
        if not exists (select 1 from asmt_purpose p where p.code = new.purpose_code and p.publishable) then
          raise exception '%: purpose % cannot be published', tg_table_name, new.purpose_code;
        end if;
        if cardinality(new.delivery_modes) = 0 then
          raise exception '%: a definition cannot be put forward without at least one delivery mode', tg_table_name;
        end if;
        if exists (select 1 from asmt_item i where i.version_id = new.id and i.critical) then
          new.risk := 'high';
        end if;
        if exists (
            select 1 from (
              select scale_version_id as sid from asmt_item where version_id = new.id and scale_version_id is not null
              union select scale_version_id from asmt_item_field where version_id = new.id and scale_version_id is not null) s
              join asmt_response_scale_version sv on sv.id = s.sid
             where sv.state <> 'published') then
          raise exception '%: every scale an item uses must be a published scale version', tg_table_name;
        end if;
      end if;
      new.submitted_at := now();
      new.content_hash := public.asmt_version_content_hash(tg_table_name, new.id, to_jsonb(new));
      v_allowed := array['state', 'content_hash', 'submitted_by', 'submitted_at', 'risk'];
    else
      raise exception '%: a draft can only be put forward for review', tg_table_name;
    end if;

  elsif old.state = 'in_review' then
    if new.state = 'draft' then
      if new.last_edited_by is null then
        raise exception '%: a return to draft must name who returned it (last_edited_by)', tg_table_name;
      end if;
      new.content_hash := null;
      v_allowed := array['state', 'content_hash', 'last_edited_by'];
    elsif new.state = 'approved' then
      v_risk := coalesce(v_old ->> 'risk', 'standard');
      v_need := public.hq_sod_required_approvals(v_risk);
      select count(distinct d.reviewer_id) into v_n from asmt_review_decision d
       where d.version_table = tg_table_name and d.version_id = old.id and d.review_kind = 'governance'
         and d.decision = 'approved' and d.content_hash = old.content_hash;
      if v_n < v_need then
        raise exception '%: not approved. It needs % independent governance approval(s) of this exact content and has %', tg_table_name, v_need, v_n;
      end if;
      if exists (select 1 from asmt_review_decision d
                  where d.version_table = tg_table_name and d.version_id = old.id
                    and d.content_hash = old.content_hash and d.decision <> 'approved') then
        raise exception '%: not approved. A reviewer rejected it or asked for changes on this exact content', tg_table_name;
      end if;
      if coalesce((v_old ->> 'requires_domain_review')::boolean, false) then
        select count(distinct d.reviewer_id) into v_n from asmt_review_decision d
         where d.version_table = tg_table_name and d.version_id = old.id and d.review_kind = 'domain'
           and d.decision = 'approved' and d.content_hash = old.content_hash;
        if v_n < v_need then
          raise exception '%: not approved. It needs % independent domain approval(s) of this exact content and has %', tg_table_name, v_need, v_n;
        end if;
      end if;
      v_allowed := array['state'];
    else
      raise exception '%: a version in review is approved or returned to draft', tg_table_name;
    end if;

  elsif old.state = 'approved' then
    if new.state = 'draft' then
      if new.last_edited_by is null then
        raise exception '%: a return to draft must name who returned it (last_edited_by)', tg_table_name;
      end if;
      new.content_hash := null;
      v_allowed := array['state', 'content_hash', 'last_edited_by'];
    elsif new.state = 'published' then
      if new.published_by is null then
        raise exception '%: a publication must record its publisher', tg_table_name;
      end if;
      if new.published_by = any(public.asmt_version_people(tg_table_name, old.id)) then
        raise exception '%: not independent. An author, editor or submitter of this version or any earlier version cannot publish it', tg_table_name;
      end if;
      if not public.individual_holds_capability(new.published_by, v_publish) then
        raise exception '%: not authorised. Publishing needs the publish capability', tg_table_name;
      end if;
      if tg_table_name = 'asmt_instrument_version' then
        if cardinality(new.delivery_modes) = 0 then
          raise exception '%: a definition cannot be published without at least one delivery mode', tg_table_name;
        end if;
      end if;
      new.published_at := now();
      v_allowed := array['state', 'published_by', 'published_at'];
    else
      raise exception '%: an approved version is published or returned to draft', tg_table_name;
    end if;
  end if;

  v_new := to_jsonb(new);
  if (v_new - v_allowed) is distinct from (v_old - v_allowed) then
    raise exception '%: a % version is frozen. This step changes nothing but its lifecycle columns', tg_table_name, old.state;
  end if;
  return new;
end;
$$;

-- Events and the retirement of the previous published version, after the row is written.
create or replace function public.asmt_version_after_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_pcol text := public.asmt_version_parent_col(tg_table_name);
  v_event text;
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    insert into asmt_definition_event (subject_table, subject_id, event, actor_id, content_hash)
    values (tg_table_name, new.id,
            case when new.duplicated_from_version_id is not null then 'duplicated' else 'created' end,
            new.authored_by[1], null);
    return null;
  end if;
  if new.state is distinct from old.state then
    if old.state = 'draft' and new.state = 'in_review' then
      v_event := 'submitted'; v_actor := new.submitted_by;
    elsif new.state = 'draft' then
      v_event := 'returned'; v_actor := new.last_edited_by;
    elsif new.state = 'approved' then
      v_event := 'approved'; v_actor := null;
    elsif new.state = 'published' then
      v_event := 'published'; v_actor := new.published_by;
    elsif new.state = 'retired' then
      v_event := 'retired'; v_actor := new.retired_by;
    end if;
    insert into asmt_definition_event (subject_table, subject_id, event, actor_id, content_hash)
    values (tg_table_name, new.id, v_event, v_actor, coalesce(new.content_hash, old.content_hash));
    if new.state = 'published' then
      execute format('update %1$I set state = ''retired'', retired_by = $2, retired_at = now() where %2$I = $1 and id <> $3 and state = ''published''',
                     tg_table_name, v_pcol)
        using (to_jsonb(new) ->> v_pcol)::uuid, new.published_by, new.id;
    end if;
  end if;
  return null;
end;
$$;

-- Item level independence of a review decision.
create or replace function public.asmt_review_decision_sod_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_state text;
  v_hash text;
  v_cap text;
begin
  execute format('select state, content_hash from %I where id = $1', new.version_table) into v_state, v_hash using new.version_id;
  if v_state is null then
    raise exception 'asmt_review_decision: that version does not exist';
  end if;
  if v_state <> 'in_review' then
    raise exception 'asmt_review_decision: a decision is recorded only while the version is in review (it is %)', v_state;
  end if;
  if new.content_hash is distinct from v_hash then
    raise exception 'asmt_review_decision: the decision must name the current content hash of the version';
  end if;
  if new.reviewer_id = any(public.asmt_version_people(new.version_table, new.version_id)) then
    raise exception 'asmt_review_decision: not independent. A reviewer never reviews a version they, or any earlier version of it, authored, edited or submitted';
  end if;
  v_cap := case new.review_kind when 'governance' then 'hq.assessment.instrument.review' else 'hq.quality.clinical.approve' end;
  if new.appointment_id is not null then
    if not public.competency_appointment_holds(new.appointment_id, new.reviewer_id, v_cap) then
      raise exception 'asmt_review_decision: the named appointment does not hold % for this reviewer', v_cap;
    end if;
  elsif not public.individual_holds_capability(new.reviewer_id, v_cap) then
    raise exception 'asmt_review_decision: not authorised. A % decision needs %', new.review_kind, v_cap;
  end if;
  return new;
end;
$$;

-- The shared append-only guard. A parent row stays deletable through the cascade allowance.
create or replace function public.asmt_append_only_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception '%: this trail is append-only. Add a new row instead', tg_table_name;
  end if;
  raise exception '%: this trail is append-only. Add a new row instead', tg_table_name;
end;
$$;

-- Content of a version is written only while its version is a draft.
create or replace function public.asmt_child_freeze_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_parent text := case tg_table_name
    when 'asmt_response_scale_level' then 'asmt_response_scale_version'
    when 'asmt_response_scale_state' then 'asmt_response_scale_version'
    else 'asmt_instrument_version' end;
  v_vid uuid;
  v_state text;
  v_editor uuid;
  v_row jsonb;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_vid := (v_row ->> 'version_id')::uuid;
  execute format('select state from %I where id = $1', v_parent) into v_state using v_vid;
  if v_state is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception '%: the version does not exist', tg_table_name;
  end if;
  if v_state <> 'draft' then
    raise exception '%: the version is % and its content is frozen. Make a new draft with asmt_duplicate_version', tg_table_name, v_state;
  end if;
  if tg_op = 'UPDATE' and new.version_id is distinct from old.version_id then
    raise exception '%: a row never moves to another version', tg_table_name;
  end if;
  if tg_op <> 'DELETE' then
    v_editor := (v_row ->> 'updated_by')::uuid;
    if v_editor is not null then
      execute format('update %I set last_edited_by = $2, edited_by = case when $2 = any(authored_by) or $2 = any(edited_by) then edited_by else edited_by || $2 end where id = $1 and not ($2 = any(authored_by) or $2 = any(edited_by))',
                     v_parent) using v_vid, v_editor;
    end if;
    return new;
  end if;
  return old;
end;
$$;

-- Method codes must be rows of the method registry.
create or replace function public.asmt_method_codes_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_codes text[] := coalesce(array(select jsonb_array_elements_text(to_jsonb(new) -> 'method_codes')), '{}');
  v_bad text;
begin
  select c into v_bad from unnest(v_codes) c where not exists (select 1 from asmt_method m where m.code = c) limit 1;
  if v_bad is not null then
    raise exception '%: method code % is not in the method registry', tg_table_name, v_bad;
  end if;
  return new;
end;
$$;

-- Item and item field sanity: config shape, group and scale rules.
create or replace function public.asmt_item_config_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_problem text := public.asmt_field_config_problem(new.response_type, new.config);
begin
  if v_problem is not null then
    raise exception '%: %', tg_table_name, v_problem;
  end if;
  if new.scale_version_id is not null and not exists (
       select 1 from asmt_response_scale_version sv where sv.id = new.scale_version_id and sv.scale_kind = 'rating') then
    raise exception '%: a rating scale item needs a rating scale version', tg_table_name;
  end if;
  return new;
end;
$$;

-- Identity, owner and kind of a definition never change. Name and visibility may.
create or replace function public.asmt_definition_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if (to_jsonb(new) - array['name', 'visibility', 'description', 'family_code'])
     is distinct from (to_jsonb(old) - array['name', 'visibility', 'description', 'family_code']) then
    raise exception '%: the code, owner and kind of a definition are permanent. Only the name, description and visibility can change', tg_table_name;
  end if;
  if tg_table_name = 'asmt_instrument' and old.family_code is not null and new.family_code is distinct from old.family_code then
    raise exception 'asmt_instrument: the family of a definition is permanent once set';
  end if;
  return new;
end;
$$;

-- Next catalogue code for a family. The caller sets asmt_instrument.code from it in the same transaction.
create or replace function public.asmt_assign_catalogue_code(p_family text)
returns text
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_no int;
begin
  if not exists (select 1 from asmt_instrument_family f where f.code = p_family and f.is_active) then
    raise exception 'asmt_assign_catalogue_code: family % does not exist or is not active', p_family;
  end if;
  insert into asmt_instrument_family_counter (family_code) values (p_family) on conflict (family_code) do nothing;
  select next_no into v_no from asmt_instrument_family_counter where family_code = p_family for update;
  update asmt_instrument_family_counter set next_no = v_no + 1 where family_code = p_family;
  return p_family || '-' || lpad(v_no::text, 6, '0');
end;
$$;

-- A new draft from any version, same stable keys, by an author.
create or replace function public.asmt_duplicate_version(p_version uuid, p_actor uuid)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_table text;
  v_row jsonb;
  v_new uuid := gen_random_uuid();
  v_t text;
begin
  if p_actor is null or not public.individual_holds_capability(p_actor, 'hq.assessment.instrument.author') then
    raise exception 'asmt_duplicate_version: not authorised. Duplicating needs the author capability';
  end if;
  foreach v_t in array array['asmt_instrument_version', 'asmt_response_scale_version', 'asmt_rule_template_version',
                             'asmt_layout_template_version', 'asmt_progression_rule_version'] loop
    if to_regclass('public.' || v_t) is not null then
      execute format('select to_jsonb(t) from %I t where id = $1', v_t) into v_row using p_version;
      if v_row is not null then
        v_table := v_t;
        exit;
      end if;
    end if;
  end loop;
  if v_table is null then
    raise exception 'asmt_duplicate_version: version % not found', p_version;
  end if;
  v_row := (v_row - array['content_hash', 'submitted_by', 'submitted_at', 'published_by', 'published_at', 'retired_by', 'retired_at',
                          'last_edited_by', 'version_no', 'adopted_from_version_id'])
           || jsonb_build_object('id', v_new, 'state', 'draft', 'authored_by', jsonb_build_array(p_actor),
                                 'edited_by', '[]'::jsonb, 'duplicated_from_version_id', p_version, 'created_at', now());
  execute format('insert into %1$I select (jsonb_populate_record(null::%1$I, $1)).*', v_table) using v_row;

  if v_table = 'asmt_instrument_version' then
    insert into asmt_group (version_id, code, label, weight, position, source_ref, updated_by)
      select v_new, code, label, weight, position, source_ref, p_actor from asmt_group where version_id = p_version;
    insert into asmt_section (version_id, stable_key, parent_section_id, title, guidance, weight, position, updated_by)
      select v_new, stable_key, null, title, guidance, weight, position, p_actor from asmt_section where version_id = p_version;
    update asmt_section n set parent_section_id = np.id
      from asmt_section o
      join asmt_section op on op.id = o.parent_section_id
      join asmt_section np on np.version_id = v_new and np.stable_key = op.stable_key
     where n.version_id = v_new and o.version_id = p_version and o.stable_key = n.stable_key and o.parent_section_id is not null;
    insert into asmt_item (version_id, section_id, stable_key, code, prompt, guidance, expected_performance, response_type,
                           scale_version_id, config, group_code, method_codes, method_rule, mandatory, critical,
                           critical_requirements, evidence_requirement, weight, references_text, position, updated_by)
      select v_new, ns.id, i.stable_key, i.code, i.prompt, i.guidance, i.expected_performance, i.response_type,
             i.scale_version_id, i.config, i.group_code, i.method_codes, i.method_rule, i.mandatory, i.critical,
             i.critical_requirements, i.evidence_requirement, i.weight, i.references_text, i.position, p_actor
        from asmt_item i
        left join asmt_section os on os.id = i.section_id
        left join asmt_section ns on ns.version_id = v_new and ns.stable_key = os.stable_key
       where i.version_id = p_version;
    insert into asmt_item_field (version_id, item_id, field_key, label, response_type, scale_version_id, config, required, position, updated_by)
      select v_new, ni.id, f.field_key, f.label, f.response_type, f.scale_version_id, f.config, f.required, f.position, p_actor
        from asmt_item_field f
        join asmt_item oi on oi.id = f.item_id
        join asmt_item ni on ni.version_id = v_new and ni.stable_key = oi.stable_key
       where f.version_id = p_version;
    insert into asmt_mapping (version_id, item_id, section_id, kind, ref_id, ref_code, ref_version, ref_hash, ref_snapshot, relation, updated_by)
      select v_new, ni.id, ns.id, m.kind, m.ref_id, m.ref_code, m.ref_version, m.ref_hash, m.ref_snapshot, m.relation, p_actor
        from asmt_mapping m
        left join asmt_item oi on oi.id = m.item_id
        left join asmt_item ni on ni.version_id = v_new and ni.stable_key = oi.stable_key
        left join asmt_section os on os.id = m.section_id
        left join asmt_section ns on ns.version_id = v_new and ns.stable_key = os.stable_key
       where m.version_id = p_version;
    insert into asmt_version_layout (version_id, layout_version_id, updated_by)
      select v_new, layout_version_id, p_actor from asmt_version_layout where version_id = p_version;
    insert into asmt_version_tag (version_id, term_id, updated_by)
      select v_new, term_id, p_actor from asmt_version_tag where version_id = p_version;
  elsif v_table = 'asmt_response_scale_version' then
    insert into asmt_response_scale_level (version_id, code, label, description, ordinal, numeric_value, satisfactory, colour_token, source_level_id, updated_by)
      select v_new, code, label, description, ordinal, numeric_value, satisfactory, colour_token, source_level_id, p_actor
        from asmt_response_scale_level where version_id = p_version;
    insert into asmt_response_scale_state (version_id, state, label, updated_by)
      select v_new, state, label, p_actor from asmt_response_scale_state where version_id = p_version;
  end if;
  return v_new;
end;
$$;

revoke all on function public.asmt_all_match(text[], text) from public, anon, authenticated;
grant execute on function public.asmt_all_match(text[], text) to service_role;
revoke all on function public.asmt_version_parent_col(text) from public, anon, authenticated;
revoke all on function public.asmt_jsonb_pick(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.asmt_version_people(text, uuid) from public, anon, authenticated;
revoke all on function public.asmt_version_content_hash(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.asmt_field_config_problem(text, jsonb) from public, anon, authenticated;
revoke all on function public.asmt_version_lifecycle_guard() from public, anon, authenticated;
revoke all on function public.asmt_version_after_guard() from public, anon, authenticated;
revoke all on function public.asmt_review_decision_sod_guard() from public, anon, authenticated;
revoke all on function public.asmt_append_only_guard() from public, anon, authenticated;
revoke all on function public.asmt_child_freeze_guard() from public, anon, authenticated;
revoke all on function public.asmt_method_codes_guard() from public, anon, authenticated;
revoke all on function public.asmt_item_config_guard() from public, anon, authenticated;
revoke all on function public.asmt_definition_guard() from public, anon, authenticated;
revoke all on function public.asmt_duplicate_version(uuid, uuid) from public, anon, authenticated;
revoke all on function public.asmt_assign_catalogue_code(text) from public, anon, authenticated;
grant execute on function public.asmt_assign_catalogue_code(text) to service_role;
grant execute on function public.asmt_version_parent_col(text) to service_role;
grant execute on function public.asmt_jsonb_pick(jsonb, text[]) to service_role;
grant execute on function public.asmt_version_people(text, uuid) to service_role;
grant execute on function public.asmt_version_content_hash(text, uuid, jsonb) to service_role;
grant execute on function public.asmt_field_config_problem(text, jsonb) to service_role;
grant execute on function public.asmt_duplicate_version(uuid, uuid) to service_role;


-- ---- 9. triggers -------------------------------------------------------------------------------------------

drop trigger if exists asmt_response_scale_version_lifecycle on asmt_response_scale_version;
create trigger asmt_response_scale_version_lifecycle
  before insert or update or delete on asmt_response_scale_version
  for each row execute function public.asmt_version_lifecycle_guard();
drop trigger if exists asmt_response_scale_version_after on asmt_response_scale_version;
create trigger asmt_response_scale_version_after
  after insert or update on asmt_response_scale_version
  for each row execute function public.asmt_version_after_guard();

drop trigger if exists asmt_rule_template_version_lifecycle on asmt_rule_template_version;
create trigger asmt_rule_template_version_lifecycle
  before insert or update or delete on asmt_rule_template_version
  for each row execute function public.asmt_version_lifecycle_guard();
drop trigger if exists asmt_rule_template_version_after on asmt_rule_template_version;
create trigger asmt_rule_template_version_after
  after insert or update on asmt_rule_template_version
  for each row execute function public.asmt_version_after_guard();

drop trigger if exists asmt_layout_template_version_lifecycle on asmt_layout_template_version;
create trigger asmt_layout_template_version_lifecycle
  before insert or update or delete on asmt_layout_template_version
  for each row execute function public.asmt_version_lifecycle_guard();
drop trigger if exists asmt_layout_template_version_after on asmt_layout_template_version;
create trigger asmt_layout_template_version_after
  after insert or update on asmt_layout_template_version
  for each row execute function public.asmt_version_after_guard();

drop trigger if exists asmt_instrument_version_lifecycle on asmt_instrument_version;
create trigger asmt_instrument_version_lifecycle
  before insert or update or delete on asmt_instrument_version
  for each row execute function public.asmt_version_lifecycle_guard();
drop trigger if exists asmt_instrument_version_after on asmt_instrument_version;
create trigger asmt_instrument_version_after
  after insert or update on asmt_instrument_version
  for each row execute function public.asmt_version_after_guard();
drop trigger if exists asmt_instrument_version_methods on asmt_instrument_version;
create trigger asmt_instrument_version_methods
  before insert or update on asmt_instrument_version
  for each row execute function public.asmt_method_codes_guard();

drop trigger if exists asmt_item_methods on asmt_item;
create trigger asmt_item_methods
  before insert or update on asmt_item
  for each row execute function public.asmt_method_codes_guard();
drop trigger if exists asmt_item_config on asmt_item;
create trigger asmt_item_config
  before insert or update on asmt_item
  for each row execute function public.asmt_item_config_guard();
drop trigger if exists asmt_item_field_config on asmt_item_field;
create trigger asmt_item_field_config
  before insert or update on asmt_item_field
  for each row execute function public.asmt_item_config_guard();

drop trigger if exists asmt_group_freeze on asmt_group;
create trigger asmt_group_freeze before insert or update or delete on asmt_group
  for each row execute function public.asmt_child_freeze_guard();
drop trigger if exists asmt_section_freeze on asmt_section;
create trigger asmt_section_freeze before insert or update or delete on asmt_section
  for each row execute function public.asmt_child_freeze_guard();
drop trigger if exists asmt_item_freeze on asmt_item;
create trigger asmt_item_freeze before insert or update or delete on asmt_item
  for each row execute function public.asmt_child_freeze_guard();
drop trigger if exists asmt_item_field_freeze on asmt_item_field;
create trigger asmt_item_field_freeze before insert or update or delete on asmt_item_field
  for each row execute function public.asmt_child_freeze_guard();
drop trigger if exists asmt_mapping_freeze on asmt_mapping;
create trigger asmt_mapping_freeze before insert or update or delete on asmt_mapping
  for each row execute function public.asmt_child_freeze_guard();
drop trigger if exists asmt_version_layout_freeze on asmt_version_layout;
create trigger asmt_version_layout_freeze before insert or update or delete on asmt_version_layout
  for each row execute function public.asmt_child_freeze_guard();
drop trigger if exists asmt_version_tag_freeze on asmt_version_tag;
create trigger asmt_version_tag_freeze before insert or update or delete on asmt_version_tag
  for each row execute function public.asmt_child_freeze_guard();
drop trigger if exists asmt_response_scale_level_freeze on asmt_response_scale_level;
create trigger asmt_response_scale_level_freeze before insert or update or delete on asmt_response_scale_level
  for each row execute function public.asmt_child_freeze_guard();
drop trigger if exists asmt_response_scale_state_freeze on asmt_response_scale_state;
create trigger asmt_response_scale_state_freeze before insert or update or delete on asmt_response_scale_state
  for each row execute function public.asmt_child_freeze_guard();

drop trigger if exists asmt_review_decision_sod on asmt_review_decision;
create trigger asmt_review_decision_sod before insert on asmt_review_decision
  for each row execute function public.asmt_review_decision_sod_guard();
drop trigger if exists asmt_review_decision_append_only on asmt_review_decision;
create trigger asmt_review_decision_append_only before update or delete on asmt_review_decision
  for each row execute function public.asmt_append_only_guard();
drop trigger if exists asmt_definition_event_append_only on asmt_definition_event;
create trigger asmt_definition_event_append_only before update or delete on asmt_definition_event
  for each row execute function public.asmt_append_only_guard();

drop trigger if exists asmt_instrument_definition_guard on asmt_instrument;
create trigger asmt_instrument_definition_guard before update on asmt_instrument
  for each row execute function public.asmt_definition_guard();
drop trigger if exists asmt_response_scale_definition_guard on asmt_response_scale;
create trigger asmt_response_scale_definition_guard before update on asmt_response_scale
  for each row execute function public.asmt_definition_guard();
drop trigger if exists asmt_rule_template_definition_guard on asmt_rule_template;
create trigger asmt_rule_template_definition_guard before update on asmt_rule_template
  for each row execute function public.asmt_definition_guard();
drop trigger if exists asmt_layout_template_definition_guard on asmt_layout_template;
create trigger asmt_layout_template_definition_guard before update on asmt_layout_template
  for each row execute function public.asmt_definition_guard();


-- Verification: the six capabilities, the five positions with their live grants and no appointment.
select code from hq_capability where code like 'hq.assessment.%' order by code;

select position_code, capability_code from hq_position_capability
 where position_code in ('assessment_studio_author', 'assessment_studio_reviewer', 'assessment_studio_publisher',
                         'assessment_coordinator', 'checklist_assessor') and effective_to is null
 order by position_code, capability_code;

select count(*) as asmt_appointments from ogs_office_appointments
 where role in ('assessment_studio_author', 'assessment_studio_reviewer', 'assessment_studio_publisher',
                'assessment_coordinator', 'checklist_assessor');

notify pgrst, 'reload schema';
