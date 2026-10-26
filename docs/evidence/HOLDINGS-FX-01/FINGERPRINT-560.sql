-- FINGERPRINT 560 (read-only). Run before and after each application, and after the rollback rehearsal.
-- One md5 and an item count over the objects 560 can touch: columns, constraints, indexes, policies and
-- triggers of holdings_fx_event and individual_checkout, and the body of holdings_fx_event_append_only.
with items as (
  select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') as item
    from information_schema.columns where table_schema = 'public' and table_name in ('holdings_fx_event', 'individual_checkout')
  union all
  select 'con:' || conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid)
    from pg_constraint where conrelid::regclass::text in ('holdings_fx_event', 'individual_checkout')
  union all
  select 'idx:' || tablename || '.' || indexname || ':' || indexdef
    from pg_indexes where schemaname = 'public' and tablename in ('holdings_fx_event', 'individual_checkout')
  union all
  select 'pol:' || tablename || '.' || policyname from pg_policies where schemaname = 'public' and tablename in ('holdings_fx_event', 'individual_checkout')
  union all
  select 'trg:' || tgrelid::regclass::text || '.' || tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text in ('holdings_fx_event', 'individual_checkout')
  union all
  select 'rls:' || relname || ':' || relrowsecurity::text from pg_class where relname in ('holdings_fx_event', 'individual_checkout') and relkind = 'r'
  union all
  select 'fn:' || proname || ':' || md5(replace(prosrc, chr(13), '')) from pg_proc where proname = 'holdings_fx_event_append_only'
)
select md5(string_agg(item, '|' order by item)) as fingerprint, count(*) as items from items;
