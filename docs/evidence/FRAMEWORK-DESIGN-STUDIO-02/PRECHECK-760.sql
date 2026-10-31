-- ====================================================================================================
-- APPLY THIS FILE WHOLE. PRECHECK for migration 760, STAGING ONLY. Read-only. It ends by raising its findings
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
         || ' fn_752=' || (select count(*) from pg_proc where proname in ('framework_layout_problem', 'framework_layout_check', 'frameworks_layout_apply_on_publish'))
         || ' tbl_760=' || (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'framework_areas')
         || ' col_760=' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'framework_domains' and column_name = 'area_id')
         || ' with_layout=' || (select count(*) from frameworks where layout_draft is not null)
         || ' domains=' || (select count(*) from framework_domains)
         || ' competencies=' || (select count(*) from framework_competencies)
         || '; ';
  for v in select t.tgname, t.tgtype from pg_trigger t where t.tgrelid = 'frameworks'::regclass and not t.tgisinternal order by t.tgname loop
    r := r || v.tgname || '(' || case when (v.tgtype & 2) = 2 then 'BEFORE' else 'AFTER' end || case when (v.tgtype & 1) = 1 then ' ROW' else ' STMT' end || ') ';
  end loop;
  r := r || '; triggers_children=' || coalesce((select string_agg(c.relname || '.' || t.tgname, ',' order by c.relname, t.tgname) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relname in ('framework_domains', 'framework_competencies', 'competency_skills', 'framework_areas') and not t.tgisinternal), 'none') || '; ';
  r := r || 'rls_domains=' || (select relrowsecurity::text from pg_class where oid = 'framework_domains'::regclass)
         || ' policies_domains=' || coalesce((select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, '+'), ',' order by policyname) from pg_policies where tablename = 'framework_domains'), 'none')
         || ' grants_domains=' || coalesce((select string_agg(grantee || ':' || privs, ',' order by grantee) from (
              select grantee, string_agg(privilege_type, '+' order by privilege_type) as privs from information_schema.role_table_grants
               where table_schema = 'public' and table_name = 'framework_domains' group by grantee) g), 'none') || '; ';
  for v in select p.proname, md5(pg_get_functiondef(p.oid)) as h from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('cfca_framework_publication_guard', 'frameworks_sod_publication_guard', 'frameworks_layout_guard',
              'competency_content_hash', 'clinical_review_decision_sod_guard', 'framework_layout_problem', 'frameworks_layout_apply_on_publish', 'framework_layout_check',
              'competency_clinically_approved')
            order by p.proname loop
    r := r || v.proname || '=' || v.h || ' ';
  end loop;
  r := r || '; order_fp=' || md5(
           coalesce((select string_agg(id::text || ':' || coalesce(sort_order::text, '-'), ',' order by id) from framework_domains), '') || '|' ||
           coalesce((select string_agg(id::text || ':' || domain_id::text || ':' || coalesce(sort_order::text, '-'), ',' order by id) from framework_competencies), '') || '|' ||
           coalesce((select string_agg(id::text || ':' || coalesce(sort_order::text, '-'), ',' order by id) from competency_skills), '') || '|' ||
           coalesce((select string_agg(id::text || ':' || coalesce(array_to_string(component_order, ','), '-'), ',' order by id) from frameworks), ''))
         || ' hash_fp=' || md5(coalesce((select string_agg(id::text || ':' || public.competency_content_hash(id), ',' order by id) from framework_competencies), ''));
  raise exception 'PRECHECK %', r;
end
$pre$;
