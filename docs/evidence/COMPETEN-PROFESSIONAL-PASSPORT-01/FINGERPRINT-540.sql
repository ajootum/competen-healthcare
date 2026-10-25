-- FINGERPRINT 540 (read-only). Run BEFORE and AFTER each application, and after the rollback rehearsal.
-- One md5 and an item count over the schema objects 540 can touch: every column, constraint, index, policy and
-- trigger on individual_passport_* tables, the indexes of passport_share_tokens, individual_professional_cpd,
-- individual_professional_evidence and the two Scholar Passport tables, and the bodies of individual_passport_*
-- functions.
-- Expected: PRE = after ROLLBACK, and after apply #1 = after apply #2 = after re-apply.

with items as (
  select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') as item
    from information_schema.columns where table_schema = 'public' and table_name like 'individual_passport%'
  union all
  select 'con:' || conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid)
    from pg_constraint where conrelid::regclass::text like 'individual_passport%'
  union all
  select 'idx:' || tablename || '.' || indexname || ':' || indexdef
    from pg_indexes where schemaname = 'public' and (tablename like 'individual_passport%' or tablename in ('passport_share_tokens',
      'individual_professional_cpd', 'individual_professional_evidence', 'individual_scholar_passport_item', 'individual_scholar_passport_evaluation'))
  union all
  select 'pol:' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '')
    from pg_policies where schemaname = 'public' and tablename like 'individual_passport%'
  union all
  select 'trg:' || tgrelid::regclass::text || '.' || tgname
    from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'individual_passport%'
  union all
  select 'fn:' || proname || ':' || md5(replace(prosrc, chr(13), ''))
    from pg_proc where proname like 'individual_passport%'
)
select md5(string_agg(item, '|' order by item)) as fingerprint, count(*) as items from items;
