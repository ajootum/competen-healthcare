-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one DO block between dollar quotes.
-- ====================================================================================================
-- VERIFY 941 (framework two-person publication). Reads only, writes nothing. IT ALWAYS ENDS BY RAISING its RESULT line.
-- Expect: RESULT VERIFY 941 pass=6 fail=0 failed:
do $$
declare
  pass int := 0;
  fail int := 0;
  failed text := '';
  src text;
  n int;
  checks text[] := '{}';
  oks boolean[] := '{}';
  i int;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p where p.proname = 'frameworks_sod_publication_guard' limit 1;
  checks := array_append(checks, 'V1:submitter_refusal_gone'); oks := array_append(oks, (src not like '%cannot publish it%'));
  checks := array_append(checks, 'V2:contributor_refusal_gone'); oks := array_append(oks, (src not like '%authored or curated content in this framework%'));
  checks := array_append(checks, 'V3:publisher_recorded'); oks := array_append(oks, (src like '%a publication must record its publisher%'));
  checks := array_append(checks, 'V4:publisher_not_approver_kept'); oks := array_append(oks, (src like '%may not be one of the clinical approvers%'));
  select count(*) into n from pg_trigger where tgname = 'trg_frameworks_sod_publication_guard';
  checks := array_append(checks, 'V5:trigger_in_place'); oks := array_append(oks, (n = 1));
  select count(*) into n from pg_trigger where tgname = 'trg_cfca_framework_publication_guard';
  checks := array_append(checks, 'V6:466_approval_guard_untouched'); oks := array_append(oks, (n = 1));
  for i in 1 .. cardinality(checks) loop
    if oks[i] then pass := pass + 1; else fail := fail + 1; failed := failed || checks[i] || ' '; end if;
  end loop;
  raise exception 'RESULT VERIFY 941 pass=% fail=% failed: %', pass, fail, failed;
end
$$;
