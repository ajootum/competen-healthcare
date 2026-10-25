-- FINGERPRINT 465 and 466. Read-only. Run PRE (before applying), after each apply, after the rollback, and after the
-- re-apply. Each line is md5 of the objects the migration owns, or null when they are absent, with an item count.

-- 465: the capability, the position and their live grants.
select '465' as migration,
  md5(coalesce((select string_agg(x, '|' order by x) from (
    select 'cap:' || code || ':' || space || ':' || label || ':' || description as x from hq_capability where code = 'hq.quality.competency.author'
    union all select 'pos:' || code || ':' || space || ':' || name || ':' || description from hq_position where code = 'competency_author'
    union all select 'grant:' || position_code || ':' || capability_code || ':' || source from hq_position_capability
      where (position_code = 'competency_author' or capability_code = 'hq.quality.competency.author') and effective_to is null
  ) t), '')) as fp,
  (select count(*) from hq_capability where code = 'hq.quality.competency.author')
  + (select count(*) from hq_position where code = 'competency_author')
  + (select count(*) from hq_position_capability where (position_code = 'competency_author' or capability_code = 'hq.quality.competency.author') and effective_to is null) as items;

-- 466: the two function bodies and the trigger definition.
select '466' as migration,
  md5(coalesce((select string_agg(x, '|' order by x) from (
    select pg_get_functiondef(p.oid) as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('competency_clinically_approved', 'cfca_framework_publication_guard')
    union all select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgname = 'trg_cfca_framework_publication_guard' and not t.tgisinternal
  ) t), '')) as fp,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('competency_clinically_approved', 'cfca_framework_publication_guard'))
  + (select count(*) from pg_trigger where tgname = 'trg_cfca_framework_publication_guard' and not tgisinternal) as items;
