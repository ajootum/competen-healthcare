-- 138: CAP-006 Semantic / Vector Search — query path over the existing vector substrate (migration 017:
-- pgvector + knowledge_embeddings + ivfflat cosine index). Adds a hospital_id column for tenant-scoped
-- retrieval and the match_assets() kNN function. The embedding column stays vector(1536); the indexing
-- pipeline (src/lib/search/indexer.ts) fills embeddings only when an embedding provider is configured.
-- match_assets is a single-statement SQL function (no internal semicolons) — safe for any migration runner.

alter table knowledge_embeddings add column if not exists hospital_id uuid references hospitals(id) on delete cascade;
create index if not exists idx_knowledge_embeddings_hospital on knowledge_embeddings(hospital_id);

-- Vector kNN over the cosine index. query_embedding is passed as text (a "[..]" vector literal) and cast
-- inside, which binds reliably through PostgREST. Returns cosine similarity (1 - distance).
create or replace function match_assets(query_embedding text, match_count int default 20, p_hospital uuid default null)
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

grant execute on function match_assets(text, int, uuid) to authenticated;

notify pgrst, 'reload schema';
