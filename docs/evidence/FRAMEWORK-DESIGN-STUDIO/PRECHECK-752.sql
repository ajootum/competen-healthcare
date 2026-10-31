-- ====================================================================================================
-- APPLY THIS FILE WHOLE. PRECHECK for migration 752, STAGING ONLY. Read-only. It ends by raising its findings
-- as an exception, so the runner rolls back and nothing is ever committed.
-- ====================================================================================================

do $pre$
declare
  r text := '';
  v record;
begin
  r := r || 'cols_750=' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'frameworks'
           and column_name in ('layout_draft', 'layout_draft_by', 'layout_draft_at', 'component_order'))
         || ' col_751=' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'framework_competencies' and column_name = 'learning_outcome_ids')
         || ' with_layout=' || (select count(*) from frameworks where layout_draft is not null)
         || ' with_component_order=' || (select count(*) from frameworks where component_order is not null)
         || ' fn_752=' || (select count(*) from pg_proc where proname in ('framework_layout_problem', 'framework_layout_check', 'frameworks_layout_apply_on_publish'))
         || '; ';
  for v in select t.tgname, t.tgtype, pg_get_triggerdef(t.oid) as def from pg_trigger t where t.tgrelid = 'frameworks'::regclass and not t.tgisinternal order by t.tgname loop
    r := r || v.tgname || '(' || case when (v.tgtype & 2) = 2 then 'BEFORE' else 'AFTER' end || case when (v.tgtype & 1) = 1 then ' ROW' else ' STMT' end || ') ';
  end loop;
  r := r || '; triggers_children=' || coalesce((select string_agg(c.relname || '.' || t.tgname, ',' order by c.relname, t.tgname) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relname in ('framework_domains', 'framework_competencies', 'competency_skills') and not t.tgisinternal), 'none') || '; ';
  for v in select p.proname, md5(pg_get_functiondef(p.oid)) as h from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('cfca_framework_publication_guard', 'frameworks_sod_publication_guard', 'frameworks_layout_guard', 'competency_content_hash')
            order by p.proname loop
    r := r || v.proname || '=' || v.h || ' ';
  end loop;
  r := r || '; order_fp=' || md5(
           coalesce((select string_agg(id::text || ':' || coalesce(sort_order::text, '-'), ',' order by id) from framework_domains), '') || '|' ||
           coalesce((select string_agg(id::text || ':' || coalesce(sort_order::text, '-'), ',' order by id) from framework_competencies), '') || '|' ||
           coalesce((select string_agg(id::text || ':' || coalesce(sort_order::text, '-'), ',' order by id) from competency_skills), '') || '|' ||
           coalesce((select string_agg(id::text || ':' || coalesce(array_to_string(component_order, ','), '-'), ',' order by id) from frameworks), ''));
  raise exception 'PRECHECK %', r;
end
$pre$;
