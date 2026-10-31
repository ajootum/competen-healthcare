-- ====================================================================================================
-- APPLY THIS FILE WHOLE. ROLLBACK-760, STAGING ONLY. It contains plpgsql functions between dollar quotes.
-- Removes migration 760: the Area table, framework_domains.area_id, the scope triggers, and restores the four
-- redefined functions to their source bodies, copied verbatim from the files that last defined them
-- (frameworks_layout_guard from 750, clinical_review_decision_sod_guard from 751, framework_layout_problem and
-- frameworks_layout_apply_on_publish from 752). A layout draft must not carry a 760 key when this runs, so it
-- refuses while one does. Re-running it is a no-op.
-- ====================================================================================================

do $chk$
begin
  if exists (select 1 from frameworks where layout_draft ?| array['areas', 'domainAreas', 'areaNames']) then
    raise exception 'ROLLBACK-760: a layout draft carries Areas. Discard it first. Nothing was changed';
  end if;
end
$chk$;

drop trigger if exists framework_domains_area_scope on framework_domains;
drop trigger if exists framework_areas_scope on framework_areas;
drop function if exists public.framework_areas_scope_guard();
drop index if exists framework_domains_area_id_idx;
alter table framework_domains drop column if exists area_id;
drop table if exists framework_areas;

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
     or exists (select 1 from jsonb_object_keys(l) j where j not in ('v', 'domains', 'competencies', 'criteria', 'componentOrder')) then
    raise exception 'frameworks.layout_draft: not a version 1 layout (keys v, domains, competencies, criteria, componentOrder)';
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

  -- Competencies: under their own domain only (moving one to another domain is a clinical change).
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
               select 1 from framework_competencies c where c.id = (e #>> '{}')::uuid and c.domain_id = k::uuid))
        into v_bad from jsonb_array_elements(x) e;
      if v_bad > 0 then
        raise exception 'frameworks.layout_draft: a competency is repeated or is not in that domain. Moving a competency to another domain is a clinical change';
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
  return new;
end;
$$;


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
           'reorder_layout'));
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
     or exists (select 1 from jsonb_object_keys(l) j where j not in ('v', 'domains', 'competencies', 'criteria', 'componentOrder')) then
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
                  where not exists (select 1 from framework_competencies c where c.id = e::uuid and c.domain_id = k::uuid)) then
        return 'a competency it names is no longer in that domain';
      end if;
      if (select count(*) - count(distinct e) from jsonb_array_elements_text(x) e) > 0 then
        return 'a competency is named twice';
      end if;
    end loop;
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
  return null;
end;
$$;


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

  if l ? 'domains' then
    update framework_domains d set sort_order = r.rn
      from (select fd.id, row_number() over (order by n.ord nulls last, fd.sort_order nulls last, fd.name, fd.id)::int as rn
              from framework_domains fd
              left join jsonb_array_elements_text(l -> 'domains') with ordinality n(id, ord) on n.id::uuid = fd.id
             where fd.framework_id = new.id) r
     where d.id = r.id and d.sort_order is distinct from r.rn;
  end if;

  if l ? 'competencies' then
    for k in select jsonb_object_keys(l -> 'competencies') loop
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


comment on function public.frameworks_layout_apply_on_publish() is
  '752: applies frameworks.layout_draft to the live order and clears it, in the same statement as a publication (first or republication), after the 466 and 640 BEFORE guards accepted it. A stale layout refuses the publication.';

notify pgrst, 'reload schema';
