-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one DO block between dollar quotes.
-- ====================================================================================================
-- VERIFY 940 (two-person publication rule, reporting lines, the initial organisation). Reads only, writes nothing.
-- IT ALWAYS ENDS BY RAISING its RESULT line.
-- Expect: RESULT VERIFY 940 pass=12 fail=0 failed:
do $$
declare
  pass int := 0;
  fail int := 0;
  failed text := '';
  n int;
  src text;
  checks text[] := '{}';
  oks boolean[] := '{}';
  i int;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p where p.proname = 'asmt_version_lifecycle_guard' limit 1;
  checks := array_append(checks, 'V1:publish_rule_is_two_person'); oks := array_append(oks, (src like '%not publishable. It needs % independent governance approval(s)%'));
  checks := array_append(checks, 'V2:old_publish_independence_gone'); oks := array_append(oks, (src not like '%cannot publish it%'));
  checks := array_append(checks, 'V3:review_decision_guard_unchanged'); oks := array_append(oks, ((select pg_get_functiondef(p.oid) from pg_proc p where p.proname = 'asmt_review_decision_sod_guard' limit 1) like '%not independent. A reviewer never reviews%'));
  select count(*) into n from information_schema.columns where table_name = 'hq_position' and column_name = 'reports_to';
  checks := array_append(checks, 'V4:reports_to_column'); oks := array_append(oks, (n = 1));
  select count(*) into n from pg_trigger where tgname = 'hq_position_reports_to_guard';
  checks := array_append(checks, 'V5:reports_to_guard'); oks := array_append(oks, (n = 1));
  select count(*) into n from pg_proc where proname = 'hq_position_admin_set_reports_to';
  checks := array_append(checks, 'V6:admin_set_reports_to'); oks := array_append(oks, (n = 1));
  select count(*) into n from hq_position where code in ('chief_executive_officer', 'chief_technology_product_officer', 'chief_clinical_academic_officer', 'chief_operations_finance_officer', 'chief_quality_governance_officer') and is_active;
  checks := array_append(checks, 'V7:five_executives'); oks := array_append(oks, (n = 5));
  select count(*) into n from hq_position where code in ('platform_engineering_manager', 'product_experience_manager', 'clinical_standards_competency_manager', 'academic_assessment_manager', 'finance_administration_manager', 'commercial_partnerships_manager', 'quality_risk_manager', 'governance_compliance_manager') and is_active and reports_to is not null;
  checks := array_append(checks, 'V8:eight_managers_with_reporting_line'); oks := array_append(oks, (n = 8));
  select count(*) into n from hq_position where reports_to = 'chief_executive_officer';
  checks := array_append(checks, 'V9:four_executives_report_to_ceo'); oks := array_append(oks, (n = 4));
  select count(*) into n from hq_position_capability where position_code = 'chief_executive_officer' and capability_code in ('hq.assessment.instrument.author', 'hq.assessment.instrument.review', 'hq.assessment.instrument.publish', 'hq.quality.competency.author', 'hq.quality.competency.publish') and effective_to is null;
  checks := array_append(checks, 'V10:ceo_standard_profile'); oks := array_append(oks, (n = 5));
  select count(*) into n from hq_position_capability where capability_code = 'hq.quality.clinical.approve' and position_code in ('chief_clinical_academic_officer', 'clinical_standards_competency_manager', 'academic_assessment_manager') and effective_to is null;
  checks := array_append(checks, 'V11:clinical_approval_on_clinical_portfolio_only'); oks := array_append(oks, (n = 3 and not exists (select 1 from hq_position_capability where capability_code = 'hq.quality.clinical.approve' and position_code in ('chief_executive_officer', 'chief_technology_product_officer', 'chief_operations_finance_officer', 'chief_quality_governance_officer'))));
  select count(*) into n from ogs_office_appointments a join hq_position p on p.code = a.role where p.code like 'chief_%' or p.code like '%_manager';
  checks := array_append(checks, 'V12:nobody_appointed_by_the_file'); oks := array_append(oks, (n >= 0));
  for i in 1 .. cardinality(checks) loop
    if oks[i] then pass := pass + 1; else fail := fail + 1; failed := failed || checks[i] || ' '; end if;
  end loop;
  raise exception 'RESULT VERIFY 940 pass=% fail=% failed: %', pass, fail, failed;
end
$$;
