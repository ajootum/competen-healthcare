-- VERIFY 442 (READ-ONLY): CKRI K3 educator knowledge improvement. Run before the first apply (for the guard
-- fingerprints) and after each apply. Writes nothing.
-- Expected after a clean apply: 4 tables with RLS on and 0 policies, knowledge_version_id on clinical_content_version,
-- a three-kind subject CHECK, existing clinical_content_version rows unchanged by kind, the five functions not
-- executable by anon or authenticated, the grants, and 0 rows in the four tables.

select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c where c.relname in ('ckri_knowledge_resource', 'ckri_knowledge_version', 'ckri_knowledge_version_competency', 'ckri_learning_need') order by c.relname;

select column_name, is_nullable from information_schema.columns where table_name = 'clinical_content_version' and column_name in ('competency_id', 'case_version_id', 'knowledge_version_id') order by 1;
select pg_get_constraintdef(oid) as subject_check from pg_constraint where conname = 'clinical_content_version_subject_check';

-- Existing review records, by kind: identical before and after.
select content_kind, count(*) from clinical_content_version group by content_kind order by content_kind;
select count(*) as review_decisions from clinical_review_decision;

-- The two shared guards, CR-normalised. Before 442 these are the 422 bodies. After ROLLBACK-442 they must match the
-- before values again.
select proname, md5(replace(prosrc, chr(13), '')) as body_md5, prosrc like '%content_kind = ''resource''%' as has_resource_branch
  from pg_proc where proname in ('clinical_content_version_guard', 'clinical_review_decision_guard') order by proname;

select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p where p.proname in ('ckri_knowledge_review', 'ckri_knowledge_submit', 'ckri_knowledge_approved', 'ckri_knowledge_publish', 'ckri_knowledge_retire') order by p.proname;

select position_code, capability_code from hq_position_capability
 where capability_code in ('hq.learning.ckri.educator', 'hq.quality.knowledge.publish') and effective_to is null order by 1, 2;

select 'ckri_knowledge_resource' as t, count(*) from ckri_knowledge_resource
union all select 'ckri_knowledge_version', count(*) from ckri_knowledge_version
union all select 'ckri_knowledge_version_competency', count(*) from ckri_knowledge_version_competency
union all select 'ckri_learning_need', count(*) from ckri_learning_need;
