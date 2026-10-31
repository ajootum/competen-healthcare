-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 752: FRAMEWORK DESIGN STUDIO, A PENDING LAYOUT IS APPLIED IN THE SAME TRANSACTION AS ITS PUBLICATION
--
-- FRAMEWORK-DESIGN-STUDIO-01 (owner GO 31 Oct 2026, ruling 3). Fix forward of slice B, which applied a pending
-- layout from the app with several writes before the publication and undid them if it was refused. Those writes
-- were not one transaction, so a crash between them could leave the new live order under the old version.
-- Build record: docs/evidence/FRAMEWORK-DESIGN-STUDIO/752-build-record.md
--
-- APPLY ON STAGING FIRST. ADDITIVE. Three functions and one trigger. No row is changed. Re-running it is a no-op.
-- Depends on 750 (frameworks.layout_draft, layout_draft_by, layout_draft_at, component_order and the
-- frameworks_layout_guard trigger), 751 (shipped with 750), 466 (trg_cfca_framework_publication_guard) and 640
-- (trg_frameworks_sod_publication_guard). Application order 750, 751, 752.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT ADDS.
--
--   framework_layout_problem(framework, layout)   why a layout can no longer be applied as it stands, or null.
--                                The same id rules as the 750 guard, read against the framework as it is NOW. A
--                                domain, competency or criterion the layout names that was deleted or moved, or
--                                a section no longer in the registry, makes the layout stale.
--   framework_layout_check(framework)             that problem for the stored layout draft, or null (none, or
--                                fine). The app calls it before a publication, and its presence tells the app
--                                that 752 is applied.
--   frameworks_layout_apply_on_publish            AFTER UPDATE OF pub_status, version_major, version_minor,
--                                version_revision on frameworks, for each row, only when the row has a layout
--                                draft and the update is a PUBLICATION. A publication is what 640 treats as one,
--                                the row becoming published, or a published row taking a new version (a
--                                republication). Then, inside the same statement and so the same transaction
--                                  1  a stale layout refuses the whole update with a clear message. Nothing is
--                                     applied in part, the publication does not happen and the draft stays.
--                                  2  each parent the layout names is renumbered densely 1..n. Named ids first in
--                                     the layout order, then what it does not name in the current stable order
--                                     (sort_order, name, id). domains renumbers the framework domains,
--                                     competencies per named domain, criteria (competency_skills) per named
--                                     competency. Rows already at their number are not written.
--                                  3  componentOrder, when present, becomes frameworks.component_order (null
--                                     stays null, a list becomes the full registry with the named codes first).
--                                  4  layout_draft, layout_draft_by and layout_draft_at are cleared.
--
-- WHY AFTER, AND WHY THE 466 AND 640 GUARDS STILL DECIDE. Both guards are BEFORE row triggers on frameworks. Every
-- BEFORE row trigger runs before the row is written, and AFTER row triggers run only for a row that was written. So
-- whatever its name, this trigger runs only once 466, 640 and the 750 guard have all accepted the row. If either
-- guard refuses, or a BEFORE trigger skips the row, this never runs, no order is touched and the draft stays.
-- Neither guard reads sort_order or component_order, so applying the layout after them cannot change what they
-- decided. If this trigger refuses (a stale layout), the error ends the statement and the publication, the
-- version label and the published_by stamp all roll back with it.
-- The renumbering and the clearing of the draft are plain updates. The clearing update sets only the layout
-- columns and component_order, so only the 750 guard fires on it (and validates component_order), never 466, 640
-- or this trigger again.
--
-- SECURITY DEFINER for the trigger function only, so that a publication accepted on the row is applied to EVERY
-- child row the layout names, whatever the row level security of the writer (otherwise a writer who cannot see a
-- child row would publish a layout applied in part). It writes nothing but the sort_order of this framework own
-- rows and its own layout columns, after the guards above have accepted the publication. search_path is fixed.
--
-- NOT ACTIVATED. No row has a layout draft until the slice B and C code ships behind its gate.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/FRAMEWORK-DESIGN-STUDIO/ROLLBACK-752.sql
-- ====================================================================================================

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

create or replace function public.framework_layout_check(p_framework_id uuid)
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select public.framework_layout_problem(f.id, f.layout_draft) from frameworks f
   where f.id = p_framework_id and f.layout_draft is not null
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

drop trigger if exists frameworks_layout_apply_on_publish on frameworks;
create trigger frameworks_layout_apply_on_publish
  after update of pub_status, version_major, version_minor, version_revision on frameworks
  for each row
  when (new.layout_draft is not null and new.pub_status = 'published'
        and (old.pub_status is distinct from 'published'
             or new.version_major is distinct from old.version_major
             or new.version_minor is distinct from old.version_minor
             or new.version_revision is distinct from old.version_revision))
  execute function public.frameworks_layout_apply_on_publish();

revoke execute on function public.framework_layout_check(uuid) from public, anon, authenticated;
revoke execute on function public.framework_layout_problem(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.frameworks_layout_apply_on_publish() from public, anon, authenticated;
grant execute on function public.framework_layout_check(uuid) to service_role;
grant execute on function public.framework_layout_problem(uuid, jsonb) to service_role;

comment on function public.frameworks_layout_apply_on_publish() is
  '752: applies frameworks.layout_draft to the live order and clears it, in the same statement as a publication (first or republication), after the 466 and 640 BEFORE guards accepted it. A stale layout refuses the publication.';
comment on function public.framework_layout_check(uuid) is
  '752: why the stored layout draft of a framework can no longer be applied, or null. Its presence marks 752 as applied.';


-- Verification: the three functions, the trigger is AFTER and row level, and no framework has a layout yet.
select 'functions' as item, count(*)::text as value from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('framework_layout_problem', 'framework_layout_check', 'frameworks_layout_apply_on_publish')
union all select 'trigger_after_row', count(*)::text from pg_trigger
 where tgname = 'frameworks_layout_apply_on_publish' and tgrelid = 'frameworks'::regclass and (tgtype & 2) = 0 and (tgtype & 1) = 1
union all select 'with_layout', count(*)::text from frameworks where layout_draft is not null;

notify pgrst, 'reload schema';
