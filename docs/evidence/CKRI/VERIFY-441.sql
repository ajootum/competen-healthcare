-- VERIFY 441 (READ-ONLY): CKRI K2 aggregate intelligence. Run after each apply. Writes nothing.
-- Expected after a clean apply: 2 tables with RLS on and 0 policies, 2 triggers, 4 functions, the builder and purge
-- not executable by anon or authenticated, no person column in ckri_snapshot_cell, and 0 rows.

select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c where c.relname in ('ckri_snapshot', 'ckri_snapshot_cell') order by c.relname;

select tgname from pg_trigger where tgname in ('ckri_snapshot_guard', 'ckri_snapshot_cell_guard') order by tgname;

select p.proname,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('service_role', p.oid, 'execute') as service_exec
  from pg_proc p where p.proname in ('ckri_build_snapshot', 'ckri_purge_expired_snapshots', 'ckri_holds_capability') order by p.proname;

select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'ckri_snapshot_cell' and (column_name like '%user%' or column_name like '%person%' or column_name like '%profile%');

select 'ckri_snapshot' as t, count(*) from ckri_snapshot union all select 'ckri_snapshot_cell', count(*) from ckri_snapshot_cell;

select md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), '|' order by table_name, ordinal_position)) as ckri_441_fingerprint
  from information_schema.columns where table_schema = 'public' and table_name in ('ckri_snapshot', 'ckri_snapshot_cell');
