-- FINGERPRINT 490. Read-only. Run PRE (before applying), after each apply, after the rollback, and after the re-apply.
-- md5 over the objects 490 changes or owns, and an item count. PRE has the 373 shape of the CPD table and no 490 objects.

select '490' as migration,
  md5(coalesce((select string_agg(x, '|' order by x) from (
    select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || coalesce(numeric_precision::text, '') || ',' || coalesce(numeric_scale::text, '') || ':' || is_nullable as x
      from information_schema.columns where table_schema = 'public'
       and (table_name in ('individual_professional_cpd_history', 'individual_professional_cpd_setting')
            or (table_name = 'individual_professional_cpd' and column_name in ('activity_type', 'hours', 'cpd_points')))
    union all select 'con:' || conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint
     where conrelid in (select oid from pg_class where relname in ('individual_professional_cpd', 'individual_professional_cpd_history', 'individual_professional_cpd_setting'))
       and conname in ('individual_professional_cpd_type_check', 'individual_professional_cpd_hours_check', 'individual_professional_cpd_history_cpd_fk',
                       'individual_professional_cpd_setting_shape', 'individual_professional_cpd_setting_pkey', 'individual_professional_cpd_history_pkey')
    union all select 'fn:' || p.proname || ':' || md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('individual_professional_cpd_keep_history', 'individual_professional_cpd_history_guard')
    union all select 'trg:' || tgname || ':' || pg_get_triggerdef(oid) from pg_trigger
     where tgname in ('trg_individual_professional_cpd_keep_history', 'trg_individual_professional_cpd_history_guard') and not tgisinternal
    union all select 'pol:' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') from pg_policies
     where tablename in ('individual_professional_cpd_history', 'individual_professional_cpd_setting')
    union all select 'rls:' || relname || ':' || relrowsecurity from pg_class where relname in ('individual_professional_cpd_history', 'individual_professional_cpd_setting')
  ) t), '')) as fp,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('individual_professional_cpd_history', 'individual_professional_cpd_setting')) as new_columns,
  (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'individual_professional_cpd' and column_name = 'hours') as hours_nullable;
