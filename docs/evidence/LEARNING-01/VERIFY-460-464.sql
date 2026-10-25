-- ====================================================================================================
-- VERIFY 460-464 (COMPETEN-LEARNING-01). Read-only. Run on STAGING after applying 460, 461, 462, 463 and 464 in that
-- order (461 after 442). Each query states its expected result. ASCII only. No semicolons inside comments.
-- ====================================================================================================

-- V1. Expected: 11 rows, every relrowsecurity = t. policies = 1 for learning_record, learning_record_activity,
--     learning_check_attempt, learning_certificate and individual_course_entitlement, and 0 for the other six.
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c
 where c.relname in ('learning_provider', 'learning_offering', 'learning_offering_version', 'learning_offering_version_outcome',
                     'learning_record', 'learning_record_activity', 'learning_check_attempt', 'learning_certificate_authorisation',
                     'learning_certificate', 'learning_offering_price', 'individual_course_entitlement')
   and c.relkind = 'r'
 order by c.relname;

-- V2. Expected: 0 rows in every new table (nothing is seeded).
select (select count(*) from learning_provider) as providers, (select count(*) from learning_offering) as offerings,
       (select count(*) from learning_offering_version) as versions, (select count(*) from learning_record) as records,
       (select count(*) from learning_certificate) as certificates, (select count(*) from learning_offering_price) as prices,
       (select count(*) from individual_course_entitlement) as course_entitlements;

-- V3. Expected: the subject CHECK names all four kinds (competency, case, resource, learning).
select pg_get_constraintdef(oid) like '%''competency''%' and pg_get_constraintdef(oid) like '%''case''%'
   and pg_get_constraintdef(oid) like '%''resource''%' and pg_get_constraintdef(oid) like '%''learning''%' as four_kinds
  from pg_constraint where conname = 'clinical_content_version_subject_check';

-- V4. Expected: both replaced guards still contain the 442 resource branch and now the learning branch (t, t, t, t).
select position('ckri_knowledge_version' in pg_get_functiondef('public.clinical_content_version_guard'::regproc)) > 0 as cv_resource,
       position('learning_offering_version' in pg_get_functiondef('public.clinical_content_version_guard'::regproc)) > 0 as cv_learning,
       position('ckri_knowledge_version_competency' in pg_get_functiondef('public.clinical_review_decision_guard'::regproc)) > 0 as rd_resource,
       position('learning_offering_version_outcome' in pg_get_functiondef('public.clinical_review_decision_guard'::regproc)) > 0 as rd_learning;

-- V5. Expected: every existing checkout is item_kind experience (one row, or none if there are no checkouts).
select item_kind, count(*) from individual_checkout group by item_kind order by item_kind;

-- V6. Expected: plan_code, experience_code and interval_days nullable (YES), item_kind NOT NULL (NO).
select column_name, is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = 'individual_checkout'
   and column_name in ('item_kind', 'offering_id', 'offering_price_id', 'terms_version', 'operating_entity', 'plan_code', 'experience_code', 'interval_days')
 order by 1;

-- V7. Expected: individual_entitlement, individual_plan and individual_live_entitlement unchanged by 463: the
--     experience CHECKs still allow exactly scholar and professional.
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conname in ('individual_entitlement_experience_check', 'individual_plan_experience_check') order by conname;

-- V8. Expected: 8 functions, each executable by service_role only (anon and authenticated f).
select p.proname, has_function_privilege('service_role', p.oid, 'execute') as service_role,
       has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('learning_offering_submit', 'learning_offering_approved', 'learning_offering_publish',
   'learning_offering_deliverable', 'learning_offering_retire', 'learning_holds_capability', 'learning_offering_price_decide', 'learning_offering_price_retire')
 order by 1;

-- V9. Expected: 4 capabilities (space learning), 4 positions (space learning), 8 grants all to the four new positions,
--     0 Learning grants to any other position, and 0 appointments.
select code, space from hq_capability
 where code in ('hq.learning.course.author', 'hq.learning.course.publish', 'hq.learning.price.approve', 'hq.learning.certificate.issue') order by code;
select code, space from hq_position
 where code in ('learning_course_author', 'learning_publisher', 'learning_price_approver', 'learning_certificate_issuer') order by code;
select position_code, capability_code from hq_position_capability
 where effective_to is null and (capability_code in ('hq.learning.course.author', 'hq.learning.course.publish', 'hq.learning.price.approve', 'hq.learning.certificate.issue')
       or position_code in ('learning_course_author', 'learning_publisher', 'learning_price_approver', 'learning_certificate_issuer'))
 order by position_code, capability_code;
select count(*) as appointed from ogs_office_appointments
 where role in ('learning_course_author', 'learning_publisher', 'learning_price_approver', 'learning_certificate_issuer');

-- V10. Expected: two private buckets, learning-content (20971520 bytes) and learning-evidence (10485760 bytes).
select id, public, file_size_limit from storage.buckets where id in ('learning-content', 'learning-evidence') order by id;

-- V11. Expected: the two views exist with security_invoker on.
select c.relname, c.reloptions from pg_class c where c.relname in ('individual_live_entitlement', 'individual_live_course_entitlement') order by 1;
