-- VERIFY 500. Read-only. Every line should read true.
-- Proves: the actions exist and only the service role may call them, the guards are on both tables, no
-- live position already holds an excluded pair, and the migration wrote no position, grant or appointment.

select 'the twelve functions exist' as check, (
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in (
     'hq_actor_is_owner', 'hq_capability_sensitive_class', 'hq_capability_exclusions',
     'hq_position_capability_guard', 'hq_position_guard', 'hq_position_admin_require',
     'hq_position_admin_create', 'hq_position_admin_update', 'hq_position_admin_set_active',
     'hq_position_admin_grant', 'hq_position_admin_end_grant', 'hq_position_admin_register')) = 12 as ok
union all select 'both guard triggers are enabled', (
  select count(*) from pg_trigger where tgname in ('hq_position_capability_guard', 'hq_position_guard')
     and not tgisinternal and tgenabled = 'O') = 2
union all select 'the three grant columns exist', (
  select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hq_position_capability'
     and column_name in ('grant_reason', 'ended_by', 'end_reason')) = 3
union all select 'no browser role may call an action', not exists (
  select 1 from pg_proc p where (p.proname like 'hq_position_admin%' or p.proname = 'hq_actor_is_owner')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))
union all select 'the service role may call every action', not exists (
  select 1 from pg_proc p where (p.proname like 'hq_position_admin%' or p.proname = 'hq_actor_is_owner')
     and not has_function_privilege('service_role', p.oid, 'execute'))
union all select 'ten excluded pairs', (select count(*) from hq_capability_exclusions()) = 10
union all select 'no live position holds an excluded pair', not exists (
  select 1 from hq_position_capability g1
    join hq_position_capability g2 on g2.position_code = g1.position_code
    join hq_capability_exclusions() e on e.capability_a = g1.capability_code and e.capability_b = g2.capability_code
   where g1.effective_to is null and g2.effective_to is null)
union all select 'no grant was written with a 500 reason column', not exists (
  select 1 from hq_position_capability where grant_reason is not null or ended_by is not null or end_reason is not null)
union all select 'no audit row from a screen action yet', not exists (
  select 1 from audit_log where action in ('hq_position_create', 'hq_position_update', 'hq_position_deactivate',
     'hq_position_reactivate', 'hq_position_grant', 'hq_position_end_grant', 'hq_capability_register'));
