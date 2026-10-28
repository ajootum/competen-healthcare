-- FINGERPRINT-650: read-only. Expect 0 | 0 | 0 | 0 before 650 (and after its rollback), 1 | 3 | 3 | 1 after.
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'hq_account_classification') as table_1,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hq_config'
     and column_name in ('users_default_view', 'users_default_view_updated_at', 'users_default_view_updated_by')) as columns_3,
  (select count(*) from pg_proc where proname in ('hq_account_classification_audit', 'hq_account_classify', 'hq_users_default_view_set')) as functions_3,
  (select count(*) from pg_trigger where not tgisinternal and tgname = 'trg_hq_account_classification_audit') as trigger_1;

-- ACCESS DIGEST: run BEFORE 650 and AFTER 650 (and after any classification). The two answers must be equal.
-- Classification must leave sign-in, product access, HQ appointments, seats, memberships and records untouched.
select md5(string_agg(t || ':' || n || ':' || h, '|' order by t)) as access_digest
  from (
    select 'auth.users' as t, count(*)::text as n, md5(coalesce(string_agg(id::text || coalesce(email, '') || coalesce(banned_until::text, '') || coalesce(encrypted_password, ''), ',' order by id), '')) as h from auth.users
    union all select 'profiles', count(*)::text, md5(coalesce(string_agg(id::text || coalesce(role, '') || coalesce(array_to_string(roles, ','), '') || coalesce(platform_role, ''), ',' order by id), '')) from profiles
    union all select 'platform_membership', count(*)::text, md5(coalesce(string_agg(user_id::text || status, ',' order by user_id, status), '')) from platform_membership
    union all select 'individual_membership', count(*)::text, md5(coalesce(string_agg(user_id::text || status, ',' order by user_id, status), '')) from individual_membership
    union all select 'ogs_office_appointments', count(*)::text, md5(coalesce(string_agg(id::text || coalesce(status, ''), ',' order by id), '')) from ogs_office_appointments
    union all select 'competency_decisions', count(*)::text, '' from competency_decisions
  ) x;
