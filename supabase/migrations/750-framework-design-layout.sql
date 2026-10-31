-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains a plpgsql trigger function between dollar quotes. A runner that splits on
-- the statement separator would cut the function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 750: FRAMEWORK DESIGN STUDIO, THE LAYOUT DRAFT AND THE PER-FRAMEWORK SECTION ORDER
--
-- FRAMEWORK-DESIGN-STUDIO-01 slice A (owner GO 31 Oct 2026, rulings 2, 3 and 6).
-- Build record: docs/evidence/FRAMEWORK-DESIGN-STUDIO/750-build-record.md
--
-- APPLY ON STAGING FIRST. ADDITIVE. Four nullable columns on frameworks, their checks, one trigger function and
-- one trigger. No row is changed. Re-running it is a no-op. OPS-001 s8: proposed Medium (a new trigger on a
-- shared table), so it carries a staging rollback rehearsal.
-- Depends on 007 (frameworks, framework_domains, framework_competencies, competency_skills), 384, 660
-- (competency_assessment_component) and 670 (competency_skills.component_code).
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT ADDS.
--
--   frameworks.layout_draft      the pending PRESENTATION order of a published framework, held until a separate
--                                publisher applies it as a revision (ruling 3). Null means no pending layout.
--                                Learners keep reading the live sort_order until then. Shape, version 1
--                                  v              the number 1
--                                  domains        array of this framework domain ids, in display order
--                                  competencies   object, domain id to an array of that domain competency ids
--                                  criteria       object, competency id to an array of that competency skill ids
--                                  componentOrder array of component codes, or null for the registry order
--                                Every key except v is optional. A list may be partial, and the app appends
--                                what it does not name in its current order.
--   frameworks.layout_draft_by   who last saved the layout draft (for the contributor display and SoD).
--   frameworks.layout_draft_at   when, set by the database.
--   frameworks.component_order   the order of the sections (criterion components) for THIS framework. Null
--                                means the global registry order of competency_assessment_component (660).
--
-- WHAT THE DATABASE REFUSES (frameworks_layout_guard, on every write of these columns, by every writer).
--   A layout draft that is not an object of the shape above, larger than 512 KB, or naming a domain that is not
--   this framework own, a competency under any domain but its own, or a skill under any competency but its own.
--   So a layout draft can never move a competency to another domain or a criterion to another competency:
--   those are clinical changes (ruling 2) and go through content editing and clinical review. A criterion
--   section is its component_code, which a layout never carries, so a section move is not expressible either.
--   A component order or componentOrder that repeats a code or names a code not in the registry.
--   A layout draft saved without its author.
--
-- NOT ACTIVATED. Nothing reads these columns until the slice B code ships behind its gate.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/FRAMEWORK-DESIGN-STUDIO/ROLLBACK-750.sql
-- ====================================================================================================

alter table frameworks add column if not exists layout_draft jsonb;
alter table frameworks add column if not exists layout_draft_by uuid references profiles(id) on delete set null;
alter table frameworks add column if not exists layout_draft_at timestamptz;
alter table frameworks add column if not exists component_order text[];

alter table frameworks drop constraint if exists frameworks_layout_draft_check;
alter table frameworks add constraint frameworks_layout_draft_check check (
  (layout_draft is null and layout_draft_by is null and layout_draft_at is null)
  or (layout_draft is not null
      and jsonb_typeof(layout_draft) = 'object'
      and octet_length(layout_draft::text) <= 524288
      and layout_draft_at is not null)
);

alter table frameworks drop constraint if exists frameworks_component_order_check;
alter table frameworks add constraint frameworks_component_order_check check (
  component_order is null or (cardinality(component_order) between 1 and 100 and array_position(component_order, null) is null)
);

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

drop trigger if exists frameworks_layout_guard on frameworks;
create trigger frameworks_layout_guard
  before insert or update of layout_draft, layout_draft_by, component_order on frameworks
  for each row execute function public.frameworks_layout_guard();

comment on column frameworks.layout_draft is
  '750: pending presentation order of a published framework, v1 {v, domains, competencies, criteria, componentOrder}. Applied by a separate publisher as a revision. Null = none.';
comment on column frameworks.component_order is
  '750: section (criterion component) order for this framework. Null = the competency_assessment_component registry order.';


-- Verification: the four columns, the two checks, the trigger, and no framework with a layout yet.
select 'columns' as item, count(*)::text as value from information_schema.columns
 where table_schema = 'public' and table_name = 'frameworks' and column_name in ('layout_draft', 'layout_draft_by', 'layout_draft_at', 'component_order')
union all select 'checks', count(*)::text from pg_constraint where conname in ('frameworks_layout_draft_check', 'frameworks_component_order_check')
union all select 'trigger', count(*)::text from pg_trigger where tgname = 'frameworks_layout_guard'
union all select 'with_layout', count(*)::text from frameworks where layout_draft is not null or component_order is not null;

notify pgrst, 'reload schema';
