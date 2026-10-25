-- FINGERPRINT 491. Read-only. Run PRE, after each apply, after the rollback, and after the re-apply.
-- md5 over the two tables 491 owns (columns, constraints, indexes, policies, RLS), and an item count. PRE: empty/0.

select '491' as migration,
  md5(coalesce((select string_agg(x, '|' order by x) from (
    select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') as x
      from information_schema.columns where table_schema = 'public' and table_name in ('individual_professional_learning_reflection', 'individual_professional_share_learning')
    union all select 'con:' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint
     where conrelid in (select oid from pg_class where relname in ('individual_professional_learning_reflection', 'individual_professional_share_learning'))
    union all select 'idx:' || indexname || ':' || indexdef from pg_indexes where tablename in ('individual_professional_learning_reflection', 'individual_professional_share_learning')
    union all select 'pol:' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') from pg_policies where tablename in ('individual_professional_learning_reflection', 'individual_professional_share_learning')
    union all select 'rls:' || relname || ':' || relrowsecurity from pg_class where relname in ('individual_professional_learning_reflection', 'individual_professional_share_learning')
  ) t), '')) as fp,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('individual_professional_learning_reflection', 'individual_professional_share_learning')) as items;
