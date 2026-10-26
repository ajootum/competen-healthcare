-- FINGERPRINT 580. Read-only. Run PRE (before applying), after each apply, after the rollback, and after the
-- re-apply. PRE and post-rollback must match. Both applies, and the re-apply, must match each other.

select '580' as migration,
  md5(coalesce((select string_agg(x, '|' order by x) from (
    select 'cap:' || code || ':' || space || ':' || label || ':' || description as x from hq_capability where code = 'hq.quality.competency.publish'
    union all select 'grant:' || position_code || ':' || capability_code || ':' || source from hq_position_capability
      where capability_code = 'hq.quality.competency.publish' and effective_to is null
    union all select 'fn:' || pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'hq_capability_exclusions'
  ) t), '')) as fp,
  (select count(*) from hq_capability where code = 'hq.quality.competency.publish')
  + (select count(*) from hq_position_capability where capability_code = 'hq.quality.competency.publish' and effective_to is null) as items,
  (select count(*) from hq_capability_exclusions()) as exclusion_pairs;
