-- ====================================================================================================
-- PRECHECK-770 (STAGING, READ ONLY). The state 770 depends on and must leave unchanged, as one row per item.
-- Run before 770, after each application, after the rollback rehearsal, and after the re-application.
-- ====================================================================================================

select 'fn ' || p.proname as item, md5(p.prosrc) as value
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in (
   'clinical_content_version_guard', 'clinical_content_version_sod_floor', 'clinical_review_decision_guard', 'clinical_review_decision_sod_guard',
   'cfca_framework_publication_guard', 'frameworks_sod_publication_guard', 'competency_content_hash', 'competency_content_hashes',
   'competency_clinically_approved', 'clinical_scope_covers', 'clinical_review_decision_scope_guard', 'clinical_review_decision_method_sod_690',
   'frameworks_layout_apply_on_publish', 'frameworks_layout_guard', 'framework_layout_problem', 'framework_competencies_outcome_ids',
   'framework_revision_competency_hash', 'frameworks_revision_apply_on_publish')
union all select 'triggers frameworks', string_agg(t.tgname || ':' || t.tgtype, ',' order by t.tgname) from pg_trigger t
 where t.tgrelid = 'frameworks'::regclass and not t.tgisinternal
union all select 'triggers ccv+decision', string_agg(c.relname || '.' || t.tgname, ',' order by c.relname, t.tgname) from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where c.relname in ('clinical_content_version', 'clinical_review_decision', 'framework_competencies', 'competency_skills') and not t.tgisinternal
union all select 'ccv constraints', md5(string_agg(conname || '=' || pg_get_constraintdef(oid), ',' order by conname)) from pg_constraint where conrelid = 'clinical_content_version'::regclass
union all select 'ccv columns', string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'clinical_content_version'
union all select 'tables 770', count(*)::text from information_schema.tables where table_schema = 'public' and table_name like 'framework_revision%'
union all select 'counts', (select count(*) from frameworks)::text || ' fw, ' || (select count(*) from framework_competencies)::text || ' comp, '
   || (select count(*) from competency_skills)::text || ' crit, ' || (select count(*) from competency_skills where is_active is false)::text || ' retired, '
   || (select count(*) from clinical_content_version)::text || ' versions, ' || (select count(*) from clinical_review_decision)::text || ' decisions, '
   || (select count(*) from framework_versions)::text || ' fw versions'
union all select 'hash_fp', md5(string_agg(c.id::text || ':' || public.competency_content_hash(c.id), ',' order by c.id)) from framework_competencies c
union all select 'content_fp', md5(string_agg(c.id::text || ':' || c.name || ':' || coalesce(c.code, '') || ':' || c.learning_outcome_ids::text || ':' || coalesce(c.sort_order, 0)
   || ':' || c.domain_id, ',' order by c.id)) from framework_competencies c
union all select 'criteria_fp', md5(string_agg(s.id::text || ':' || s.competency_id || ':' || s.name || ':' || coalesce(s.component_code, '') || ':' || s.sort_order || ':' || s.is_active, ',' order by s.id)) from competency_skills s
union all select 'versions_fp', md5(string_agg(v.id::text || ':' || coalesce(v.competency_id::text, '-') || ':' || v.content_hash, ',' order by v.id)) from clinical_content_version v
union all select 'evidence_fp', md5(coalesce(string_agg(e.id::text || ':' || e.outcome_ids::text, ',' order by e.id), '')) from competency_verification_evidence e
union all select 'requests_fp', md5(coalesce(string_agg(q.id::text || ':' || q.outcome_ids::text || ':' || q.outcome_map::text, ',' order by q.id), '')) from competency_verification_request q
union all select 'approved_now', count(*) filter (where public.competency_clinically_approved(c.id))::text || ' of ' || count(*)::text from framework_competencies c;
