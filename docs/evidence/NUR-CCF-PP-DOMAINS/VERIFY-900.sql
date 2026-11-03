-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one DO block between dollar quotes.
-- ====================================================================================================
-- VERIFY 900 (NUR-CCF Professional Practice as twelve domains). Reads only, writes nothing.
-- Checks: the shared framework NUR-CCF and its Professional Practice Area exist, the Area holds exactly the twelve
-- domains PP-01 to PP-12, each of them holds exactly one competency whose code and name equal the domain's, every one
-- of those competencies still has its active criteria, no domain named Professional Practice holds a PP competency
-- any more, no clinical review version of a PP competency went stale (the hash never read the domain), and the
-- audit row of the restructure exists.
--
-- IT ALWAYS ENDS BY RAISING its RESULT line (nothing is changed either way).
-- Expect: RESULT VERIFY 900 pass=9 fail=0 failed:  (criteria=<n>)
do $$
declare
  pass int := 0;
  fail int := 0;
  failed text := '';
  v_fw uuid;
  v_area uuid;
  n int;
  k int;
begin
  select id into v_fw from frameworks where code = 'NUR-CCF' and hospital_id is null limit 1;
  if v_fw is not null then pass := pass + 1; else fail := fail + 1; failed := failed || ' V1:framework'; end if;

  select id into v_area from framework_areas where framework_id = v_fw and name = 'Professional Practice' limit 1;
  if v_area is not null then pass := pass + 1; else fail := fail + 1; failed := failed || ' V2:area'; end if;

  select count(*) into n from framework_domains where framework_id = v_fw and area_id = v_area;
  if n = 12 then pass := pass + 1; else fail := fail + 1; failed := failed || ' V3:domains_in_area=' || n; end if;

  select count(*) into n from framework_domains d
   where d.framework_id = v_fw and d.area_id = v_area
     and d.code = any (array['PP-01','PP-02','PP-03','PP-04','PP-05','PP-06','PP-07','PP-08','PP-09','PP-10','PP-11','PP-12']);
  if n = 12 then pass := pass + 1; else fail := fail + 1; failed := failed || ' V4:pp_codes=' || n; end if;

  select count(*) into n from framework_domains d
   where d.framework_id = v_fw and d.code like 'PP-%'
     and (select count(*) from framework_competencies c where c.domain_id = d.id) = 1
     and exists (select 1 from framework_competencies c where c.domain_id = d.id and c.code = d.code and c.name = d.name);
  if n = 12 then pass := pass + 1; else fail := fail + 1; failed := failed || ' V5:one_matching_competency=' || n; end if;

  select count(*), coalesce(sum(k2.c), 0) into n, k from framework_competencies c
   join framework_domains d on d.id = c.domain_id
   left join (select competency_id, count(*) c from competency_skills where is_active is not false group by competency_id) k2 on k2.competency_id = c.id
   where d.framework_id = v_fw and c.code like 'PP-%' and coalesce(k2.c, 0) >= 1;
  if n = 12 then pass := pass + 1; else fail := fail + 1; failed := failed || ' V6:competencies_with_criteria=' || n; end if;

  select count(*) into n from framework_domains d
   where d.framework_id = v_fw and d.name = 'Professional Practice'
     and exists (select 1 from framework_competencies c where c.domain_id = d.id and c.code like 'PP-%');
  if n = 0 then pass := pass + 1; else fail := fail + 1; failed := failed || ' V7:old_domain_still_holds=' || n; end if;

  select count(*) into n from clinical_content_version v
   join framework_competencies c on c.id = v.competency_id
   where v.content_kind = 'competency' and c.code like 'PP-%' and v.content_hash <> public.competency_content_hash(c.id);
  if n = 0 then pass := pass + 1; else fail := fail + 1; failed := failed || ' V8:stale_review_versions=' || n; end if;

  select count(*) into n from audit_log where action = 'cfca_domains_restructured' and entity_id = v_fw;
  if n >= 1 then pass := pass + 1; else fail := fail + 1; failed := failed || ' V9:audit=' || n; end if;

  raise exception 'RESULT VERIFY 900 pass=% fail=% failed:%  (criteria=%)', pass, fail, failed, k;
end;
$$;
