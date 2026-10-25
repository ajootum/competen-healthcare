-- VERIFY 440 (READ-ONLY): CKRI K1 research governance. Run after each apply. Writes nothing.
-- Expected after a clean apply: 5 tables with RLS on, 2 read-own policies, 6 triggers, 7 functions,
-- 5 position grants, 2 positions, 2 capabilities, and 0 rows in every CKRI table.

select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c
 where c.relname in ('ckri_purpose', 'ckri_research_project', 'ckri_research_project_event', 'ckri_participation', 'ckri_participation_event')
 order by c.relname;

select tgname, tgrelid::regclass as on_table from pg_trigger
 where tgname like 'ckri_%' and not tgisinternal order by tgname;

select proname from pg_proc where proname like 'ckri_%' order by proname;

select conname, pg_get_constraintdef(oid) like '%aggregate_only%' as aggregate_only
  from pg_constraint where conname in ('ckri_purpose_check', 'ckri_research_project_check', 'ckri_participation_check', 'ckri_participation_event_check')
 order by conname;

select position_code, capability_code from hq_position_capability
 where (capability_code like 'hq.quality.research.%' or position_code in ('research_governance_officer', 'research_lead')) and effective_to is null
 order by position_code, capability_code;

select code, space from hq_capability where code like 'hq.quality.research.%' order by code;
select code, space from hq_position where code in ('research_governance_officer', 'research_lead') order by code;

select 'ckri_purpose' as t, count(*) from ckri_purpose
union all select 'ckri_research_project', count(*) from ckri_research_project
union all select 'ckri_research_project_event', count(*) from ckri_research_project_event
union all select 'ckri_participation', count(*) from ckri_participation
union all select 'ckri_participation_event', count(*) from ckri_participation_event;

-- Schema fingerprint: identical after the second apply proves idempotence.
select md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), '|' order by table_name, ordinal_position)) as ckri_440_fingerprint
  from information_schema.columns where table_schema = 'public' and table_name like 'ckri_%';
