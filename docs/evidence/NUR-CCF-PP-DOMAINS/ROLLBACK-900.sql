-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one plpgsql DO block between dollar quotes.
-- ====================================================================================================
-- ROLLBACK 900: put the twelve PP competencies of NUR-CCF back into one domain "Professional Practice" in the
-- Professional Practice Area and drop the twelve emptied PP domains. Refuses while a PP domain holds anything
-- other than its one competency (a practice, a second competency, a revision row) so nothing authored after 900
-- is lost. Writes one audit row. Run VERIFY-900 after it: V3, V4, V5 and V7 are then expected to fail.
do $$
declare
  v_fw uuid;
  v_fw_name text;
  v_area uuid;
  v_dom uuid;
  n int;
  v_moved int := 0;
  v_dropped int := 0;
  r record;
begin
  select id, name into v_fw, v_fw_name from frameworks where code = 'NUR-CCF' and hospital_id is null limit 1;
  if v_fw is null then raise notice 'ROLLBACK 900: no NUR-CCF here, nothing to do'; return; end if;
  select id into v_area from framework_areas where framework_id = v_fw and name = 'Professional Practice' limit 1;

  select count(*) into n from framework_domains d
   where d.framework_id = v_fw and d.code like 'PP-%'
     and ((select count(*) from framework_competencies c where c.domain_id = d.id) <> 1
          or exists (select 1 from practices p where p.domain_id = d.id)
          or exists (select 1 from framework_revision_domain x where x.domain_id = d.id));
  if n > 0 then
    raise exception 'ROLLBACK 900 refused: % PP domain(s) hold more than the one moved competency', n;
  end if;

  select id into v_dom from framework_domains where framework_id = v_fw and name = 'Professional Practice' limit 1;
  if v_dom is null then
    insert into framework_domains (framework_id, name, sort_order, area_id)
    values (v_fw, 'Professional Practice', coalesce((select max(sort_order) from framework_domains where framework_id = v_fw), 0) + 1, v_area)
    returning id into v_dom;
  end if;

  for r in
    select c.id, c.code, d.id as domain_id
      from framework_competencies c join framework_domains d on d.id = c.domain_id
     where d.framework_id = v_fw and d.code like 'PP-%' and c.code like 'PP-%'
     order by c.code
  loop
    update framework_competencies set domain_id = v_dom, sort_order = substring(r.code from 4)::int where id = r.id;
    v_moved := v_moved + 1;
    delete from framework_domains where id = r.domain_id and not exists (select 1 from framework_competencies where domain_id = r.domain_id);
    v_dropped := v_dropped + 1;
  end loop;

  insert into audit_log (action, actor_name, entity_type, entity_id, entity_name, new_value)
  values ('cfca_domains_restructure_rolled_back', 'rollback 900', 'framework', v_fw, v_fw_name,
          jsonb_build_object('domain_id', v_dom, 'competencies_moved', v_moved, 'domains_dropped', v_dropped));
  raise notice 'ROLLBACK 900: moved % competencies back, dropped % domains', v_moved, v_dropped;
end;
$$;

notify pgrst, 'reload schema';
