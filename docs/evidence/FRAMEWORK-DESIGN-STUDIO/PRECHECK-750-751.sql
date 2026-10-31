-- ====================================================================================================
-- APPLY THIS FILE WHOLE. PRECHECK for migrations 750 and 751, STAGING ONLY. Read-only. It ends by raising its
-- findings as an exception, so the runner rolls back and nothing is ever committed.
-- ====================================================================================================

do $pre$
declare
  r text := '';
  v record;
begin
  r := r || 'frameworks=' || (select count(*) from frameworks)
         || ' published_shared=' || (select count(*) from frameworks where hospital_id is null and pub_status = 'published')
         || ' competencies=' || (select count(*) from framework_competencies)
         || ' with_outcomes=' || (select count(*) from framework_competencies where jsonb_array_length(learning_outcomes) > 0)
         || ' outcomes_total=' || (select coalesce(sum(jsonb_array_length(learning_outcomes)), 0) from framework_competencies)
         || ' dup_outcome_competencies=' || (select count(*) from framework_competencies c
              where (select count(*) from jsonb_array_elements(c.learning_outcomes)) <> (select count(distinct x) from jsonb_array_elements(c.learning_outcomes) x))
         || ' non_string_outcomes=' || (select count(*) from framework_competencies c, jsonb_array_elements(c.learning_outcomes) x where jsonb_typeof(x) <> 'string')
         || ' vreq=' || (select count(*) from competency_verification_request)
         || ' vreq_snapshot_null=' || (select count(*) from competency_verification_request where competency_snapshot is null)
         || ' vevid=' || (select count(*) from competency_verification_evidence)
         || ' vdec=' || (select count(*) from competency_verification_decision)
         || ' audit_reorder_layout=' || (select count(*) from audit_log where action = 'reorder_layout')
         || '; ';
  r := r || 'cols_present=' || coalesce((select string_agg(table_name || '.' || column_name, ',' order by table_name, column_name)
          from information_schema.columns where table_schema = 'public'
           and column_name in ('layout_draft', 'layout_draft_by', 'layout_draft_at', 'component_order', 'learning_outcome_ids', 'outcome_ids', 'outcome_map')), 'none') || '; ';
  r := r || 'triggers_fc=' || coalesce((select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'framework_competencies'::regclass and not tgisinternal), 'none')
         || ' triggers_fw=' || coalesce((select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'frameworks'::regclass and not tgisinternal), 'none')
         || ' triggers_req=' || coalesce((select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'competency_verification_request'::regclass and not tgisinternal), 'none')
         || ' triggers_evid=' || coalesce((select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'competency_verification_evidence'::regclass and not tgisinternal), 'none')
         || '; ';
  for v in select p.proname, md5(pg_get_functiondef(p.oid)) as h from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('clinical_review_decision_sod_guard', 'frameworks_sod_publication_guard', 'clinical_review_decision_guard',
              'competency_verification_request_guard', 'competency_verification_evidence_guard', 'competency_content_hash',
              'competency_outcome_ids_valid', 'framework_competencies_outcome_ids', 'frameworks_layout_guard', 'competency_verification_outcome_ids')
            order by p.proname loop
    r := r || v.proname || '=' || v.h || ' ';
  end loop;
  r := r || '; content_fp=' || (select md5(string_agg(c.id::text || ':' || competency_content_hash(c.id), ',' order by c.id)) from framework_competencies c);
  raise exception 'PRECHECK %', r;
end
$pre$;
