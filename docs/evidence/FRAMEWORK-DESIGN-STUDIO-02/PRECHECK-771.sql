-- ====================================================================================================
-- PRECHECK-771 (STAGING, READ ONLY). The state 771 depends on and must leave unchanged, as one row per item.
-- Run before 771, after each application, after the rollback rehearsal, and after the re-application.
-- ====================================================================================================

select 'fn ' || p.proname as item, md5(p.prosrc) as value
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in (
   'framework_revision_competency_guard', 'clinical_scope_covers_domain', 'clinical_content_version_sod_floor', 'clinical_review_decision_sod_guard',
   'framework_revision_problem', 'frameworks_revision_apply_on_publish',
   'clinical_content_version_guard', 'clinical_review_decision_guard', 'cfca_framework_publication_guard', 'frameworks_sod_publication_guard',
   'competency_content_hash', 'competency_clinically_approved', 'framework_revision_competency_hash', 'framework_revision_guard',
   'framework_revision_criterion_guard', 'frameworks_revision_release_on_publish', 'frameworks_layout_apply_on_publish', 'framework_layout_problem',
   'framework_areas_scope_guard', 'framework_revision_structure_guard', 'framework_revision_proposal_guard',
   'framework_revision_domain_known', 'framework_revision_practice_known')
union all select 'triggers', string_agg(c.relname || '.' || t.tgname || ':' || t.tgtype, ',' order by c.relname, t.tgname) from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where c.relname in ('frameworks', 'framework_domains', 'practices', 'clinical_practice_units', 'framework_revision', 'framework_revision_competency',
                     'framework_revision_criterion', 'framework_revision_domain', 'framework_revision_practice', 'framework_revision_cpu') and not t.tgisinternal
union all select 'revision constraints', md5(string_agg(conrelid::regclass::text || '.' || conname || '=' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname))
  from pg_constraint where conrelid in ('framework_revision'::regclass, 'framework_revision_competency'::regclass, 'framework_revision_criterion'::regclass)
union all select 'revision_competency fks', string_agg(conname, ',' order by conname) from pg_constraint where conrelid = 'framework_revision_competency'::regclass and contype = 'f'
union all select 'framework_revision columns', string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'framework_revision'
union all select 'tables 770/771', string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema = 'public' and table_name like 'framework_revision%'
union all select 'counts', (select count(*) from frameworks)::text || ' fw, ' || (select count(*) from framework_domains)::text || ' domains, '
   || (select count(*) from practices)::text || ' practices, ' || (select count(*) from clinical_practice_units)::text || ' cpus, '
   || (select count(*) from framework_competencies)::text || ' comp, ' || (select count(*) from competency_skills)::text || ' crit, '
   || (select count(*) from clinical_content_version)::text || ' versions, ' || (select count(*) from clinical_review_decision)::text || ' decisions, '
   || (select count(*) from framework_versions)::text || ' fw versions, ' || (select count(*) from framework_revision)::text || ' revisions'
union all select 'framework_fp', md5(string_agg(f.id::text || ':' || f.name || ':' || coalesce(f.description, '') || ':' || coalesce(f.pub_status, '') || ':'
   || coalesce(f.version_major, 0) || '.' || coalesce(f.version_minor, 0) || '.' || coalesce(f.version_revision, 0), ',' order by f.id)) from frameworks f
union all select 'domains_fp', md5(string_agg(d.id::text || ':' || d.framework_id || ':' || d.name || ':' || coalesce(d.code, '') || ':' || coalesce(d.sort_order, 0)
   || ':' || coalesce(d.area_id::text, '-'), ',' order by d.id)) from framework_domains d
union all select 'practices_fp', md5(coalesce(string_agg(p.id::text || ':' || p.domain_id || ':' || p.name || ':' || coalesce(p.description, '') || ':' || coalesce(p.code, ''), ',' order by p.id), '')) from practices p
union all select 'cpus_fp', md5(coalesce(string_agg(u.id::text || ':' || u.practice_id || ':' || u.name || ':' || coalesce(u.description, '') || ':' || coalesce(u.code, '')
   || ':' || coalesce(u.risk_category, ''), ',' order by u.id), '')) from clinical_practice_units u
union all select 'hash_fp', md5(string_agg(c.id::text || ':' || public.competency_content_hash(c.id), ',' order by c.id)) from framework_competencies c
union all select 'content_fp', md5(string_agg(c.id::text || ':' || c.name || ':' || coalesce(c.code, '') || ':' || c.learning_outcome_ids::text || ':' || coalesce(c.sort_order, 0)
   || ':' || c.domain_id || ':' || coalesce(c.practice_id::text, '-') || ':' || coalesce(c.cpu_id::text, '-'), ',' order by c.id)) from framework_competencies c
union all select 'criteria_fp', md5(string_agg(s.id::text || ':' || s.competency_id || ':' || s.name || ':' || coalesce(s.component_code, '') || ':' || s.sort_order || ':' || s.is_active, ',' order by s.id)) from competency_skills s
union all select 'versions_fp', md5(string_agg(v.id::text || ':' || coalesce(v.competency_id::text, '-') || ':' || v.content_hash || ':' || v.required_approvals, ',' order by v.id)) from clinical_content_version v
union all select 'evidence_fp', md5(coalesce(string_agg(e.id::text || ':' || e.outcome_ids::text, ',' order by e.id), '')) from competency_verification_evidence e
union all select 'approved_now', count(*) filter (where public.competency_clinically_approved(c.id))::text || ' of ' || count(*)::text from framework_competencies c;
