-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 760: FRAMEWORK AREAS, AND ORGANISATIONAL MOVES IN THE LAYOUT DRAFT OF A PUBLISHED FRAMEWORK
--
-- FRAMEWORK-DESIGN-STUDIO-02 slice S3 (owner GO 31 Oct 2026, rulings D1 and D3 with its refinement).
-- Build record: docs/evidence/FRAMEWORK-DESIGN-STUDIO-02/760-build-record.md
--
-- APPLY ON STAGING FIRST. ADDITIVE. One table, one nullable column with its index, one scope trigger function with
-- two triggers, and four redefined functions. No existing row is changed. Re-running it is a no-op.
-- OPS-001 s8: proposed Medium (new triggers on shared tables and redefined guard functions), so it carries a
-- staging rollback rehearsal.
-- Depends on 003 (frameworks, framework_domains, framework_competencies), 395 and 640 (clinical review and its
-- SoD guard), 466, 750, 751 and 752. Application order 750, 751, 752, 760. It refuses to run without 750 to 752.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT ADDS.
--
--   framework_areas           a configurable, organisational level above domains (ruling D1). Each framework names
--                             its own Areas (for example Clinical Practice and Professional Practice). Not in the
--                             clinical content hash (competency_content_hash is not touched). No profession or
--                             framework is named anywhere. Row level security and grants as framework_domains
--                             (003): RLS on, read for signed-in users, writes only by the server (service role).
--   framework_domains.area_id the Area of a domain, or null. On delete of the Area it becomes null. A domain may only
--                             sit in an Area of its own framework, and an Area never changes framework
--                             (framework_areas_scope_guard).
--
-- WHAT IT EXTENDS (ruling D3, organisational changes need no repeat clinical review).
--
--   The layout draft of a published framework (750, version 1) may also carry
--     areas        array of this framework Area ids, in display order (partial allowed, as domains)
--     domainAreas  object, domain id of this framework to an Area id of this framework, or null for no Area
--     areaNames    object, Area id of this framework to its new name (2 to 120 characters)
--   and a competency may now be listed under ANOTHER domain of the SAME framework in competencies. That is a move
--   of the competency to that domain. A competency is listed at most once across all domains.
--   Still refused, always: an id of another framework, a criterion under any competency but its own, and a section
--   change (not expressible). Those are substantive and go through revision drafts (S5), never a layout.
--
--   frameworks_layout_guard (750)               redefined. The key list, the competencies rule, and a final call to
--                                               framework_layout_problem for the new keys. Diff in the build record.
--   framework_layout_problem (752)              redefined with the same rules for the new keys, read against the
--                                               framework as it is now.
--   frameworks_layout_apply_on_publish (752)    redefined. In the same statement as the publication, after 466 and
--                                               640 accepted it, and before the renumbering, it also applies the
--                                               Area names (in two steps, so a swap of two names never meets the
--                                               unique name half way), the domain Areas and the competency moves.
--                                               Then it renumbers as before, plus the Areas when named and every
--                                               domain a competency left. A stale draft still refuses the whole
--                                               publication and nothing is applied in part.
--   clinical_review_decision_sod_guard (751)    redefined. The six organisational audit actions (create_area,
--                                               rename_area, delete_area, reorder_areas, set_domain_area,
--                                               move_competency_domain) join reorder_layout as NOT authorship
--                                               (F4). frameworks_sod_publication_guard (640) is NOT changed, so they
--                                               count as contribution and their author cannot publish them.
--
-- WHY THE 466 AND 640 GUARDS STILL DECIDE. Unchanged from 752. The apply trigger is AFTER ROW, 466 and 640 are
-- BEFORE ROW, so it runs only once both accepted the publication. Neither reads area_id, domain_id moves within a
-- framework or sort_order. competency_content_hash excludes domain_id, so a moved competency keeps its hash and
-- its clinical approval, and 640 counts the same competencies (the same framework) before and after.
--
-- NOT ACTIVATED. No Area exists and no draft carries the new keys until the S3 and S4 code ships behind its gate.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/FRAMEWORK-DESIGN-STUDIO-02/ROLLBACK-760.sql
-- ====================================================================================================

do $dep$
begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'frameworks'
        and column_name in ('layout_draft', 'layout_draft_by', 'layout_draft_at', 'component_order')) <> 4
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'framework_competencies' and column_name = 'learning_outcome_ids')
     or not exists (select 1 from pg_trigger where tgname = 'frameworks_layout_apply_on_publish' and tgrelid = 'frameworks'::regclass) then
    raise exception 'migration 760: apply 750, 751 and 752 first. Nothing was changed';
  end if;
end
$dep$;


-- ---- 1. the Area level ----------------------------------------------------------------------------------

create table if not exists framework_areas (
  id           uuid primary key default gen_random_uuid(),
  framework_id uuid not null references frameworks(id) on delete cascade,
  name         text not null,
  description  text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid references profiles(id) on delete set null,
  constraint framework_areas_name_check check (char_length(btrim(name)) between 2 and 120 and name = btrim(name)),
  constraint framework_areas_description_check check (description is null or char_length(btrim(description)) between 1 and 2000),
  constraint framework_areas_framework_name_key unique (framework_id, name)
);

alter table framework_areas enable row level security;

do $pol$ begin
  create policy "Auth users read areas"
    on framework_areas for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $pol$;

alter table framework_domains add column if not exists area_id uuid references framework_areas(id) on delete set null;
create index if not exists framework_domains_area_id_idx on framework_domains (area_id);

-- A domain sits only in an Area of its own framework, and an Area never changes framework.
create or replace function public.framework_areas_scope_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_table_name = 'framework_areas' then
    if new.framework_id is distinct from old.framework_id then
      raise exception 'framework_areas: an Area stays in the framework it was made in';
    end if;
    return new;
  end if;
  if new.area_id is not null
     and not exists (select 1 from framework_areas a where a.id = new.area_id and a.framework_id = new.framework_id) then
    raise exception 'framework_domains.area_id: the Area must belong to the same framework as the domain';
  end if;
  return new;
end;
$$;

drop trigger if exists framework_domains_area_scope on framework_domains;
create trigger framework_domains_area_scope
  before insert or update of area_id, framework_id on framework_domains
  for each row execute function public.framework_areas_scope_guard();

drop trigger if exists framework_areas_scope on framework_areas;
create trigger framework_areas_scope
  before update of framework_id on framework_areas
  for each row execute function public.framework_areas_scope_guard();


-- ---- 2. the layout rules, read against the framework as it is now (752 plus the new keys) ----------------

create or replace function public.framework_layout_problem(p_framework uuid, p_layout jsonb)
returns text
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  l jsonb := p_layout;
  k text;
  x jsonb;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if l is null then
    return null;
  end if;
  if jsonb_typeof(l) <> 'object' or (l -> 'v') is distinct from '1'::jsonb
     or exists (select 1 from jsonb_object_keys(l) j where j not in ('v', 'domains', 'competencies', 'criteria', 'componentOrder', 'areas', 'domainAreas', 'areaNames')) then
    return 'it is not a version 1 layout';
  end if;

  if l ? 'domains' then
    if jsonb_typeof(l -> 'domains') <> 'array'
       or exists (select 1 from jsonb_array_elements(l -> 'domains') e where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ uuid_re) then
      return 'its domains are not a list of domain ids';
    end if;
    if exists (select 1 from jsonb_array_elements_text(l -> 'domains') e
                where not exists (select 1 from framework_domains d where d.id = e::uuid and d.framework_id = p_framework)) then
      return 'a domain it names is no longer in this framework';
    end if;
    if (select count(*) - count(distinct e) from jsonb_array_elements_text(l -> 'domains') e) > 0 then
      return 'a domain is named twice';
    end if;
  end if;

  -- Competencies: a domain of this framework to competencies of this framework. One listed under another domain of
  -- the same framework is moved there (organisational, ruling D3). Each is listed once across all domains.
  if l ? 'competencies' then
    if jsonb_typeof(l -> 'competencies') <> 'object' then
      return 'its competencies are not a map of domain to competency ids';
    end if;
    for k, x in select * from jsonb_each(l -> 'competencies') loop
      if k !~ uuid_re or jsonb_typeof(x) <> 'array'
         or exists (select 1 from jsonb_array_elements(x) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ uuid_re) then
        return 'its competencies are not a map of domain to competency ids';
      end if;
      if not exists (select 1 from framework_domains d where d.id = k::uuid and d.framework_id = p_framework) then
        return 'a domain it orders competencies in is no longer in this framework';
      end if;
      if exists (select 1 from jsonb_array_elements_text(x) e
                  where not exists (select 1 from framework_competencies c join framework_domains d on d.id = c.domain_id
                                     where c.id = e::uuid and d.framework_id = p_framework)) then
        return 'a competency it names is no longer in this framework';
      end if;
    end loop;
    if (select count(*) - count(distinct e) from jsonb_each(l -> 'competencies') m, jsonb_array_elements_text(m.value) e) > 0 then
      return 'a competency is named twice';
    end if;
  end if;

  if l ? 'criteria' then
    if jsonb_typeof(l -> 'criteria') <> 'object' then
      return 'its criteria are not a map of competency to criterion ids';
    end if;
    for k, x in select * from jsonb_each(l -> 'criteria') loop
      if k !~ uuid_re or jsonb_typeof(x) <> 'array'
         or exists (select 1 from jsonb_array_elements(x) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ uuid_re) then
        return 'its criteria are not a map of competency to criterion ids';
      end if;
      if not exists (select 1 from framework_competencies c join framework_domains d on d.id = c.domain_id
                      where c.id = k::uuid and d.framework_id = p_framework) then
        return 'a competency it orders criteria in is no longer in this framework';
      end if;
      if exists (select 1 from jsonb_array_elements_text(x) e
                  where not exists (select 1 from competency_skills s where s.id = e::uuid and s.competency_id = k::uuid)) then
        return 'a criterion it names is no longer of that competency';
      end if;
      if (select count(*) - count(distinct e) from jsonb_array_elements_text(x) e) > 0 then
        return 'a criterion is named twice';
      end if;
    end loop;
  end if;

  if l ? 'componentOrder' and jsonb_typeof(l -> 'componentOrder') <> 'null' then
    if jsonb_typeof(l -> 'componentOrder') <> 'array' or jsonb_array_length(l -> 'componentOrder') not between 1 and 100
       or exists (select 1 from jsonb_array_elements(l -> 'componentOrder') e where jsonb_typeof(e) <> 'string') then
      return 'its section order is not a list of section codes';
    end if;
    if exists (select 1 from jsonb_array_elements_text(l -> 'componentOrder') e
                where not exists (select 1 from competency_assessment_component a where a.code = e)) then
      return 'a section it names is no longer in the component registry';
    end if;
    if (select count(*) - count(distinct e) from jsonb_array_elements_text(l -> 'componentOrder') e) > 0 then
      return 'a section is named twice';
    end if;
  end if;

  -- Areas (760): this framework own, each once.
  if l ? 'areas' then
    if jsonb_typeof(l -> 'areas') <> 'array'
       or exists (select 1 from jsonb_array_elements(l -> 'areas') e where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ uuid_re) then
      return 'its areas are not a list of Area ids';
    end if;
    if exists (select 1 from jsonb_array_elements_text(l -> 'areas') e
                where not exists (select 1 from framework_areas a where a.id = e::uuid and a.framework_id = p_framework)) then
      return 'an Area it names is no longer in this framework';
    end if;
    if (select count(*) - count(distinct e) from jsonb_array_elements_text(l -> 'areas') e) > 0 then
      return 'an Area is named twice';
    end if;
  end if;

  -- The Area of a domain (760): a domain of this framework to an Area of this framework, or null.
  if l ? 'domainAreas' then
    if jsonb_typeof(l -> 'domainAreas') <> 'object'
       or exists (select 1 from jsonb_each(l -> 'domainAreas') m where m.key !~ uuid_re
                    or (jsonb_typeof(m.value) <> 'null' and (jsonb_typeof(m.value) <> 'string' or (m.value #>> '{}') !~ uuid_re))) then
      return 'its domain Areas are not a map of domain id to Area id or null';
    end if;
    if exists (select 1 from jsonb_each(l -> 'domainAreas') m
                where not exists (select 1 from framework_domains d where d.id = m.key::uuid and d.framework_id = p_framework)) then
      return 'a domain it places in an Area is no longer in this framework';
    end if;
    if exists (select 1 from jsonb_each(l -> 'domainAreas') m where jsonb_typeof(m.value) = 'string'
                 and not exists (select 1 from framework_areas a where a.id = (m.value #>> '{}')::uuid and a.framework_id = p_framework)) then
      return 'an Area it places a domain in is no longer in this framework';
    end if;
  end if;

  -- New Area names (760): an Area of this framework to a name of 2 to 120 characters, and no two Areas end up with
  -- the same name.
  if l ? 'areaNames' then
    if jsonb_typeof(l -> 'areaNames') <> 'object'
       or exists (select 1 from jsonb_each(l -> 'areaNames') m where m.key !~ uuid_re or jsonb_typeof(m.value) <> 'string'
                    or char_length(btrim(m.value #>> '{}')) not between 2 and 120) then
      return 'its Area names are not a map of Area id to a name of 2 to 120 characters';
    end if;
    if exists (select 1 from jsonb_each(l -> 'areaNames') m
                where not exists (select 1 from framework_areas a where a.id = m.key::uuid and a.framework_id = p_framework)) then
      return 'an Area it renames is no longer in this framework';
    end if;
    if (select count(*) - count(distinct nm) from (
          select coalesce(btrim(l -> 'areaNames' ->> a.id::text), a.name) as nm from framework_areas a where a.framework_id = p_framework) z) > 0 then
      return 'two Areas would have the same name';
    end if;
  end if;
  return null;
end;
$$;


-- ---- 3. the save guard (the 750 body, the key list and competencies rule changed, the new keys checked) --------

create or replace function public.frameworks_layout_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  l jsonb := new.layout_draft;
  k text;
  x jsonb;
  v_bad integer;
  v_problem text;
begin
  -- The section order of this framework: registry codes, each once.
  if new.component_order is not null and (tg_op = 'INSERT' or new.component_order is distinct from old.component_order) then
    if (select count(distinct c) from unnest(new.component_order) c) <> cardinality(new.component_order) then
      raise exception 'frameworks.component_order: a section is named twice';
    end if;
    if exists (select 1 from unnest(new.component_order) c where not exists (select 1 from competency_assessment_component a where a.code = c)) then
      raise exception 'frameworks.component_order: a section is not in the component registry';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.layout_draft is not distinct from old.layout_draft then
    return new;
  end if;
  if l is null then
    new.layout_draft_by := null;
    new.layout_draft_at := null;
    return new;
  end if;
  new.layout_draft_at := now();
  if new.layout_draft_by is null then
    raise exception 'frameworks.layout_draft: a layout draft records who saved it';
  end if;
  if jsonb_typeof(l) <> 'object' or (l -> 'v') is distinct from '1'::jsonb
     or exists (select 1 from jsonb_object_keys(l) j where j not in ('v', 'domains', 'competencies', 'criteria', 'componentOrder', 'areas', 'domainAreas', 'areaNames')) then
    raise exception 'frameworks.layout_draft: not a version 1 layout (keys v, domains, competencies, criteria, componentOrder, areas, domainAreas, areaNames)';
  end if;

  -- Domains: this framework own, each once.
  if l ? 'domains' then
    if jsonb_typeof(l -> 'domains') <> 'array' or exists (select 1 from jsonb_array_elements(l -> 'domains') e where jsonb_typeof(e) <> 'string'
         or (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'frameworks.layout_draft: domains is a list of domain ids';
    end if;
    select count(*) - count(distinct e) + count(*) filter (where not exists (
             select 1 from framework_domains d where d.id = (e #>> '{}')::uuid and d.framework_id = new.id))
      into v_bad from jsonb_array_elements(l -> 'domains') e;
    if v_bad > 0 then
      raise exception 'frameworks.layout_draft: a domain is repeated or is not one of this framework';
    end if;
  end if;

  -- Competencies: of this framework, under a domain of this framework. Another domain of the same framework is an
  -- organisational move (760, ruling D3). Another framework is refused.
  if l ? 'competencies' then
    if jsonb_typeof(l -> 'competencies') <> 'object' then
      raise exception 'frameworks.layout_draft: competencies maps a domain id to a list of its competency ids';
    end if;
    for k, x in select * from jsonb_each(l -> 'competencies') loop
      if k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(x) <> 'array'
         or not exists (select 1 from framework_domains d where d.id = k::uuid and d.framework_id = new.id)
         or exists (select 1 from jsonb_array_elements(x) e where jsonb_typeof(e) <> 'string'
              or (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        raise exception 'frameworks.layout_draft: competencies maps a domain of this framework to a list of competency ids';
      end if;
      select count(*) - count(distinct e) + count(*) filter (where not exists (
               select 1 from framework_competencies c join framework_domains d on d.id = c.domain_id
                where c.id = (e #>> '{}')::uuid and d.framework_id = new.id))
        into v_bad from jsonb_array_elements(x) e;
      if v_bad > 0 then
        raise exception 'frameworks.layout_draft: a competency is repeated or is not of this framework';
      end if;
    end loop;
  end if;

  -- Criteria: under their own competency only, and that competency is in this framework.
  if l ? 'criteria' then
    if jsonb_typeof(l -> 'criteria') <> 'object' then
      raise exception 'frameworks.layout_draft: criteria maps a competency id to a list of its criterion ids';
    end if;
    for k, x in select * from jsonb_each(l -> 'criteria') loop
      if k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(x) <> 'array'
         or not exists (select 1 from framework_competencies c join framework_domains d on d.id = c.domain_id where c.id = k::uuid and d.framework_id = new.id)
         or exists (select 1 from jsonb_array_elements(x) e where jsonb_typeof(e) <> 'string'
              or (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        raise exception 'frameworks.layout_draft: criteria maps a competency of this framework to a list of criterion ids';
      end if;
      select count(*) - count(distinct e) + count(*) filter (where not exists (
               select 1 from competency_skills s where s.id = (e #>> '{}')::uuid and s.competency_id = k::uuid))
        into v_bad from jsonb_array_elements(x) e;
      if v_bad > 0 then
        raise exception 'frameworks.layout_draft: a criterion is repeated or is not of that competency. Moving a criterion is a clinical change';
      end if;
    end loop;
  end if;

  -- The pending section order: registry codes, each once, or null.
  if l ? 'componentOrder' and jsonb_typeof(l -> 'componentOrder') <> 'null' then
    if jsonb_typeof(l -> 'componentOrder') <> 'array' or jsonb_array_length(l -> 'componentOrder') not between 1 and 100
       or exists (select 1 from jsonb_array_elements(l -> 'componentOrder') e where jsonb_typeof(e) <> 'string') then
      raise exception 'frameworks.layout_draft: componentOrder is a list of component codes, or null';
    end if;
    select count(*) - count(distinct e) + count(*) filter (where not exists (
             select 1 from competency_assessment_component a where a.code = (e #>> '{}')))
      into v_bad from jsonb_array_elements(l -> 'componentOrder') e;
    if v_bad > 0 then
      raise exception 'frameworks.layout_draft: a section is repeated or is not in the component registry';
    end if;
  end if;

  -- 760: Areas, domain Areas, Area names and a competency listed twice, by the rules of framework_layout_problem.
  v_problem := public.framework_layout_problem(new.id, l);
  if v_problem is not null then
    raise exception 'frameworks.layout_draft: %', v_problem;
  end if;
  return new;
end;
$$;


-- ---- 4. applied in the publication statement (the 752 body plus Areas, domain Areas and moves) --------------

create or replace function public.frameworks_layout_apply_on_publish()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  l jsonb := new.layout_draft;
  v_problem text;
  k text;
  v_codes text[];
  v_left uuid[] := '{}';
begin
  -- Defence in depth (the WHEN clause already says so): only a publication with a pending layout.
  if l is null or new.pub_status is distinct from 'published'
     or (old.pub_status is not distinct from 'published'
         and new.version_major is not distinct from old.version_major and new.version_minor is not distinct from old.version_minor
         and new.version_revision is not distinct from old.version_revision) then
    return null;
  end if;

  v_problem := public.framework_layout_problem(new.id, l);
  if v_problem is not null then
    raise exception 'framework layout at publication: the pending layout is out of date, %. Nothing was published and the layout draft is kept. Discard it or save the layout again, then put the framework forward again', v_problem;
  end if;

  -- 760: Area names, in two steps so that a swap of two names never meets the unique name half way.
  if l ? 'areaNames' then
    update framework_areas a set name = a.id::text
      from jsonb_each_text(l -> 'areaNames') n(id, nm)
     where a.id = n.id::uuid and a.framework_id = new.id and a.name is distinct from btrim(n.nm);
    update framework_areas a set name = btrim(n.nm)
      from jsonb_each_text(l -> 'areaNames') n(id, nm)
     where a.id = n.id::uuid and a.framework_id = new.id and a.name is distinct from btrim(n.nm);
  end if;

  -- 760: the Area of each named domain.
  if l ? 'domainAreas' then
    update framework_domains d set area_id = case when jsonb_typeof(m.value) = 'null' then null else (m.value #>> '{}')::uuid end
      from jsonb_each(l -> 'domainAreas') m
     where d.id = m.key::uuid and d.framework_id = new.id
       and d.area_id is distinct from (case when jsonb_typeof(m.value) = 'null' then null else (m.value #>> '{}')::uuid end);
  end if;

  -- 760: a competency listed under another domain of this framework moves there. The domains it left are renumbered.
  if l ? 'competencies' then
    select coalesce(array_agg(distinct c.domain_id), '{}') into v_left
      from framework_competencies c
      join (select m.key::uuid as domain_id, e::uuid as id from jsonb_each(l -> 'competencies') m, jsonb_array_elements_text(m.value) e) t on t.id = c.id
     where c.domain_id <> t.domain_id;
    update framework_competencies c set domain_id = t.domain_id
      from (select m.key::uuid as domain_id, e::uuid as id from jsonb_each(l -> 'competencies') m, jsonb_array_elements_text(m.value) e) t
     where c.id = t.id and c.domain_id <> t.domain_id;
  end if;

  if l ? 'areas' then
    update framework_areas a set sort_order = r.rn
      from (select fa.id, row_number() over (order by n.ord nulls last, fa.sort_order, fa.name, fa.id)::int as rn
              from framework_areas fa
              left join jsonb_array_elements_text(l -> 'areas') with ordinality n(id, ord) on n.id::uuid = fa.id
             where fa.framework_id = new.id) r
     where a.id = r.id and a.sort_order is distinct from r.rn;
  end if;

  if l ? 'domains' then
    update framework_domains d set sort_order = r.rn
      from (select fd.id, row_number() over (order by n.ord nulls last, fd.sort_order nulls last, fd.name, fd.id)::int as rn
              from framework_domains fd
              left join jsonb_array_elements_text(l -> 'domains') with ordinality n(id, ord) on n.id::uuid = fd.id
             where fd.framework_id = new.id) r
     where d.id = r.id and d.sort_order is distinct from r.rn;
  end if;

  if l ? 'competencies' then
    for k in select jsonb_object_keys(l -> 'competencies') union select unnest(v_left)::text loop
      update framework_competencies c set sort_order = r.rn
        from (select fc.id, row_number() over (order by n.ord nulls last, fc.sort_order nulls last, fc.name, fc.id)::int as rn
                from framework_competencies fc
                left join jsonb_array_elements_text(l -> 'competencies' -> k) with ordinality n(id, ord) on n.id::uuid = fc.id
               where fc.domain_id = k::uuid) r
       where c.id = r.id and c.sort_order is distinct from r.rn;
    end loop;
  end if;

  if l ? 'criteria' then
    for k in select jsonb_object_keys(l -> 'criteria') loop
      update competency_skills s set sort_order = r.rn
        from (select cs.id, row_number() over (order by n.ord nulls last, cs.sort_order nulls last, cs.name, cs.id)::int as rn
                from competency_skills cs
                left join jsonb_array_elements_text(l -> 'criteria' -> k) with ordinality n(id, ord) on n.id::uuid = cs.id
               where cs.competency_id = k::uuid) r
       where s.id = r.id and s.sort_order is distinct from r.rn;
    end loop;
  end if;

  if l ? 'componentOrder' then
    if jsonb_typeof(l -> 'componentOrder') = 'null' then
      v_codes := null;
    else
      select array_agg(a.code order by n.ord nulls last, a.sort_order, a.code) into v_codes
        from competency_assessment_component a
        left join jsonb_array_elements_text(l -> 'componentOrder') with ordinality n(code, ord) on n.code = a.code;
    end if;
    update frameworks set component_order = v_codes, layout_draft = null, layout_draft_by = null, layout_draft_at = null
     where id = new.id;
  else
    update frameworks set layout_draft = null, layout_draft_by = null, layout_draft_at = null where id = new.id;
  end if;
  return null;
end;
$$;


-- ---- 5. F4: organisational changes are contribution, not authorship (the 751 body plus six actions) -----------

create or replace function public.clinical_review_decision_sod_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v clinical_content_version%rowtype;
  v_conflict boolean := false;
  v_parent uuid;
begin
  select * into v from clinical_content_version where id = new.version_id;
  if not found then
    return new;
  end if;
  -- Every version of the same subject, whatever was recorded on this one.
  v_conflict := exists (
    select 1 from clinical_content_version o
     where (new.reviewer_id = o.submitted_by or new.reviewer_id = any(o.authored_by))
       and ((v.content_kind = 'competency' and o.competency_id = v.competency_id)
         or (v.content_kind = 'case' and o.case_version_id in (select cv.id from case_library_version cv
               where cv.case_id = (select x.case_id from case_library_version x where x.id = v.case_version_id)))
         or (v.content_kind = 'resource' and o.knowledge_version_id in (select kv.id from ckri_knowledge_version kv
               where kv.resource_id = (select x.resource_id from ckri_knowledge_version x where x.id = v.knowledge_version_id)))
         or (v.content_kind = 'learning' and o.learning_version_id in (select lv.id from learning_offering_version lv
               where lv.offering_id = (select x.offering_id from learning_offering_version x where x.id = v.learning_version_id)))));

  if not v_conflict and v.content_kind = 'competency' then
    -- The audit trail of the competency and its framework, as authorsOf reads it (src/lib/competency/clinical-review.ts).
    select d.framework_id into v_parent from framework_competencies c join framework_domains d on d.id = c.domain_id where c.id = v.competency_id;
    v_conflict := exists (
      select 1 from audit_log a
       where a.actor_id = new.reviewer_id and a.entity_id in (v.competency_id, v_parent)
         and coalesce(a.action, '') not in ('submit_review', 'approve_content', 'reject_content', 'publish', 'archive', 'revert',
           'catalogue_entry_add', 'catalogue_entry_status', 'catalogue_entry_remove', 'catalogue_entry_review',
           'clinical_review_submitted', 'clinical_review_decided', 'clinical_scope_added', 'clinical_scope_ended', 'framework_specialty_set',
           'reorder_layout', 'create_area', 'rename_area', 'delete_area', 'reorder_areas', 'set_domain_area', 'move_competency_domain'));
  elsif not v_conflict and v.content_kind = 'case' then
    v_conflict := exists (select 1 from case_library_version cv
      where cv.case_id = (select x.case_id from case_library_version x where x.id = v.case_version_id)
        and (new.reviewer_id = any(cv.authored_by) or new.reviewer_id is not distinct from cv.submitted_by));
  elsif not v_conflict and v.content_kind = 'resource' then
    v_conflict := exists (select 1 from ckri_knowledge_version kv
      where kv.resource_id = (select x.resource_id from ckri_knowledge_version x where x.id = v.knowledge_version_id)
        and (new.reviewer_id = any(kv.authored_by) or new.reviewer_id is not distinct from kv.submitted_by
          or new.reviewer_id is not distinct from kv.educator_reviewed_by));
  elsif not v_conflict and v.content_kind = 'learning' then
    v_conflict := exists (select 1 from learning_offering_version lv
      where lv.offering_id = (select x.offering_id from learning_offering_version x where x.id = v.learning_version_id)
        and (new.reviewer_id = any(lv.authored_by) or new.reviewer_id is not distinct from lv.submitted_by));
  end if;

  if v_conflict then
    raise exception 'clinical_review_decision: not independent. The reviewer authored, edited or submitted this content or an earlier version of it';
  end if;
  return new;
end;
$$;


revoke execute on function public.framework_layout_problem(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.frameworks_layout_apply_on_publish() from public, anon, authenticated;
revoke execute on function public.framework_areas_scope_guard() from public, anon, authenticated;
grant execute on function public.framework_layout_problem(uuid, jsonb) to service_role;

comment on table framework_areas is
  '760: the configurable organisational Area level above domains, named per framework. Not in the clinical content hash. Ruling D1.';
comment on column framework_domains.area_id is
  '760: the Area of this domain (same framework, framework_areas_scope_guard), or null. Organisational.';
comment on function public.frameworks_layout_apply_on_publish() is
  '752, 760: applies frameworks.layout_draft (order, Areas, Area names, domain Areas, competency moves within the framework) and clears it, in the same statement as a publication, after the 466 and 640 BEFORE guards accepted it. A stale layout refuses the publication.';


-- Verification: the table, the column, the scope triggers, the redefined functions, and no Area or draft yet.
select 'table' as item, count(*)::text as value from information_schema.tables where table_schema = 'public' and table_name = 'framework_areas'
union all select 'area_id', count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'framework_domains' and column_name = 'area_id'
union all select 'scope_triggers', count(*)::text from pg_trigger where tgname in ('framework_domains_area_scope', 'framework_areas_scope')
union all select 'rls', (select relrowsecurity::text from pg_class where oid = 'framework_areas'::regclass)
union all select 'areas', count(*)::text from framework_areas
union all select 'with_layout', count(*)::text from frameworks where layout_draft is not null;

notify pgrst, 'reload schema';
