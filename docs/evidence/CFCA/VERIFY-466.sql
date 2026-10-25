-- !! APPLY THIS FILE WHOLE. Part B is one DO block. Paste the entire file into the SQL editor and run it.
--
-- VERIFY 466. Part A is read-only. Part B runs inside a transaction that ends in ROLLBACK, so it leaves nothing behind.
-- Every line should read true or PASS.

-- A. Structure
select 'predicate exists' as check, to_regprocedure('public.competency_clinically_approved(uuid)') is not null as ok
union all select 'guard function exists', to_regprocedure('public.cfca_framework_publication_guard()') is not null
union all select 'guard trigger on frameworks', exists (
  select 1 from pg_trigger where tgname = 'trg_cfca_framework_publication_guard' and tgrelid = 'public.frameworks'::regclass and not tgisinternal);

-- B. Behaviour, rolled back
begin;
do $$
declare
  fw uuid := gen_random_uuid();
  cat uuid := gen_random_uuid();
  lib uuid := gen_random_uuid();
  dom uuid := gen_random_uuid();
  dom2 uuid := gen_random_uuid();
  ok boolean;
begin
  -- A shared CFCA framework that owns one competency nobody approved.
  insert into frameworks (id, name, library, hospital_id, scope, pub_status, competency_layer, code)
    values (fw, 'VERIFY-466 framework', 'core', null, 'master', 'draft', 'foundational', 'VERIFY-466');
  insert into framework_domains (id, framework_id, name) values (dom, fw, 'VERIFY domain');
  insert into framework_competencies (domain_id, name, code) values (dom, 'VERIFY competency', 'VERIFY-466-C1');

  raise notice '% authoring needs no approval: a draft with an unapproved competency exists', case when exists (select 1 from frameworks where id = fw and pub_status = 'draft') then 'PASS' else 'FAIL' end;

  ok := false;
  begin update frameworks set pub_status = 'published' where id = fw;
  exception when others then ok := sqlerrm like 'cfca publication:%'; end;
  raise notice '% publishing a CFCA framework with an unapproved competency is refused', case when ok then 'PASS' else 'FAIL' end;

  ok := false;
  begin update frameworks set pub_status = 'in_review' where id = fw; update frameworks set pub_status = 'approved' where id = fw; ok := true;
  exception when others then ok := false; end;
  raise notice '% review and governance approval states are not blocked (only publication is)', case when ok then 'PASS' else 'FAIL' end;

  ok := false;
  begin insert into frameworks (name, library, hospital_id, scope, pub_status, competency_layer, code)
          values ('VERIFY-466 inserted published', 'core', null, 'master', 'published', 'foundational', 'VERIFY-466-I');
        ok := true;
  exception when others then ok := false; end;
  raise notice '% a layered framework that owns no competencies (a 394 catalogue) is not blocked', case when ok then 'PASS' else 'FAIL' end;

  -- A shared framework with NO CFCA layer (the existing library) owning an unapproved competency: unchanged.
  insert into frameworks (id, name, library, hospital_id, scope, pub_status, competency_layer)
    values (lib, 'VERIFY-466 unlayered', 'core', null, 'master', 'draft', null);
  insert into framework_domains (id, framework_id, name) values (dom2, lib, 'VERIFY domain 2');
  insert into framework_competencies (domain_id, name) values (dom2, 'VERIFY unlayered competency');
  ok := false;
  begin update frameworks set pub_status = 'published' where id = lib; ok := true;
  exception when others then ok := false; end;
  raise notice '% a shared framework with no CFCA layer is unchanged', case when ok then 'PASS' else 'FAIL' end;

  raise notice '% the predicate says not approved for content nobody approved', case when not public.competency_clinically_approved((select id from framework_competencies where code = 'VERIFY-466-C1')) then 'PASS' else 'FAIL' end;
end
$$;
rollback;
