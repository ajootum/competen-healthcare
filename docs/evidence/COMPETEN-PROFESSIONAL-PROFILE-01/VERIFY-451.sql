-- VERIFY 451 (read-only). COMPETEN-PROFESSIONAL-PROFILE-01 part B, verification. Every query only reads.

-- 1. the capability and the position (expect 1 and 1), the position's open grants (expect hq.individual.professional.verify, hq.platform.home.view)
select (select count(*) from hq_capability where code = 'hq.individual.professional.verify') as capability,
       (select count(*) from hq_position where code = 'individual_professional_verifier' and product_line_code = 'individual') as position;
select capability_code from hq_position_capability where position_code = 'individual_professional_verifier' and effective_to is null order by 1;

-- 2. NO appointment was made (expect 0)
select count(*) as verifier_appointments from ogs_office_appointments where role = 'individual_professional_verifier';

-- 3. the history table: RLS on, exactly one policy, a SELECT one (expect true, 1, 1)
select c.relrowsecurity, (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from pg_policy p where p.polrelid = c.oid and p.polcmd = 'r') as select_policies
  from pg_class c where c.relname = 'individual_professional_item_verification' and c.relkind = 'r';

-- 4. the two triggers and the function (expect 2 rows, then 1)
select tgname from pg_trigger where tgname in ('trg_individual_professional_item_verification_guard', 'trg_individual_professional_item_verification_append_only') order by 1;
select count(*) as holds_function from pg_proc where proname = 'individual_holds_capability';

-- 5. no hospital, organisation, tenant or workspace column (expect 0), and no rows yet (expect 0)
select count(*) as scope_columns from information_schema.columns where table_name = 'individual_professional_item_verification'
   and column_name in ('hospital_id', 'organisation_id', 'tenant_id', 'workspace_id');
select count(*) as rows from individual_professional_item_verification;
