-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one DO block between dollar quotes.
-- ====================================================================================================
-- VERIFY 942 (governed policies on the definition engine, Document Template Studio review). Reads only.
-- IT ALWAYS ENDS BY RAISING its RESULT line. Expect: RESULT VERIFY 942 pass=12 fail=0 failed:
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
  select count(*) into n from hq_capability where code in ('hq.quality.policy.author', 'hq.quality.policy.review', 'hq.quality.policy.publish');
  checks := array_append(checks, 'V1:three_policy_capabilities'); oks := array_append(oks, (n = 3));
  select count(*) into n from hq_position_capability where position_code = 'chief_executive_officer' and capability_code like 'hq.quality.policy.%' and effective_to is null;
  checks := array_append(checks, 'V2:ceo_holds_policy_rights'); oks := array_append(oks, (n = 4));
  select count(*) into n from information_schema.tables where table_schema = 'public' and table_name in ('hq_policy', 'hq_policy_version', 'hq_config_review');
  checks := array_append(checks, 'V3:three_tables'); oks := array_append(oks, (n = 3));
  checks := array_append(checks, 'V4:parent_col_knows_policies'); oks := array_append(oks, (public.asmt_version_parent_col('hq_policy_version') = 'policy_id'));
  checks := array_append(checks, 'V5:capability_lookup'); oks := array_append(oks, (public.asmt_lifecycle_capability('hq_policy_version', 'publish') = 'hq.quality.policy.publish' and public.asmt_lifecycle_capability('asmt_instrument_version', 'publish') = 'hq.assessment.instrument.publish' and public.asmt_lifecycle_capability('hq_policy_version', 'domain') = 'hq.quality.clinical.approve'));
  select pg_get_functiondef(p.oid) into src from pg_proc p where p.proname = 'asmt_version_lifecycle_guard' limit 1;
  checks := array_append(checks, 'V6:lifecycle_guard_uses_lookup'); oks := array_append(oks, (src like '%asmt_lifecycle_capability(tg_table_name%' and src like '%not publishable. It needs % independent governance approval%'));
  select pg_get_functiondef(p.oid) into src from pg_proc p where p.proname = 'asmt_review_decision_sod_guard' limit 1;
  checks := array_append(checks, 'V7:decision_guard_uses_lookup'); oks := array_append(oks, (src like '%asmt_lifecycle_capability(new.version_table%'));
  select count(*) into n from pg_trigger where tgname in ('hq_policy_version_lifecycle', 'hq_policy_version_after');
  checks := array_append(checks, 'V8:policy_version_triggers'); oks := array_append(oks, (n = 2));
  select count(*) into n from pg_constraint where conname = 'asmt_review_decision_table_check' and pg_get_constraintdef(oid) like '%hq_policy_version%';
  checks := array_append(checks, 'V9:decision_table_check_accepts_policies'); oks := array_append(oks, (n = 1));
  select count(*) into n from pg_trigger where tgname in ('hq_config_review_guard', 'hq_config_publish_guard');
  checks := array_append(checks, 'V10:config_review_triggers'); oks := array_append(oks, (n = 2));
  checks := array_append(checks, 'V11:documents_path_governed'); oks := array_append(oks, (public.hq_config_review_governs('individual.professional_documents') and not public.hq_config_review_governs('individual.policy')));
  select count(*) into n from pg_class where relrowsecurity and relname in ('hq_policy', 'hq_policy_version', 'hq_config_review');
  checks := array_append(checks, 'V12:rls_on'); oks := array_append(oks, (n = 3));
  for i in 1 .. cardinality(checks) loop
    if oks[i] then pass := pass + 1; else fail := fail + 1; failed := failed || checks[i] || ' '; end if;
  end loop;
  raise exception 'RESULT VERIFY 942 pass=% fail=% failed: %', pass, fail, failed;
end
$$;
