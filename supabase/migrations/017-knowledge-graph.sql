-- ============================================================
-- MIGRATION 017: KNOWLEDGE GRAPH + VECTOR FOUNDATION (Book IV Ch.2–5)
-- Enables pgvector and adds an embeddings table for RAG retrieval.
-- The knowledge_edges table already exists (migration 012); this adds the
-- semantic/vector substrate. Additive & idempotent.
-- ============================================================

-- pgvector is available on Supabase; enable it.
create extension if not exists vector;

-- ── KNOWLEDGE EMBEDDINGS (RAG substrate) ────────────────────
-- One row per governed object chunk; embedding filled by the pipeline once
-- an AI provider key is configured. Dimension 1536 fits common embedding models
-- (OpenAI text-embedding-3-small, Voyage, etc.); adjust if your model differs.
create table if not exists knowledge_embeddings (
  id            uuid primary key default gen_random_uuid(),
  object_type   text not null,          -- framework | domain | practice | cpu | competency | skill | resource | policy
  object_id     uuid not null,
  content       text not null,          -- the text that was embedded
  embedding     vector(1536),           -- null until embedded
  model         text,                   -- which embedding model produced it
  updated_at    timestamptz default now(),
  created_at    timestamptz default now(),
  unique (object_type, object_id)
);

-- Vector similarity index (cosine). Created only if the table has the column.
do $$ begin
  create index if not exists idx_knowledge_embeddings_vec
    on knowledge_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);
exception when others then null; end $$;

create index if not exists idx_knowledge_embeddings_obj on knowledge_embeddings(object_type, object_id);
create index if not exists idx_knowledge_embeddings_null on knowledge_embeddings(object_type) where embedding is null;

-- ── RLS ─────────────────────────────────────────────────────
alter table knowledge_embeddings enable row level security;
do $$ begin
  create policy "Auth read embeddings" on knowledge_embeddings for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Super admin writes embeddings" on knowledge_embeddings for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin'));
exception when duplicate_object then null; end $$;
