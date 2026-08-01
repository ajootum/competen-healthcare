-- ============================================================
-- MIGRATION 167: TENANT-SCOPE THE CLINICAL LIBRARY SEARCH
--
-- search_ckcm() is called through the SERVICE-ROLE client by /api/library, /api/ai/assistant and the
-- CAP-006 hybrid search. The service role bypasses RLS, and the function took no tenant argument, so four
-- of its branches read tenant-owned tables unfiltered: frameworks, learning_resources, policies and
-- quality_objects. Any authenticated user of any hospital could search every other hospital's governed
-- content, including the first 300 characters of policy text. Not leaking today only because those tables
-- are empty or shared -- which is luck, not a control.
--
-- Two changes, both required:
--
--   1. p_hospital is now MANDATORY (no default). The 2-arg overload is dropped, so a caller that forgets
--      the argument gets a loud PostgREST 404, never a silent cross-tenant result. This deliberately
--      differs from match_assets(), where p_hospital defaults to null; there, omission opens the query.
--      Semantics of an EXPLICIT null are identical to match_assets: null = unrestricted (super-admin).
--      Callers pass the nil uuid, not null, for a user with no hospital.
--
--   2. The quality_object branch is restored. Migration 019 redefined this function to add it and was
--      never applied to this database, so library search has been silently returning no quality objects.
--      Verified live: a search for a word from a quality object's own title returns nothing.
--
-- Branches over clinical_practice_units, framework_competencies and competency_skills stay unfiltered:
-- those tables have no hospital_id and are shared master content by design.
--
-- Additive and idempotent.
-- ============================================================

drop function if exists search_ckcm(text, int);

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
  where to_tsvector('english', u.name || ' ' || coalesce(u.description, '')) @@ tsq.query

  union all
  select 'competency', c.id, c.name, coalesce(c.description, ''),
         ts_rank(to_tsvector('english', c.name || ' ' || coalesce(c.description, '')), tsq.query)
  from framework_competencies c, tsq
  where to_tsvector('english', c.name || ' ' || coalesce(c.description, '')) @@ tsq.query

  union all
  select 'skill', s.id, s.name, '',
         ts_rank(to_tsvector('english', s.name), tsq.query)
  from competency_skills s, tsq
  where to_tsvector('english', s.name) @@ tsq.query

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
  where (p_hospital is null or p.hospital_id is null or p.hospital_id = p_hospital)
    and to_tsvector('english', p.title || ' ' || coalesce(p.content, '')) @@ tsq.query

  union all
  select 'quality_object', qo.id, qo.title,
         coalesce(qo.description, '') || ' ' || coalesce(qo.purpose, ''),
         ts_rank(to_tsvector('english', qo.title || ' ' || coalesce(qo.description, '') || ' ' || coalesce(qo.purpose, '')), tsq.query)
  from quality_objects qo, tsq
  where qo.status <> 'retired'
    and (p_hospital is null or qo.hospital_id is null or qo.hospital_id = p_hospital)
    and to_tsvector('english', qo.title || ' ' || coalesce(qo.description, '') || ' ' || coalesce(qo.purpose, '')) @@ tsq.query
)
select * from hits order by rank desc limit greatest(max_results, 1)
$$;

grant execute on function search_ckcm(text, uuid, int) to authenticated;

notify pgrst, 'reload schema';
