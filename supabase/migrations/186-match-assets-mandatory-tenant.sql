-- ============================================================
-- MIGRATION 186: MAKE match_assets' TENANT ARGUMENT MANDATORY
--
-- THE FOOTGUN THIS CLOSES. In both of this codebase's search functions, p_hospital = null means
-- UNRESTRICTED -- every tenant. That reads exactly backwards from how a nullable argument normally
-- behaves, and it has already caused one real bug here: `hospitalId ?? null` looks like a safe default
-- and opens the query for precisely the users least entitled to it, because a caller with no hospital of
-- their own is the one who gets null.
--
-- Migration 169 dealt with this for search_ckcm by making p_hospital MANDATORY, so a caller that forgets
-- it gets a loud PostgREST 404 rather than a quiet cross-tenant result set. match_assets kept
-- `default null` and was left as the last live instance of the same trap.
--
-- Nothing is broken today: the single caller, src/lib/search/hybrid.ts, passes the argument correctly
-- (nil uuid for a caller with no hospital, explicit null only for super_admin). This is about the NEXT
-- caller. A default that means "show everything" is a hole waiting for someone who does not know the
-- convention, and semantic hits feed the AI grounding context, so the blast radius is the same as
-- search_ckcm's was.
--
-- ARGUMENT ORDER CHANGES, deliberately, to match search_ckcm(q, p_hospital, max_results). Postgres will
-- not accept a parameter without a default after one that has a default, so p_hospital has to move ahead
-- of match_count. Two consequences, both handled:
--   * the signature becomes (text, uuid, int), so this is a NEW function, not a replacement -- the old
--     (text, int, uuid) overload is dropped explicitly. `create or replace` with a different argument
--     list creates an OVERLOAD rather than replacing, which would leave the permissive version callable.
--   * the caller uses NAMED arguments, so the reordering does not touch it.
--
-- `create or replace` alone could not have done this in any case: Postgres refuses to remove a parameter
-- default from an existing function and tells you to drop it first.
--
-- Body is migration 138's, unchanged. Only the signature moves.
--
-- Idempotent: both drops are guarded, and the create replaces itself on a re-run.
-- ============================================================

drop function if exists match_assets(text, int, uuid);
drop function if exists match_assets(text, uuid, int);

create or replace function match_assets(query_embedding text, p_hospital uuid, match_count int default 20)
returns table(object_type text, object_id uuid, content text, similarity real)
language sql stable
as $$
  select ke.object_type, ke.object_id, ke.content,
         (1 - (ke.embedding <=> query_embedding::vector))::real as similarity
  from knowledge_embeddings ke
  where ke.embedding is not null
    and (p_hospital is null or ke.hospital_id is null or ke.hospital_id = p_hospital)
  order by ke.embedding <=> query_embedding::vector
  limit greatest(match_count, 1)
$$;

grant execute on function match_assets(text, uuid, int) to authenticated;

notify pgrst, 'reload schema';
