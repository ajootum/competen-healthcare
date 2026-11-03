-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql and SQL function bodies between dollar quotes. A runner that
-- splits on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 894: ASSESSMENT AND CHECKLIST CATALOGUE (Competen Holdings registry, catalogue slice C1)
--
-- Owner-approved Holdings Assessment and Checklist Catalogue, design of record: the coordinator catalogue
-- design (3 Nov 2026), section Migration 894, with the owner mock-up adoption notes. Staging first.
-- Production needs its own owner GO and is applied by the owner by hand.
--
-- PRINCIPLE. The catalogue is the governed REGISTRY: identity, classification, discovery and availability.
-- Checklist Studio authors content, the Assessment Engine delivers it. There is ONE master record,
-- asmt_instrument (890). This file extends it. It never creates a second instrument table, a second editor
-- or a second versioning scheme. A catalogue version is an asmt_instrument_version row, and the published
-- one is authoritative. The catalogue holds metadata only. It never reads or stores an instance, a response,
-- an evidence item, an outcome or a progression decision.
--
-- DEPENDS ON 890 ONLY (asmt_instrument, asmt_instrument_family, asmt_instrument_family_counter,
-- asmt_mapping_kind, asmt_definition_event, asmt_instrument_version, asmt_assign_catalogue_code,
-- asmt_definition_guard), 264 (hq_capability, hq_position, hq_position_capability), 281 (plat_product_line),
-- 006 (organisations) and profiles. It does NOT need 893: the only shared rows are seeds written with
-- on conflict do nothing. APPLY AFTER 890. Additive. Re-running it is a no-op. It appoints NOBODY.
--
-- WHAT IT ADDS.
--   1. Eight catalogue families (CA, CPA, DA, KA, SPA, QCA, ISC, SDA) in the 890 family registry.
--   2. Classification as rows: asmt_catalogue_dimension (method, domain, population, setting, level,
--      specialty, keyword), asmt_catalogue_term (the labels, optionally hierarchical and optionally linked
--      to an authority elsewhere), asmt_instrument_term (many to many, at most one primary term per
--      instrument and dimension, held by a trigger and not by a partial index). Level terms are NOT seeded.
--   3. Instrument level relations (asmt_instrument_relation) and references (asmt_instrument_reference:
--      a standard, a framework, a policy, by id and label, never a copy of the row it points at).
--   4. Governance metadata on the master record: owning_entity, responsible_authority, governance_note.
--      asmt_definition_guard is redefined only to let those three columns change like the name does.
--   5. Availability per product line (asmt_instrument_availability) and a minimal organisation scope.
--   6. Collections (asmt_collection, asmt_collection_member).
--   7. Search and duplicate warning as service role functions (asmt_catalogue_search, asmt_catalogue_stats,
--      asmt_catalogue_similar). Similarity is a token overlap. It needs no extension.
--   8. Write functions that change the data and record the event in one transaction (register, classify,
--      availability, relation, reference, collection member, identity). Events go to asmt_definition_event.
--   9. Two capabilities (hq.assessment.catalogue.view and .manage) and the position
--      assessment_catalogue_manager. NOBODY is appointed.
--
-- AUTHORITY. The HQ gate decides who may call a write function. The functions check that the named actor is a
-- real profile and refuse everything the schema refuses. They do not repeat the capability check, because the
-- Studio create path must be able to register an identity for an author who holds the author capability.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last. RLS on every table, no policy here (service role only).
--
-- ROLLBACK (staging): PENDING-39/ROLLBACK-894.sql
-- ====================================================================================================


-- ---- 1. capabilities and position (nobody appointed) ---------------------------------------------------

insert into hq_capability (code, space, label, description) values
  ('hq.assessment.catalogue.view', 'quality', 'Assessment catalogue view',
   'Search the Holdings assessment and checklist catalogue and read an instrument''s classification, availability and versions. Does not allow any change'),
  ('hq.assessment.catalogue.manage', 'quality', 'Assessment catalogue management',
   'Register an instrument identity, classify it, set its product availability, relate and reference it, and keep collections and the classification terms. Never edits checklist content')
on conflict (code) do nothing;

insert into hq_position (code, space, name, description) values
  ('assessment_catalogue_manager', 'quality', 'Assessment Catalogue Manager',
   'Keeps the Holdings assessment and checklist catalogue: identities, classification, availability, collections and terms')
on conflict (code) do nothing;

insert into hq_position_capability (position_code, capability_code, source) values
  ('assessment_catalogue_manager', 'hq.platform.home.view', 'position_default'),
  ('assessment_catalogue_manager', 'hq.assessment.catalogue.view', 'position_default'),
  ('assessment_catalogue_manager', 'hq.assessment.catalogue.manage', 'position_default')
on conflict (position_code, capability_code) do nothing;


-- ---- 2. families and mapping kinds (seeds, never overwritten) -------------------------------------------

insert into asmt_instrument_family (code, label, position) values
  ('CA',  'Competency Assessment', 10),
  ('CPA', 'Clinical Practice Audit', 20),
  ('DA',  'Documentation Audit', 30),
  ('KA',  'Knowledge Assessment', 40),
  ('SPA', 'Simulation & Practical Assessment', 50),
  ('QCA', 'Quality & Compliance Audit', 60),
  ('ISC', 'Inspection & Safety Checklist', 70),
  ('SDA', 'Self-Assessment & Development', 80)
on conflict (code) do nothing;

insert into asmt_mapping_kind (code, label) values
  ('clinical_standard', 'Clinical standard'),
  ('quality_standard', 'Quality standard'),
  ('organisational_policy', 'Organisational policy'),
  ('regulatory_requirement', 'Regulatory requirement'),
  ('equipment_standard', 'Equipment standard'),
  ('framework', 'Framework'),
  ('framework_competency', 'Framework competency')
on conflict (code) do nothing;


-- ---- 3. classification: dimensions, terms, and the instrument links ---------------------------------------

create table if not exists asmt_catalogue_dimension (
  code            text primary key,
  label           text not null,
  is_active       boolean not null default true,
  allows_hierarchy boolean not null default false,
  position        int not null default 0,
  created_at      timestamptz not null default now(),
  constraint asmt_catalogue_dimension_code_check check (code ~ '^[a-z_]{2,40}$'),
  constraint asmt_catalogue_dimension_label_check check (btrim(label) <> '')
);
alter table asmt_catalogue_dimension enable row level security;

insert into asmt_catalogue_dimension (code, label, allows_hierarchy, position) values
  ('method',     'Assessment method', false, 10),
  ('domain',     'Subject domain', true, 20),
  ('population', 'Applicable population', false, 30),
  ('setting',    'Context / setting', false, 40),
  ('level',      'Qualification level', false, 50),
  ('specialty',  'Specialty', true, 60),
  ('keyword',    'Keyword', false, 70)
on conflict (code) do nothing;

create table if not exists asmt_catalogue_term (
  id              uuid primary key default gen_random_uuid(),
  dimension_code  text not null references asmt_catalogue_dimension(code),
  code            text not null,
  label           text not null,
  parent_id       uuid references asmt_catalogue_term(id),
  source_kind     text,
  source_ref      uuid,
  is_active       boolean not null default true,
  position        int not null default 0,
  created_at      timestamptz not null default now(),
  unique (dimension_code, code),
  constraint asmt_catalogue_term_code_check check (code ~ '^[a-z0-9][a-z0-9_]{0,59}$'),
  constraint asmt_catalogue_term_label_check check (btrim(label) <> ''),
  constraint asmt_catalogue_term_parent_check check (parent_id is null or parent_id <> id)
);
-- A link to an authority needs both parts or neither. The test is written so a null cannot make it pass.
alter table asmt_catalogue_term drop constraint if exists asmt_catalogue_term_source_check;
alter table asmt_catalogue_term add constraint asmt_catalogue_term_source_check check (
  (source_kind is null and source_ref is null) or (coalesce(source_kind ~ '^[a-z][a-z0-9_]{1,40}$', false) and source_ref is not null));
create index if not exists idx_asmt_catalogue_term_dimension on asmt_catalogue_term (dimension_code, position);
create index if not exists idx_asmt_catalogue_term_parent on asmt_catalogue_term (parent_id);
alter table asmt_catalogue_term enable row level security;

-- A parent is allowed only in a dimension that allows a hierarchy, must sit in the same dimension, and must
-- not close a loop.
create or replace function public.asmt_catalogue_term_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_parent_dim text;
  v_allows boolean;
  v_walk uuid;
  v_depth int := 0;
begin
  if new.parent_id is null then
    return new;
  end if;
  select dimension_code into v_parent_dim from asmt_catalogue_term where id = new.parent_id;
  if v_parent_dim is null then
    raise exception 'asmt_catalogue_term: the parent term does not exist';
  end if;
  if v_parent_dim <> new.dimension_code then
    raise exception 'asmt_catalogue_term: a parent must be in the same dimension';
  end if;
  select allows_hierarchy into v_allows from asmt_catalogue_dimension where code = new.dimension_code;
  if not coalesce(v_allows, false) then
    raise exception 'asmt_catalogue_term: the dimension % does not allow a hierarchy', new.dimension_code;
  end if;
  v_walk := new.parent_id;
  while v_walk is not null and v_depth < 20 loop
    if v_walk = new.id then
      raise exception 'asmt_catalogue_term: a term cannot be its own ancestor';
    end if;
    select parent_id into v_walk from asmt_catalogue_term where id = v_walk;
    v_depth := v_depth + 1;
  end loop;
  return new;
end;
$$;

-- Seed terms. The level dimension is deliberately empty: level terms are created by linking to the existing
-- programme framework qualification levels through source_kind and source_ref.
insert into asmt_catalogue_term (dimension_code, code, label, position)
select v.dimension_code, v.code, v.label, v.position
from (values
  ('method', 'direct_observation', 'Direct observation', 10),
  ('method', 'clinical_simulation', 'Clinical simulation', 20),
  ('method', 'osce', 'OSCE', 30),
  ('method', 'chart_review', 'Chart review', 40),
  ('method', 'concurrent_comparison', 'Concurrent comparison', 50),
  ('method', 'interview', 'Interview', 60),
  ('method', 'knowledge_examination', 'Knowledge examination', 70),
  ('method', 'portfolio_review', 'Portfolio review', 80),
  ('method', 'equipment_inspection', 'Equipment inspection', 90),
  ('method', 'self_assessment', 'Self-assessment', 100),
  ('domain', 'respiratory', 'Respiratory', 10),
  ('domain', 'cardiovascular', 'Cardiovascular', 20),
  ('domain', 'neurological', 'Neurological', 30),
  ('domain', 'medication_safety', 'Medication safety', 40),
  ('domain', 'infection_prevention', 'Infection prevention', 50),
  ('domain', 'nursing_documentation', 'Nursing documentation', 60),
  ('domain', 'patient_safety', 'Patient safety', 70),
  ('domain', 'clinical_governance', 'Clinical governance', 80),
  ('population', 'nursing', 'Nursing', 10),
  ('population', 'ems', 'EMS', 20),
  ('population', 'medicine', 'Medicine', 30),
  ('population', 'allied_health', 'Allied health', 40),
  ('population', 'healthcare_facility', 'Healthcare facility', 50),
  ('population', 'department', 'Department', 60),
  ('population', 'equipment', 'Equipment', 70),
  ('setting', 'diploma', 'Diploma programme', 10),
  ('setting', 'bachelors', 'Bachelors programme', 20),
  ('setting', 'paediatric_ward', 'Paediatric ward', 30),
  ('setting', 'critical_care', 'Critical care', 40),
  ('setting', 'emergency_department', 'Emergency department', 50),
  ('setting', 'hospital_wide', 'Hospital-wide', 60)
) as v(dimension_code, code, label, position)
on conflict (dimension_code, code) do nothing;

create table if not exists asmt_instrument_term (
  instrument_id   uuid not null references asmt_instrument(id) on delete cascade,
  term_id         uuid not null references asmt_catalogue_term(id),
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now(),
  primary key (instrument_id, term_id)
);
create index if not exists idx_asmt_instrument_term_term on asmt_instrument_term (term_id);
alter table asmt_instrument_term enable row level security;

-- At most one primary term per instrument and dimension. A trigger, with a transaction lock so two writers
-- cannot both pass the check. An inactive term cannot be newly assigned.
create or replace function public.asmt_instrument_term_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_dim text;
  v_active boolean;
begin
  select dimension_code, is_active into v_dim, v_active from asmt_catalogue_term where id = new.term_id;
  if v_dim is null then
    raise exception 'asmt_instrument_term: the term does not exist';
  end if;
  if tg_op = 'INSERT' and not v_active then
    raise exception 'asmt_instrument_term: the term is not active. Reactivate it or choose another';
  end if;
  if new.is_primary then
    perform pg_advisory_xact_lock(hashtextextended(new.instrument_id::text || ':' || v_dim, 0));
    if exists (
      select 1 from asmt_instrument_term it
      join asmt_catalogue_term t on t.id = it.term_id
      where it.instrument_id = new.instrument_id and it.is_primary and t.dimension_code = v_dim and it.term_id <> new.term_id
    ) then
      raise exception 'asmt_instrument_term: an instrument has at most one primary term per dimension (%)', v_dim;
    end if;
  end if;
  return new;
end;
$$;


-- ---- 4. relations and references ----------------------------------------------------------------------------

create table if not exists asmt_instrument_relation (
  instrument_id         uuid not null references asmt_instrument(id) on delete cascade,
  related_instrument_id uuid not null references asmt_instrument(id) on delete cascade,
  relation              text not null,
  note                  text,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  primary key (instrument_id, related_instrument_id, relation),
  constraint asmt_instrument_relation_self_check check (instrument_id <> related_instrument_id),
  constraint asmt_instrument_relation_kind_check check (relation in ('related', 'adapted_from', 'supersedes', 'companion'))
);
create index if not exists idx_asmt_instrument_relation_related on asmt_instrument_relation (related_instrument_id);
alter table asmt_instrument_relation enable row level security;

-- An instrument level reference to a standard, framework or policy. ref_table names the table ref_id points
-- into, because the kind alone does not say. No row of the referenced table is copied here.
create table if not exists asmt_instrument_reference (
  id             uuid primary key default gen_random_uuid(),
  instrument_id  uuid not null references asmt_instrument(id) on delete cascade,
  kind           text not null references asmt_mapping_kind(code),
  ref_table      text,
  ref_id         uuid,
  ref_code       text,
  ref_label      text not null,
  ref_version    text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  constraint asmt_instrument_reference_label_check check (btrim(ref_label) <> '')
);
-- An id needs the table it points into, and a table needs an id. The test is written so a null cannot make it pass.
alter table asmt_instrument_reference drop constraint if exists asmt_instrument_reference_table_check;
alter table asmt_instrument_reference add constraint asmt_instrument_reference_table_check check (
  (ref_id is null and ref_table is null) or (ref_id is not null and coalesce(ref_table ~ '^[a-z][a-z0-9_]{1,60}$', false)));
create index if not exists idx_asmt_instrument_reference_instrument on asmt_instrument_reference (instrument_id);
create index if not exists idx_asmt_instrument_reference_ref on asmt_instrument_reference (ref_id);
create unique index if not exists ux_asmt_instrument_reference_once
  on asmt_instrument_reference (instrument_id, kind, coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(ref_code, ''), ref_label);
alter table asmt_instrument_reference enable row level security;


-- ---- 5. governance metadata on the master record --------------------------------------------------------------

alter table asmt_instrument add column if not exists owning_entity text not null default 'Competen Holdings';
alter table asmt_instrument add column if not exists responsible_authority text;
alter table asmt_instrument add column if not exists governance_note text;
alter table asmt_instrument drop constraint if exists asmt_instrument_owning_entity_check;
alter table asmt_instrument add constraint asmt_instrument_owning_entity_check check (btrim(owning_entity) <> '');

-- The 890 guard, with the three governance columns allowed to change like the name and description. The code,
-- the owner scope and the kind stay permanent, and so does the family once set.
create or replace function public.asmt_definition_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_free text[] := array['name', 'visibility', 'description', 'family_code', 'owning_entity', 'responsible_authority', 'governance_note'];
begin
  if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
    raise exception '%: the code, owner and kind of a definition are permanent. Only the name, description and visibility can change', tg_table_name;
  end if;
  if tg_table_name = 'asmt_instrument' and old.family_code is not null and new.family_code is distinct from old.family_code then
    raise exception 'asmt_instrument: the family of a definition is permanent once set';
  end if;
  return new;
end;
$$;


-- ---- 6. availability and organisation scope ----------------------------------------------------------------------

create table if not exists asmt_instrument_availability (
  instrument_id  uuid not null references asmt_instrument(id) on delete cascade,
  product_line   text not null references plat_product_line(code),
  mode           text not null,
  granted_by     uuid,
  granted_at     timestamptz not null default now(),
  note           text,
  primary key (instrument_id, product_line),
  constraint asmt_instrument_availability_mode_check check (mode in ('available', 'optional', 'unavailable'))
);
create index if not exists idx_asmt_instrument_availability_product on asmt_instrument_availability (product_line, mode);
alter table asmt_instrument_availability enable row level security;

create table if not exists asmt_instrument_org_scope (
  instrument_id    uuid not null references asmt_instrument(id) on delete cascade,
  organisation_id  uuid not null references organisations(id),
  mode             text not null,
  granted_by       uuid,
  granted_at       timestamptz not null default now(),
  primary key (instrument_id, organisation_id),
  constraint asmt_instrument_org_scope_mode_check check (mode in ('adopt', 'view'))
);
alter table asmt_instrument_org_scope enable row level security;


-- ---- 7. collections ---------------------------------------------------------------------------------------------------

create table if not exists asmt_collection (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  description   text,
  owner_scope   text not null default 'holdings',
  owner_product_line text references plat_product_line(code),
  owner_organisation_id uuid references organisations(id),
  owner_user_id uuid references profiles(id),
  visibility    text not null default 'owner',
  is_active     boolean not null default true,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint asmt_collection_code_check check (code ~ '^[A-Z0-9-]{3,40}$'),
  constraint asmt_collection_name_check check (btrim(name) <> ''),
  constraint asmt_collection_visibility_check check (visibility in ('private', 'owner', 'adoptable')),
  constraint asmt_collection_owner_check check (
    owner_scope in ('holdings', 'product', 'organisation', 'individual')
    and num_nonnulls(owner_product_line, owner_organisation_id, owner_user_id) = case when owner_scope = 'holdings' then 0 else 1 end
    and (owner_scope = 'holdings'
         or (owner_scope = 'product' and owner_product_line is not null)
         or (owner_scope = 'organisation' and owner_organisation_id is not null)
         or (owner_scope = 'individual' and owner_user_id is not null)))
);
alter table asmt_collection enable row level security;

create table if not exists asmt_collection_member (
  collection_id  uuid not null references asmt_collection(id) on delete cascade,
  instrument_id  uuid not null references asmt_instrument(id) on delete cascade,
  position       int not null default 0,
  added_by       uuid,
  added_at       timestamptz not null default now(),
  primary key (collection_id, instrument_id)
);
create index if not exists idx_asmt_collection_member_instrument on asmt_collection_member (instrument_id);
alter table asmt_collection_member enable row level security;


-- ---- 8. search -------------------------------------------------------------------------------------------------------------

create or replace function public.asmt_catalogue_tsv(p_name text, p_description text, p_code text)
returns tsvector
language sql
immutable
set search_path = public, pg_catalog
as $$
  select to_tsvector('simple'::regconfig, coalesce(p_name, '') || ' ' || coalesce(p_description, '') || ' ' || coalesce(p_code, ''))
$$;

create index if not exists idx_asmt_instrument_search on asmt_instrument
  using gin (public.asmt_catalogue_tsv(name, description, code));
create index if not exists idx_asmt_instrument_family_code on asmt_instrument (family_code);

-- The compact registry rows plus the total for the filtered set. Filters (all optional, all by code):
-- family, method, domain, population, setting, level, product, status (draft, in_review, approved, published,
-- retired or none for an instrument with no version yet), owner (text), collection (collection code).
-- Sort: name_asc, name_desc, updated_desc, updated_asc, published_desc, published_asc, code_asc.
-- Each search word must match the name, description, code (as a word start), the code as text, or a
-- classification term or reference of the instrument.
create or replace function public.asmt_catalogue_search(
  p_q text default null,
  p_filters jsonb default '{}'::jsonb,
  p_sort text default 'updated_desc',
  p_limit int default 50,
  p_offset int default 0)
returns table (
  id uuid, code text, name text, description text, family_code text, family_label text,
  primary_domain_label text, method_labels text[], population_labels text[], setting_labels text[],
  latest_version_no int, latest_state text, published_version_no int,
  owner text, updated_at timestamptz, published_at timestamptz, total bigint)
language sql
stable
set search_path = public, pg_catalog
as $$
  with f as (
    select nullif(btrim(p_filters ->> 'family'), '') as family,
           nullif(btrim(p_filters ->> 'method'), '') as method,
           nullif(btrim(p_filters ->> 'domain'), '') as domain,
           nullif(btrim(p_filters ->> 'population'), '') as population,
           nullif(btrim(p_filters ->> 'setting'), '') as setting,
           nullif(btrim(p_filters ->> 'level'), '') as level,
           nullif(btrim(p_filters ->> 'product'), '') as product,
           nullif(btrim(p_filters ->> 'status'), '') as status,
           nullif(btrim(p_filters ->> 'owner'), '') as owner,
           nullif(btrim(p_filters ->> 'collection'), '') as collection
  ),
  tk as (
    select array(
      select w from regexp_split_to_table(lower(btrim(coalesce(p_q, ''))), '\s+') w where w <> '' limit 8
    ) as toks
  ),
  base as (
    select i.id, i.code, i.name, i.description, i.family_code, fam.label as family_label, i.owning_entity as owner,
           lv.version_no as latest_version_no, lv.state as latest_state,
           pv.version_no as published_version_no, pv.published_at,
           tm.primary_domain_label, tm.method_labels, tm.population_labels, tm.setting_labels, tm.term_doc,
           rf.ref_doc,
           greatest(i.created_at, coalesce(ev.last_at, i.created_at), coalesce(vv.last_at, i.created_at)) as updated_at
    from asmt_instrument i
    left join asmt_instrument_family fam on fam.code = i.family_code
    left join lateral (
      select v.version_no, v.state from asmt_instrument_version v
      where v.instrument_id = i.id order by v.version_no desc limit 1) lv on true
    left join lateral (
      select v.version_no, v.published_at from asmt_instrument_version v
      where v.instrument_id = i.id and v.state = 'published' order by v.version_no desc limit 1) pv on true
    left join lateral (
      select max(greatest(v.created_at, coalesce(v.submitted_at, v.created_at), coalesce(v.published_at, v.created_at), coalesce(v.retired_at, v.created_at))) as last_at
      from asmt_instrument_version v where v.instrument_id = i.id) vv on true
    left join lateral (
      select max(e.created_at) as last_at from asmt_definition_event e
      where e.subject_table = 'asmt_instrument' and e.subject_id = i.id) ev on true
    left join lateral (
      select
        coalesce((array_agg(t.label order by t.position, t.label) filter (where t.dimension_code = 'domain' and it.is_primary))[1],
                 (array_agg(t.label order by t.position, t.label) filter (where t.dimension_code = 'domain'))[1]) as primary_domain_label,
        coalesce(array_agg(t.label order by t.position, t.label) filter (where t.dimension_code = 'method'), '{}') as method_labels,
        coalesce(array_agg(t.label order by t.position, t.label) filter (where t.dimension_code = 'population'), '{}') as population_labels,
        coalesce(array_agg(t.label order by t.position, t.label) filter (where t.dimension_code = 'setting'), '{}') as setting_labels,
        coalesce(string_agg(lower(t.label || ' ' || t.code), ' '), '') as term_doc
      from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
      where it.instrument_id = i.id) tm on true
    left join lateral (
      select coalesce(string_agg(lower(r.ref_label || ' ' || coalesce(r.ref_code, '')), ' '), '') as ref_doc
      from asmt_instrument_reference r where r.instrument_id = i.id) rf on true
  ),
  hit as (
    select b.*
    from base b cross join f cross join tk
    where (f.family is null or b.family_code = f.family)
      and (f.owner is null or b.owner ilike '%' || f.owner || '%')
      and (f.status is null or coalesce(b.latest_state, 'none') = f.status)
      and (f.method is null or exists (
            select 1 from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
            where it.instrument_id = b.id and t.dimension_code = 'method' and t.code = f.method))
      and (f.population is null or exists (
            select 1 from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
            where it.instrument_id = b.id and t.dimension_code = 'population' and t.code = f.population))
      and (f.setting is null or exists (
            select 1 from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
            where it.instrument_id = b.id and t.dimension_code = 'setting' and t.code = f.setting))
      and (f.level is null or exists (
            select 1 from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
            where it.instrument_id = b.id and t.dimension_code = 'level' and t.code = f.level))
      and (f.domain is null or exists (
            select 1 from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
            left join asmt_catalogue_term pt on pt.id = t.parent_id
            where it.instrument_id = b.id and t.dimension_code = 'domain' and (t.code = f.domain or pt.code = f.domain)))
      and (f.product is null or exists (
            select 1 from asmt_instrument_availability a
            where a.instrument_id = b.id and a.product_line = f.product and a.mode in ('available', 'optional')))
      and (f.collection is null or exists (
            select 1 from asmt_collection_member m join asmt_collection c on c.id = m.collection_id
            where m.instrument_id = b.id and c.code = f.collection))
      and not exists (
            select 1 from unnest(tk.toks) w
            where regexp_replace(w, '[^a-z0-9]+', '', 'g') <> ''
              and not (
                public.asmt_catalogue_tsv(b.name, b.description, b.code) @@ to_tsquery('simple'::regconfig, regexp_replace(w, '[^a-z0-9]+', '', 'g') || ':*')
                or lower(b.code) like '%' || w || '%'
                or b.term_doc like '%' || w || '%'
                or b.ref_doc like '%' || w || '%'))
  )
  select h.id, h.code, h.name, h.description, h.family_code, h.family_label,
         h.primary_domain_label, h.method_labels, h.population_labels, h.setting_labels,
         h.latest_version_no, h.latest_state, h.published_version_no,
         h.owner, h.updated_at, h.published_at,
         count(*) over () as total
  from hit h
  order by
    case when p_sort = 'name_asc' then lower(h.name) end asc,
    case when p_sort = 'name_desc' then lower(h.name) end desc,
    case when p_sort = 'updated_asc' then h.updated_at end asc,
    case when p_sort = 'published_asc' then h.published_at end asc nulls last,
    case when p_sort = 'published_desc' then h.published_at end desc nulls last,
    case when p_sort = 'code_asc' then h.code end asc,
    case when p_sort is null or p_sort not in ('name_asc', 'name_desc', 'updated_asc', 'published_asc', 'published_desc', 'code_asc') then h.updated_at end desc,
    h.code asc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- Four real counts for the landing tiles.
create or replace function public.asmt_catalogue_stats()
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $$
  with lv as (
    select i.id, (select v.state from asmt_instrument_version v where v.instrument_id = i.id order by v.version_no desc limit 1) as st
    from asmt_instrument i)
  select jsonb_build_object(
    'registered', (select count(*) from asmt_instrument),
    'families_active', (select count(*) from asmt_instrument_family where is_active),
    'families_used', (select count(distinct family_code) from asmt_instrument where family_code is not null),
    'published', (select count(*) from lv where st = 'published'),
    'awaiting_review', (select count(*) from lv where st = 'in_review'),
    'connected_products', (select count(distinct a.product_line) from asmt_instrument_availability a
                           join plat_product_line p on p.code = a.product_line and p.is_active
                           where a.mode in ('available', 'optional')),
    'active_products', (select count(*) from plat_product_line where is_active))
$$;

-- Duplicate warning. Never a block. Title words of three letters or more, minus a few joining words, are
-- matched against the existing names. A candidate needs an exact title or at least two shared words that
-- cover at least 60 percent of the new title. Same-family candidates are listed first.
create or replace function public.asmt_catalogue_similar(p_title text, p_family text default null)
returns table (id uuid, code text, name text, family_code text, family_label text, score numeric, same_family boolean)
language sql
stable
set search_path = public, pg_catalog
as $$
  with t as (
    select array(
      select distinct w
      from regexp_split_to_table(lower(regexp_replace(coalesce(p_title, ''), '[^A-Za-z0-9]+', ' ', 'g')), '\s+') w
      where char_length(w) >= 3 and w not in ('the', 'and', 'for', 'with', 'from', 'are', 'that', 'this')
    ) as toks
  ),
  scored as (
    select i.id, i.code, i.name, i.family_code, fam.label as family_label,
           case when lower(btrim(i.name)) = lower(btrim(coalesce(p_title, ''))) then 1::numeric
                when cardinality(t.toks) = 0 then 0::numeric
                else round(h.hit::numeric / cardinality(t.toks), 3) end as score,
           h.hit,
           cardinality(t.toks) as n,
           (p_family is not null and i.family_code = p_family) as same_family
    from asmt_instrument i
    cross join t
    left join asmt_instrument_family fam on fam.code = i.family_code
    cross join lateral (select count(*) as hit from unnest(t.toks) w where lower(i.name) like '%' || w || '%') h
  )
  select s.id, s.code, s.name, s.family_code, s.family_label, s.score, s.same_family
  from scored s
  where s.score = 1 or (s.hit >= 2 and s.score >= 0.6)
  order by s.same_family desc, s.score desc, s.name asc
  limit 5
$$;


-- ---- 9. write functions (change and event in one transaction) -----------------------------------------------------------

create or replace function public.asmt_catalogue_actor_check(p_actor uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if p_actor is null or not exists (select 1 from profiles where id = p_actor) then
    raise exception 'asmt_catalogue: a known person must be named as the actor';
  end if;
end;
$$;

create or replace function public.asmt_catalogue_event(p_instrument uuid, p_event text, p_actor uuid, p_detail jsonb)
returns void
language sql
set search_path = public, pg_catalog
as $$
  insert into asmt_definition_event (subject_table, subject_id, event, actor_id, detail)
  values ('asmt_instrument', p_instrument, p_event, p_actor, coalesce(p_detail, '{}'::jsonb))
$$;

-- Replace the classification of an instrument. p_terms is an array of {term_id, is_primary}. Terms not listed are
-- removed. The one-primary rule belongs to the trigger.
create or replace function public.asmt_catalogue_classify(p_instrument uuid, p_terms jsonb, p_actor uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  e jsonb;
begin
  perform public.asmt_catalogue_actor_check(p_actor);
  if not exists (select 1 from asmt_instrument where id = p_instrument) then
    raise exception 'asmt_catalogue_classify: the instrument does not exist';
  end if;
  if p_terms is null or jsonb_typeof(p_terms) <> 'array' then
    raise exception 'asmt_catalogue_classify: p_terms must be an array';
  end if;
  update asmt_instrument_term set is_primary = false where instrument_id = p_instrument and is_primary;
  delete from asmt_instrument_term
   where instrument_id = p_instrument
     and term_id not in (select (x ->> 'term_id')::uuid from jsonb_array_elements(p_terms) x);
  for e in select * from jsonb_array_elements(p_terms) loop
    insert into asmt_instrument_term (instrument_id, term_id, is_primary)
    values (p_instrument, (e ->> 'term_id')::uuid, coalesce((e ->> 'is_primary')::boolean, false))
    on conflict (instrument_id, term_id) do update set is_primary = excluded.is_primary;
  end loop;
  perform public.asmt_catalogue_event(p_instrument, 'catalogue_classified', p_actor, jsonb_build_object('terms', p_terms));
end;
$$;

-- Register an identity: the next catalogue code for the family and the master record, in one transaction.
-- No version is created. p_terms is optional (same shape as classify).
create or replace function public.asmt_catalogue_register(
  p_family text, p_name text, p_description text, p_kind text, p_actor uuid, p_terms jsonb default '[]'::jsonb)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
  v_code text;
begin
  perform public.asmt_catalogue_actor_check(p_actor);
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'asmt_catalogue_register: a title is required';
  end if;
  v_code := public.asmt_assign_catalogue_code(p_family);
  insert into asmt_instrument (code, name, kind, family_code, description, created_by)
  values (v_code, btrim(p_name), coalesce(nullif(btrim(coalesce(p_kind, '')), ''), 'assessment'), p_family,
          nullif(btrim(coalesce(p_description, '')), ''), p_actor)
  returning id into v_id;
  perform public.asmt_catalogue_event(v_id, 'catalogue_registered', p_actor, jsonb_build_object('code', v_code, 'family', p_family));
  if p_terms is not null and jsonb_typeof(p_terms) = 'array' and jsonb_array_length(p_terms) > 0 then
    perform public.asmt_catalogue_classify(v_id, p_terms, p_actor);
  end if;
  return v_id;
end;
$$;

-- Name, description and governance metadata. The code, the kind and the family never change.
create or replace function public.asmt_catalogue_update_identity(
  p_instrument uuid, p_name text, p_description text, p_responsible_authority text, p_governance_note text, p_actor uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  perform public.asmt_catalogue_actor_check(p_actor);
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'asmt_catalogue_update_identity: a title is required';
  end if;
  update asmt_instrument
     set name = btrim(p_name),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         responsible_authority = nullif(btrim(coalesce(p_responsible_authority, '')), ''),
         governance_note = nullif(btrim(coalesce(p_governance_note, '')), '')
   where id = p_instrument;
  if not found then
    raise exception 'asmt_catalogue_update_identity: the instrument does not exist';
  end if;
  perform public.asmt_catalogue_event(p_instrument, 'catalogue_updated', p_actor, jsonb_build_object('name', btrim(p_name)));
end;
$$;

-- Availability for one product line. A null or empty mode removes the row (not enabled).
create or replace function public.asmt_catalogue_set_availability(
  p_instrument uuid, p_product_line text, p_mode text, p_note text, p_actor uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  perform public.asmt_catalogue_actor_check(p_actor);
  if not exists (select 1 from asmt_instrument where id = p_instrument) then
    raise exception 'asmt_catalogue_set_availability: the instrument does not exist';
  end if;
  if p_mode is null or btrim(p_mode) = '' then
    delete from asmt_instrument_availability where instrument_id = p_instrument and product_line = p_product_line;
  else
    insert into asmt_instrument_availability (instrument_id, product_line, mode, granted_by, granted_at, note)
    values (p_instrument, p_product_line, p_mode, p_actor, now(), nullif(btrim(coalesce(p_note, '')), ''))
    on conflict (instrument_id, product_line)
    do update set mode = excluded.mode, granted_by = excluded.granted_by, granted_at = now(), note = excluded.note;
  end if;
  perform public.asmt_catalogue_event(p_instrument, 'catalogue_availability', p_actor,
    jsonb_build_object('product_line', p_product_line, 'mode', coalesce(nullif(btrim(coalesce(p_mode, '')), ''), 'removed')));
end;
$$;

-- Relate two instruments, or remove the relation.
create or replace function public.asmt_catalogue_set_relation(
  p_instrument uuid, p_related uuid, p_relation text, p_note text, p_remove boolean, p_actor uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  perform public.asmt_catalogue_actor_check(p_actor);
  if p_instrument = p_related then
    raise exception 'asmt_catalogue_set_relation: an instrument cannot be related to itself';
  end if;
  if coalesce(p_remove, false) then
    delete from asmt_instrument_relation where instrument_id = p_instrument and related_instrument_id = p_related and relation = p_relation;
  else
    insert into asmt_instrument_relation (instrument_id, related_instrument_id, relation, note, created_by)
    values (p_instrument, p_related, p_relation, nullif(btrim(coalesce(p_note, '')), ''), p_actor)
    on conflict (instrument_id, related_instrument_id, relation) do update set note = excluded.note;
  end if;
  perform public.asmt_catalogue_event(p_instrument, 'catalogue_relation', p_actor,
    jsonb_build_object('related', p_related, 'relation', p_relation, 'removed', coalesce(p_remove, false)));
end;
$$;

-- Add a reference to a standard, framework or policy. Returns the reference id. A repeat is a no-op.
create or replace function public.asmt_catalogue_reference_add(
  p_instrument uuid, p_kind text, p_ref_table text, p_ref_id uuid, p_ref_code text, p_ref_label text, p_ref_version text, p_actor uuid)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
begin
  perform public.asmt_catalogue_actor_check(p_actor);
  if not exists (select 1 from asmt_instrument where id = p_instrument) then
    raise exception 'asmt_catalogue_reference_add: the instrument does not exist';
  end if;
  insert into asmt_instrument_reference (instrument_id, kind, ref_table, ref_id, ref_code, ref_label, ref_version, created_by)
  values (p_instrument, p_kind, p_ref_table, p_ref_id, nullif(btrim(coalesce(p_ref_code, '')), ''), btrim(coalesce(p_ref_label, '')),
          nullif(btrim(coalesce(p_ref_version, '')), ''), p_actor)
  on conflict (instrument_id, kind, coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(ref_code, ''), ref_label)
  do update set ref_version = excluded.ref_version
  returning id into v_id;
  perform public.asmt_catalogue_event(p_instrument, 'catalogue_relation', p_actor,
    jsonb_build_object('reference', v_id, 'kind', p_kind, 'label', btrim(coalesce(p_ref_label, '')), 'removed', false));
  return v_id;
end;
$$;

create or replace function public.asmt_catalogue_reference_remove(p_reference uuid, p_actor uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_instrument uuid;
  v_label text;
  v_kind text;
begin
  perform public.asmt_catalogue_actor_check(p_actor);
  delete from asmt_instrument_reference where id = p_reference returning instrument_id, ref_label, kind into v_instrument, v_label, v_kind;
  if v_instrument is null then
    raise exception 'asmt_catalogue_reference_remove: the reference does not exist';
  end if;
  perform public.asmt_catalogue_event(v_instrument, 'catalogue_relation', p_actor,
    jsonb_build_object('reference', p_reference, 'kind', v_kind, 'label', v_label, 'removed', true));
end;
$$;

-- Add an instrument to a collection, or remove it.
create or replace function public.asmt_catalogue_collection_member(p_collection uuid, p_instrument uuid, p_add boolean, p_actor uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  perform public.asmt_catalogue_actor_check(p_actor);
  if not exists (select 1 from asmt_collection where id = p_collection) then
    raise exception 'asmt_catalogue_collection_member: the collection does not exist';
  end if;
  if not exists (select 1 from asmt_instrument where id = p_instrument) then
    raise exception 'asmt_catalogue_collection_member: the instrument does not exist';
  end if;
  if coalesce(p_add, true) then
    insert into asmt_collection_member (collection_id, instrument_id, position, added_by)
    values (p_collection, p_instrument,
            coalesce((select max(position) + 10 from asmt_collection_member where collection_id = p_collection), 10), p_actor)
    on conflict (collection_id, instrument_id) do nothing;
  else
    delete from asmt_collection_member where collection_id = p_collection and instrument_id = p_instrument;
  end if;
  perform public.asmt_catalogue_event(p_instrument, 'catalogue_collection', p_actor,
    jsonb_build_object('collection', p_collection, 'added', coalesce(p_add, true)));
end;
$$;


-- ---- 10. privileges --------------------------------------------------------------------------------------------------------

revoke all on function public.asmt_catalogue_term_guard() from public, anon, authenticated;
revoke all on function public.asmt_instrument_term_guard() from public, anon, authenticated;
revoke all on function public.asmt_definition_guard() from public, anon, authenticated;
revoke all on function public.asmt_catalogue_tsv(text, text, text) from public, anon, authenticated;
revoke all on function public.asmt_catalogue_search(text, jsonb, text, int, int) from public, anon, authenticated;
revoke all on function public.asmt_catalogue_stats() from public, anon, authenticated;
revoke all on function public.asmt_catalogue_similar(text, text) from public, anon, authenticated;
revoke all on function public.asmt_catalogue_actor_check(uuid) from public, anon, authenticated;
revoke all on function public.asmt_catalogue_event(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.asmt_catalogue_classify(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.asmt_catalogue_register(text, text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.asmt_catalogue_update_identity(uuid, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.asmt_catalogue_set_availability(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.asmt_catalogue_set_relation(uuid, uuid, text, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.asmt_catalogue_reference_add(uuid, text, text, uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.asmt_catalogue_reference_remove(uuid, uuid) from public, anon, authenticated;
revoke all on function public.asmt_catalogue_collection_member(uuid, uuid, boolean, uuid) from public, anon, authenticated;

grant execute on function public.asmt_catalogue_tsv(text, text, text) to service_role;
grant execute on function public.asmt_catalogue_search(text, jsonb, text, int, int) to service_role;
grant execute on function public.asmt_catalogue_stats() to service_role;
grant execute on function public.asmt_catalogue_similar(text, text) to service_role;
grant execute on function public.asmt_catalogue_actor_check(uuid) to service_role;
grant execute on function public.asmt_catalogue_event(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.asmt_catalogue_classify(uuid, jsonb, uuid) to service_role;
grant execute on function public.asmt_catalogue_register(text, text, text, text, uuid, jsonb) to service_role;
grant execute on function public.asmt_catalogue_update_identity(uuid, text, text, text, text, uuid) to service_role;
grant execute on function public.asmt_catalogue_set_availability(uuid, text, text, text, uuid) to service_role;
grant execute on function public.asmt_catalogue_set_relation(uuid, uuid, text, text, boolean, uuid) to service_role;
grant execute on function public.asmt_catalogue_reference_add(uuid, text, text, uuid, text, text, text, uuid) to service_role;
grant execute on function public.asmt_catalogue_reference_remove(uuid, uuid) to service_role;
grant execute on function public.asmt_catalogue_collection_member(uuid, uuid, boolean, uuid) to service_role;


-- ---- 11. triggers ---------------------------------------------------------------------------------------------------------

drop trigger if exists asmt_catalogue_term_guard on asmt_catalogue_term;
create trigger asmt_catalogue_term_guard before insert or update on asmt_catalogue_term
  for each row execute function public.asmt_catalogue_term_guard();

drop trigger if exists asmt_instrument_term_guard on asmt_instrument_term;
create trigger asmt_instrument_term_guard before insert or update on asmt_instrument_term
  for each row execute function public.asmt_instrument_term_guard();


-- Verification: the tables, the seeds and the capability grants.
select count(*) as catalogue_families from asmt_instrument_family where code in ('CA', 'CPA', 'DA', 'KA', 'SPA', 'QCA', 'ISC', 'SDA');
select dimension_code, count(*) as terms from asmt_catalogue_term group by dimension_code order by dimension_code;
select position_code, capability_code from hq_position_capability
 where position_code = 'assessment_catalogue_manager' and effective_to is null order by capability_code;
select count(*) as catalogue_appointments from ogs_office_appointments where role = 'assessment_catalogue_manager';

notify pgrst, 'reload schema';
