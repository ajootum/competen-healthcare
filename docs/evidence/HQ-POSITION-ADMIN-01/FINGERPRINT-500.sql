-- FINGERPRINT 500. Read-only. Run PRE (before applying), after each apply, after the rollback and after the
-- re-apply. md5 of every object migration 500 owns (function bodies, trigger definitions, the three grant
-- columns), or the md5 of an empty string when they are all absent, with an item count.
-- Expected: PRE = after ROLLBACK (0 items), and apply 1 = apply 2 = re-apply (17 items).

select '500' as migration,
  md5(coalesce((select string_agg(x, '|' order by x) from (
    select pg_get_functiondef(p.oid) as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'hq_actor_is_owner', 'hq_capability_sensitive_class', 'hq_capability_exclusions',
       'hq_position_capability_guard', 'hq_position_guard', 'hq_position_admin_require',
       'hq_position_admin_create', 'hq_position_admin_update', 'hq_position_admin_set_active',
       'hq_position_admin_grant', 'hq_position_admin_end_grant', 'hq_position_admin_register')
    union all select pg_get_triggerdef(t.oid) from pg_trigger t
     where t.tgname in ('hq_position_capability_guard', 'hq_position_guard') and not t.tgisinternal
    union all select 'col:' || column_name || ':' || data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'hq_position_capability'
       and column_name in ('grant_reason', 'ended_by', 'end_reason')
  ) t), '')) as fp,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'hq_actor_is_owner', 'hq_capability_sensitive_class', 'hq_capability_exclusions',
      'hq_position_capability_guard', 'hq_position_guard', 'hq_position_admin_require',
      'hq_position_admin_create', 'hq_position_admin_update', 'hq_position_admin_set_active',
      'hq_position_admin_grant', 'hq_position_admin_end_grant', 'hq_position_admin_register'))
  + (select count(*) from pg_trigger where tgname in ('hq_position_capability_guard', 'hq_position_guard') and not tgisinternal)
  + (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hq_position_capability'
      and column_name in ('grant_reason', 'ended_by', 'end_reason')) as items;

-- The data 500 must not touch: positions, live grants and HQ appointments. Identical PRE and after apply.
select 'data' as what,
  (select count(*) from hq_position) as positions,
  (select count(*) from hq_position_capability) as grant_rows,
  (select count(*) from hq_position_capability where effective_to is null) as live_grants,
  (select count(*) from hq_capability) as capabilities,
  (select count(*) from ogs_office_appointments) as appointments;
