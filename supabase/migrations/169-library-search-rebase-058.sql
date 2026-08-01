-- ============================================================
-- MIGRATION 169: REBASE search_ckcm ONTO 058 (fixes a regression in 167)
--
-- MIGRATION 167 WAS BUILT ON THE WRONG PARENT. It took its body from migration 019, on the assumption
-- that 019 was the last definition. It was not. The real lineage is:
--
--   018  original 6 branches
--   019  + quality_object
--   025  + knowledge
--   026  + case
--   058  APPROVED-ONLY GROUNDING: pub_status/is_active/status='active' filters on cpu, skill, policy,
--        quality_object, knowledge and case, so drafts and retired assets stop reaching the AI grounding
--        context
--   167  tenant scoping -- rebased on 019, so it silently reverted 025, 026 and 058
--
-- What 167 removed, live: the cpu pub_status='published' filter, the skill is_active filter, the policy
-- is_active filter, quality_object went from status='active' back to <> 'retired' (drafts included
-- again), and the knowledge and case branches disappeared entirely. 058 exists precisely to keep
-- unapproved content out of AI answers, so 167 reopened the defect 058 closed.
--
-- This restores 058 verbatim and adds the tenant scoping on top, which is what 167 should have been.
--
-- HOW IT WAS FOUND: scripts/function-drift-audit.ts. The deployed body before 167 was still 018's, so
-- 019, 025, 026 AND 058 had all failed to reach this database -- four missed redefinitions, invisible
-- because the signature never changed and every call returned 200.
--
-- TENANT SCOPING, unchanged from 167 and applied to the four tables that have a hospital_id. Verified
-- against the live schema: knowledge_objects and clinical_cases have NO hospital_id and are shared master
-- content, so their branches take no tenant filter, exactly like cpu, competency and skill.
--
-- Additive and idempotent.
-- ============================================================

create or replace function search_ckcm(q text, p_hospital uuid, max_results int default 20)
returns table(object_type text, object_id uuid, title text, snippet text, rank real)
language sql stable
as $$
with tsq as (select websearch_to_tsquery('english', q) as query),
hits as (
  select 'framework'::text as object_type, f.id as object_id, f.name as title,
         coalesce(f.description, '') as snippet,
         ts_rank(to_tsvector('english', f.name || ' ' || coalesce(f.description, '')), tsq.query) as rank
  from frameworks f, tsq
  where f.is_active
    and (p_hospital is null or f.hospital_id is null or f.hospital_id = p_hospital)
    and to_tsvector('english', f.name || ' ' || coalesce(f.description, '')) @@ tsq.query

  union all
  select 'cpu', u.id, u.name, coalesce(u.description, ''),
         ts_rank(to_tsvector('english', u.name || ' ' || coalesce(u.description, '')), tsq.query)
  from clinical_practice_units u, tsq
  where u.pub_status = 'published'
    and to_tsvector('english', u.name || ' ' || coalesce(u.description, '')) @@ tsq.query

  union all
  select 'competency', c.id, c.name, coalesce(c.description, ''),
         ts_rank(to_tsvector('english', c.name || ' ' || coalesce(c.description, '')), tsq.query)
  from framework_competencies c, tsq
  where to_tsvector('english', c.name || ' ' || coalesce(c.description, '')) @@ tsq.query

  union all
  select 'skill', s.id, s.name, '',
         ts_rank(to_tsvector('english', s.name), tsq.query)
  from competency_skills s, tsq
  where s.is_active
    and to_tsvector('english', s.name) @@ tsq.query

  union all
  select 'resource', r.id, r.title, coalesce(r.description, ''),
         ts_rank(to_tsvector('english', r.title || ' ' || coalesce(r.description, '')), tsq.query)
  from learning_resources r, tsq
  where r.is_active
    and (p_hospital is null or r.hospital_id is null or r.hospital_id = p_hospital)
    and to_tsvector('english', r.title || ' ' || coalesce(r.description, '')) @@ tsq.query

  union all
  select 'policy', p.id, p.title, left(coalesce(p.content, ''), 300),
         ts_rank(to_tsvector('english', p.title || ' ' || coalesce(p.content, '')), tsq.query)
  from policies p, tsq
  where p.is_active
    and (p_hospital is null or p.hospital_id is null or p.hospital_id = p_hospital)
    and to_tsvector('english', p.title || ' ' || coalesce(p.content, '')) @@ tsq.query

  union all
  select 'quality_object', qo.id, qo.title,
         coalesce(qo.description, '') || ' ' || coalesce(qo.purpose, ''),
         ts_rank(to_tsvector('english', qo.title || ' ' || coalesce(qo.description, '') || ' ' || coalesce(qo.purpose, '')), tsq.query)
  from quality_objects qo, tsq
  where qo.status = 'active'
    and (p_hospital is null or qo.hospital_id is null or qo.hospital_id = p_hospital)
    and to_tsvector('english', qo.title || ' ' || coalesce(qo.description, '') || ' ' || coalesce(qo.purpose, '')) @@ tsq.query

  union all
  select 'knowledge', k.id, k.title,
         left(coalesce(k.summary, k.content, ''), 300),
         ts_rank(to_tsvector('english', k.title || ' ' || coalesce(k.summary, '') || ' ' || coalesce(k.content, '')), tsq.query)
  from knowledge_objects k, tsq
  where k.status = 'active'
    and to_tsvector('english', k.title || ' ' || coalesce(k.summary, '') || ' ' || coalesce(k.content, '')) @@ tsq.query

  union all
  select 'case', cc.id, cc.title,
         left(coalesce(cc.scenario, ''), 300),
         ts_rank(to_tsvector('english', cc.title || ' ' || coalesce(cc.scenario, '') || ' ' || coalesce(cc.discussion, '')), tsq.query)
  from clinical_cases cc, tsq
  where cc.status = 'active'
    and to_tsvector('english', cc.title || ' ' || coalesce(cc.scenario, '') || ' ' || coalesce(cc.discussion, '')) @@ tsq.query
)
select * from hits order by rank desc limit greatest(max_results, 1)
$$;

grant execute on function search_ckcm(text, uuid, int) to authenticated;

notify pgrst, 'reload schema';
