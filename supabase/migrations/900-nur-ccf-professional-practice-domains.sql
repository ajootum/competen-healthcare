-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one plpgsql DO block between dollar quotes. A runner that splits on the
-- statement separator would cut the block in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 900: NUR-CCF PROFESSIONAL PRACTICE AS TWELVE DOMAINS (DATA ONLY)
--
-- Owner GO 3 Nov 2026 (shape A): the shared framework NUR-CCF (Competen Nursing Competency Framework) shows the
-- Professional Practice Area as twelve domains, one per PP competency, each holding that one competency and its
-- existing assessment criteria. Before: one domain "Professional Practice" with the twelve competencies PP-01 to
-- PP-12 inside it. After: twelve domains coded PP-01 to PP-12 (named after the competency) in the Area, the
-- competency moved into its domain, the emptied source domain removed. 13 Clinical Practice domains plus 12 equals
-- the 25 domains the owner asked for.
--
-- APPLY ON STAGING FIRST. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. It changes no table, column,
-- policy, function or grant. It writes rows in framework_domains (insert), framework_competencies (domain_id and
-- sort_order of the twelve), framework_areas (only if the Area is missing), audit_log (one row when something
-- moved) and deletes the one emptied domain. No competency, criterion, mapping or review row is created, changed
-- or removed, and competency_content_hash does not read the domain, so the twelve clinical review versions already
-- queued stay current. Re-running it is a no-op (every step keys on names and codes, nothing is duplicated).
-- Where the framework or the twelve competencies are absent (another environment) it reports and changes nothing.
-- Rollback: ROLLBACK-900.sql (moves the twelve back into one "Professional Practice" domain, drops the twelve
-- emptied domains). Verify: VERIFY-900.sql.
-- Depends on 011 (framework_domains, framework_competencies), 760 (framework_areas, framework_domains.area_id and
-- the area scope trigger), 040 (audit_log).
-- ====================================================================================================

do $$
declare
  v_fw uuid;
  v_fw_name text;
  v_area uuid;
  v_src uuid;
  v_sort int;
  v_dom uuid;
  v_made int := 0;
  v_moved int := 0;
  v_items jsonb := '[]'::jsonb;
  v_src_deleted boolean := false;
  r record;
begin
  select id, name into v_fw, v_fw_name from frameworks where code = 'NUR-CCF' and hospital_id is null limit 1;
  if v_fw is null then
    raise notice '900: no shared framework NUR-CCF on this environment, nothing to do';
    return;
  end if;

  -- the source domain: the one named Professional Practice that still holds PP competencies
  select d.id into v_src from framework_domains d
   where d.framework_id = v_fw and d.name = 'Professional Practice'
     and exists (select 1 from framework_competencies c where c.domain_id = d.id and c.code like 'PP-%')
   limit 1;
  if v_src is null and not exists (
      select 1 from framework_domains d where d.framework_id = v_fw and d.code like 'PP-%') then
    raise notice '900: NUR-CCF has no Professional Practice domain with PP competencies and no PP domains, nothing to do';
    return;
  end if;

  select id into v_area from framework_areas where framework_id = v_fw and name = 'Professional Practice' limit 1;
  if v_area is null then
    insert into framework_areas (framework_id, name, sort_order)
    values (v_fw, 'Professional Practice', coalesce((select max(sort_order) from framework_areas where framework_id = v_fw), 0) + 1)
    returning id into v_area;
  end if;

  select coalesce(max(sort_order), 0) into v_sort from framework_domains where framework_id = v_fw;

  for r in
    select c.id, c.code, c.name
      from framework_competencies c
      join framework_domains d on d.id = c.domain_id
     where d.framework_id = v_fw and d.id = v_src and c.code like 'PP-%'
     order by c.sort_order, c.code
  loop
    select id into v_dom from framework_domains where framework_id = v_fw and code = r.code limit 1;
    if v_dom is null then
      v_sort := v_sort + 1;
      insert into framework_domains (framework_id, name, code, sort_order, area_id)
      values (v_fw, r.name, r.code, v_sort, v_area)
      returning id into v_dom;
      v_made := v_made + 1;
    else
      update framework_domains set area_id = v_area where id = v_dom and area_id is distinct from v_area;
    end if;
    update framework_competencies set domain_id = v_dom, sort_order = 1 where id = r.id;
    v_moved := v_moved + 1;
    v_items := v_items || jsonb_build_object('competency_id', r.id, 'code', r.code, 'domain_id', v_dom);
  end loop;

  -- any PP domain made earlier that sits outside the Area is placed in it (a re-run after a hand edit)
  update framework_domains set area_id = v_area
   where framework_id = v_fw and code like 'PP-%' and area_id is distinct from v_area;

  -- the emptied source domain goes, unless something else still points at it
  if v_src is not null and not exists (select 1 from framework_competencies where domain_id = v_src) then
    begin
      delete from framework_domains where id = v_src;
      v_src_deleted := true;
    exception when foreign_key_violation then
      raise notice '900: the emptied domain % is still referenced elsewhere and is kept', v_src;
    end;
  end if;

  if v_moved > 0 then
    insert into audit_log (action, actor_name, entity_type, entity_id, entity_name, new_value)
    values ('cfca_domains_restructured', 'migration 900', 'framework', v_fw, v_fw_name,
            jsonb_build_object('area_id', v_area, 'domains_made', v_made, 'competencies_moved', v_moved,
                               'source_domain', v_src, 'source_domain_deleted', v_src_deleted, 'items', v_items));
  end if;
  raise notice '900: domains made %, competencies moved %, source domain deleted %', v_made, v_moved, v_src_deleted;
end;
$$;

notify pgrst, 'reload schema';
