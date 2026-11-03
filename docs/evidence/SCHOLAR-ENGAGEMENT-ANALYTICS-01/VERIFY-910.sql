-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one DO block between dollar quotes.
-- ====================================================================================================
-- VERIFY 910 (Scholar engagement analytics). Reads only, writes nothing.
-- IT ALWAYS ENDS BY RAISING its RESULT line. Expect: RESULT VERIFY 910 pass=6 fail=0 failed:
do $$
declare
  pass int := 0;
  fail int := 0;
  failed text := '';
  n int;
  s text;
begin
  select count(*) into n from hq_capability where code in ('hq.scholar.analytics.view', 'hq.scholar.analytics.identifiable.read') and space = 'platform';
  if n = 2 then pass := pass + 1; else fail := fail + 1; failed := failed || ' V1:capabilities=' || n; end if;

  select count(*) into n from hq_position_capability
   where capability_code = 'hq.scholar.analytics.view' and position_code in ('individual_product_administrator', 'individual_product_reviewer');
  if n = 2 then pass := pass + 1; else fail := fail + 1; failed := failed || ' V2:view_grants=' || n; end if;

  select count(*) into n from hq_position_capability where capability_code = 'hq.scholar.analytics.identifiable.read';
  if n = 0 then pass := pass + 1; else fail := fail + 1; failed := failed || ' V3:identifiable_grants=' || n; end if;

  select count(*) into n from information_schema.columns where table_name = 'hq_config' and column_name = 'analytics_pseudonym_salt';
  if n = 1 then pass := pass + 1; else fail := fail + 1; failed := failed || ' V4:salt_column=' || n; end if;

  select analytics_pseudonym_salt into s from hq_config limit 1;
  if s is not null and length(s) = 32 then pass := pass + 1; else fail := fail + 1; failed := failed || ' V5:salt_value'; end if;

  select count(*) into n from pg_proc where proname like 'scholar_analytics%';
  if n = 0 then pass := pass + 1; else fail := fail + 1; failed := failed || ' V6:unexpected_functions=' || n; end if;

  raise exception 'RESULT VERIFY 910 pass=% fail=% failed:%', pass, fail, failed;
end;
$$;
