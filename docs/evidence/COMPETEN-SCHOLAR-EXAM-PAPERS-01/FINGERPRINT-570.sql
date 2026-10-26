-- FINGERPRINT 570 (coordinator, read-only): columns, constraints, indexes, policies, triggers and RLS of the four 570 tables.
with t(n) as (values ('individual_scholar_exam_paper'), ('individual_scholar_exam_question'), ('individual_scholar_exam_answer'), ('individual_scholar_research_cache')),
items as (
  select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') as item
    from information_schema.columns where table_schema = 'public' and table_name in (select n from t)
  union all select 'con:' || conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where conrelid::regclass::text in (select n from t)
  union all select 'idx:' || tablename || '.' || indexname || ':' || indexdef from pg_indexes where schemaname = 'public' and tablename in (select n from t)
  union all select 'pol:' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') from pg_policies where schemaname = 'public' and tablename in (select n from t)
  union all select 'trg:' || tgrelid::regclass::text || '.' || tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text in (select n from t)
  union all select 'rls:' || relname || ':' || relrowsecurity::text from pg_class where relkind = 'r' and relname in (select n from t)
)
select md5(coalesce(string_agg(item, '|' order by item), '')) as fingerprint, count(*) as items from items;
