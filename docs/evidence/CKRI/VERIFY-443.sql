-- VERIFY 443 (READ-ONLY): CKRI K4 research workspace. Run after each apply. Writes nothing.
-- Expected after a clean apply: 7 tables with RLS on and 0 policies, the extra project trigger beside the 440 guard,
-- aggregate_only the only member access value, the grants, and 0 rows.

select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c where c.relname in ('ckri_research_member', 'ckri_research_document', 'ckri_research_dataset', 'ckri_research_output', 'ckri_research_review', 'ckri_publication', 'ckri_publication_event')
 order by c.relname;

select tgname from pg_trigger where tgrelid = 'ckri_research_project'::regclass and not tgisinternal order by tgname;

select conname, pg_get_constraintdef(oid) like '%aggregate_only%' as aggregate_only from pg_constraint where conname = 'ckri_research_member_check';

select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p where p.proname in ('ckri_on_team', 'ckri_publication_correct') order by p.proname;

select position_code, capability_code from hq_position_capability where capability_code = 'hq.quality.research.review' and effective_to is null;

select 'ckri_research_member' as t, count(*) from ckri_research_member
union all select 'ckri_research_document', count(*) from ckri_research_document
union all select 'ckri_research_dataset', count(*) from ckri_research_dataset
union all select 'ckri_research_output', count(*) from ckri_research_output
union all select 'ckri_research_review', count(*) from ckri_research_review
union all select 'ckri_publication', count(*) from ckri_publication
union all select 'ckri_publication_event', count(*) from ckri_publication_event;

select md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), '|' order by table_name, ordinal_position)) as ckri_443_fingerprint
  from information_schema.columns where table_schema = 'public'
   and table_name in ('ckri_research_member', 'ckri_research_document', 'ckri_research_dataset', 'ckri_research_output', 'ckri_research_review', 'ckri_publication', 'ckri_publication_event');
