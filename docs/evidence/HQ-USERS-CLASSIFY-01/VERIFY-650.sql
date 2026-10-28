-- VERIFY-650: read-only. Rows 1 to 8 must say true. The two queries after them are the report.
select '1 the migration classified nobody Human or System, and wrote no manual row' as check,
  not exists (select 1 from hq_account_classification where account_type in ('human', 'system') and basis = 'provenance')
  and not exists (select 1 from hq_account_classification where basis = 'manual' and classified_by is null) as ok
union all select '2 every seeded row names the script that created it',
  not exists (select 1 from hq_account_classification where basis = 'provenance' and (source_ref is null or btrim(source_ref) = ''))
union all select '3 every seeded Demo row is one of the 25 seed-cohort.mjs addresses',
  not exists (select 1 from hq_account_classification c join auth.users u on u.id = c.profile_id
               where c.account_type = 'demo' and c.basis = 'provenance' and c.source_ref not like 'scripts/seed-cohort.mjs%')
union all select '4 every non-Unclassified row has an audit row',
  not exists (select 1 from hq_account_classification c where c.account_type <> 'unclassified'
               and not exists (select 1 from audit_log a where a.action = 'hq_account_classified' and a.entity_id = c.profile_id))
union all select '5 the default view is a valid view',
  (select users_default_view in ('active_humans', 'all_humans', 'pending', 'demo', 'test', 'system', 'unclassified', 'all') from hq_config where id = 'singleton')
union all select '6 nothing but the three 650 functions reads the table, and no policy does (it grants nothing)',
  not exists (select 1 from pg_proc where prosrc like '%hq_account_classification%'
               and proname not in ('hq_account_classification_audit', 'hq_account_classify', 'hq_users_default_view_set'))
  and not exists (select 1 from pg_policies where tablename = 'hq_account_classification'
               or coalesce(qual, '') like '%hq_account_classification%' or coalesce(with_check, '') like '%hq_account_classification%')
union all select '7 the two admin functions are the service role''s only',
  not has_function_privilege('authenticated', 'hq_account_classify(uuid, text, uuid[], text, text, text)', 'execute')
  and not has_function_privilege('anon', 'hq_account_classify(uuid, text, uuid[], text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'hq_users_default_view_set(uuid, text, text, text)', 'execute')
union all select '8 the audit trigger is enabled',
  exists (select 1 from pg_trigger where tgname = 'trg_hq_account_classification_audit' and tgenabled = 'O');

-- REPORT 1: accounts by classification (no row = Unclassified), and confirmed active humans is a Users-screen
-- figure (status comes from Auth), so here: classified Human with a confirmed email and no ban.
select coalesce(c.account_type, 'unclassified') as account_type, count(*) as accounts,
       count(*) filter (where u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until < now())) as confirmed_not_suspended
  from profiles p
  left join auth.users u on u.id = p.id
  left join hq_account_classification c on c.profile_id = p.id
 group by 1 order by 1;

-- REPORT 2: what each source classified, and the synthetic markers left for review (not on a test domain).
select source_ref, account_type, count(*) as accounts from hq_account_classification where basis = 'provenance' group by 1, 2 order by 1;
select count(*) as synthetic_marker_left_unclassified
  from auth.users u
 where (coalesce(u.raw_user_meta_data ->> 'synthetic', '') = 'true' or coalesce(u.raw_user_meta_data ->> 'synthetic_automation_account', '') = 'true')
   and not exists (select 1 from hq_account_classification c where c.profile_id = u.id);
