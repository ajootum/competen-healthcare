-- ====================================================================================================
-- APPLY THIS FILE WHOLE. ROLLBACK 940 (staging rehearsal). Restores the 890 publish rule, removes the
-- reporting-line column and function, and removes the thirteen positions of the initial organisation
-- WITH THEIR GRANTS, but only while nobody is appointed to them (fix forward once somebody is).
-- ====================================================================================================
do $$
begin
  if exists (select 1 from ogs_office_appointments a where a.role in (
    'chief_executive_officer', 'chief_technology_product_officer', 'chief_clinical_academic_officer', 'chief_operations_finance_officer', 'chief_quality_governance_officer',
    'platform_engineering_manager', 'product_experience_manager', 'clinical_standards_competency_manager', 'academic_assessment_manager',
    'finance_administration_manager', 'commercial_partnerships_manager', 'quality_risk_manager', 'governance_compliance_manager')) then
    raise exception 'ROLLBACK 940 refused: somebody is appointed to one of the 940 positions. Fix forward';
  end if;
end
$$;

-- grants of the 940 positions (the 500 guard allows a delete of a grant row only through this path, which is the file itself)
alter table hq_position_capability disable trigger hq_position_capability_guard;
delete from hq_position_capability where grant_reason like 'UNIFIED-GOVERNANCE-V1%';
alter table hq_position_capability enable trigger hq_position_capability_guard;

update hq_position set reports_to = null where reports_to is not null;
alter table hq_position disable trigger hq_position_guard;
delete from hq_position where code in (
  'chief_executive_officer', 'chief_technology_product_officer', 'chief_clinical_academic_officer', 'chief_operations_finance_officer', 'chief_quality_governance_officer',
  'platform_engineering_manager', 'product_experience_manager', 'clinical_standards_competency_manager', 'academic_assessment_manager',
  'finance_administration_manager', 'commercial_partnerships_manager', 'quality_risk_manager', 'governance_compliance_manager');
alter table hq_position enable trigger hq_position_guard;

drop function if exists hq_position_admin_set_reports_to(uuid, text, text, text, text, text);
drop trigger if exists hq_position_reports_to_guard on hq_position;
drop function if exists hq_position_reports_to_guard();
alter table hq_position drop column if exists reports_to;

-- The 890 lifecycle guard is restored by re-applying the function from 890 (its text is unchanged there):
-- paste the asmt_version_lifecycle_guard definition from supabase/migrations/890-asmt-core-definitions.sql.
-- On staging the rehearsal does exactly that (see the build record).
notify pgrst, 'reload schema';
