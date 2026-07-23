-- ============================================================
-- MIGRATION 058: APPROVED-ONLY AI GROUNDING
-- search_ckcm (the AI assistant's retrieval function, last
-- replaced in migration 026) leaked unapproved content into the
-- grounding context: CPUs had no pub_status filter, knowledge
-- objects / quality objects / clinical cases only excluded
-- 'retired' (drafts included), and policies and skills had no
-- active filter at all. Retrieval must be constrained to
-- approved / published assets only. Additive & idempotent.
--
-- Filters added vs. 026:
--   cpu             u.pub_status = 'published'
--   skill           s.is_active
--   policy          p.is_active
--   quality_object  qo.status = 'active'   (was: <> 'retired')
--   knowledge       k.status = 'active'    (was: <> 'retired')
--   case            cc.status = 'active'   (was: <> 'retired')
-- (frameworks/resources already filtered on is_active;
--  framework_competencies have no status column.)
-- ============================================================

create or replace function search_ckcm(q text, max_results int default 20)
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
    and to_tsvector('english', r.title || ' ' || coalesce(r.description, '')) @@ tsq.query

  union all
  select 'policy', p.id, p.title, left(coalesce(p.content, ''), 300),
         ts_rank(to_tsvector('english', p.title || ' ' || coalesce(p.content, '')), tsq.query)
  from policies p, tsq
  where p.is_active
    and to_tsvector('english', p.title || ' ' || coalesce(p.content, '')) @@ tsq.query

  union all
  select 'quality_object', qo.id, qo.title,
         coalesce(qo.description, '') || ' ' || coalesce(qo.purpose, ''),
         ts_rank(to_tsvector('english', qo.title || ' ' || coalesce(qo.description, '') || ' ' || coalesce(qo.purpose, '')), tsq.query)
  from quality_objects qo, tsq
  where qo.status = 'active'
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
select * from hits order by rank desc limit max_results
$$;

grant execute on function search_ckcm(text, int) to authenticated;

notify pgrst, 'reload schema';
