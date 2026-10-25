-- FINGERPRINT 530 (read-only). Run BEFORE and AFTER each application, and after the rollback rehearsal.
-- One md5 and an item count over the schema objects 530 can touch: every column, constraint, index, policy
-- and trigger on individual_professional_* tables, and the bodies of the individual_professional_* functions.
-- Expected: PRE = after ROLLBACK, and after apply #1 = after apply #2 = after re-apply.

with items as (
  select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') as item
    from information_schema.columns where table_schema = 'public' and table_name like 'individual_professional%'
  union all
  select 'con:' || conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid)
    from pg_constraint where conrelid::regclass::text like 'individual_professional%'
  union all
  select 'idx:' || tablename || '.' || indexname || ':' || indexdef
    from pg_indexes where schemaname = 'public' and tablename like 'individual_professional%'
  union all
  select 'pol:' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '')
    from pg_policies where schemaname = 'public' and tablename like 'individual_professional%'
  union all
  select 'trg:' || tgrelid::regclass::text || '.' || tgname
    from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'individual_professional%'
  union all
  select 'fn:' || proname || ':' || md5(replace(prosrc, chr(13), ''))
    from pg_proc where proname like 'individual_professional%'
)
select md5(string_agg(item, '|' order by item)) as fingerprint, count(*) as items from items;
