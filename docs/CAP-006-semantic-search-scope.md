# CAP-006 — Semantic / Vector Search: Implementation Scope

**Status:** Scoping · **Source specs:** CAP-006 (Search & Discovery Engine), CAP-R006 (AI Integration & Semantic Search Architecture), CAP-I004 (AI & Semantic Search Implementation Guide)

## Verdict

This is a **bounded build, not greenfield infrastructure.** The hard, expensive-to-change decisions — pgvector, the embedding table, the vector index, and the embedding-model config — **already exist** in the codebase. What's missing is the *pipeline* (generate embeddings), the *query path* (kNN over the index), the *hybrid ranking*, and the *search surface*. Estimated **~1.5–2 weeks** of focused engineering, most of which can be built **dormant** (no paid API calls) and activated by a one-time backfill once an embedding provider key is set.

---

## 1. Current state (what already exists)

| Piece | Where | State |
|---|---|---|
| pgvector extension | `supabase/migrations/017` (`create extension if not exists vector`) | ✅ enabled |
| Embedding table | `knowledge_embeddings(object_type, object_id, content, embedding vector(1536), model)` | ✅ schema done |
| Vector index | ivfflat cosine (`idx_knowledge_embeddings_vec`, lists=100) | ✅ done |
| Re-index queue | partial index `where embedding is null` | ✅ done (drives incremental backfill) |
| RLS | auth-read, super-admin-write | ✅ done |
| Embedding model config | `src/lib/ai/config.ts` (per provider: voyage-3 / text-embedding-3-small / text-embedding-004) | ✅ config only |
| Keyword search | `search_ckcm` RPC (FTS, migrations 018/019) → `/api/library`, `/api/ai/assistant`, `LibrarySearch.tsx` | ✅ live |
| AI gateway | `generate()` + `plat_ai_requests` logging + `checkAiQuota` | ✅ live |
| Embedding progress tracking | `src/lib/engines/graph.ts` (`embeddingTotal` / `embeddingDone`) | ✅ counts only (currently ~0 embedded) |

**Net:** the substrate and keyword search are done. `object_type` already spans framework / domain / practice / cpu / competency / skill / resource / policy.

## 2. The gap (CAP-006 deliverables)

1. **`embed()` / `embedBatch()`** in the AI gateway — call the provider's embeddings endpoint, return `number[]`, log to `plat_ai_requests`. **No embed function exists today** (only the model name in config).
2. **Content extractors** — per `object_type`, assemble the text to embed (name + description + criteria/indicators/etc.).
3. **Indexing pipeline** — `/api/admin/embeddings/reindex`: drain the `embedding is null` queue in batches, embed, upsert. Idempotent, resumable. Incremental hook: on asset publish, upsert `content` + null the embedding to re-enqueue.
4. **Vector query RPC** — `match_assets(query_embedding vector, match_count int, filter jsonb)` returning `1 - (embedding <=> query)` similarity over the ivfflat index. **New Postgres function (one migration).**
5. **Hybrid search service** — `src/lib/search/hybrid.ts`: run `search_ckcm` (keyword) + `match_assets` (vector), fuse via Reciprocal Rank Fusion, resolve names, apply tenant/role scope. **Graceful fallback to keyword** when no embeddings/provider.
6. **Search API + UI** — `/api/search` (hybrid) + upgrade `LibrarySearch` (or a CAP asset-search surface) with facets (type/domain/status/level) and saved searches.
7. **Discovery + admin** — "similar assets" (query = an asset's own embedding), indexing-status panel (reuse `graph.ts` counts), search audit/analytics.

## 3. Architecture

**Indexing (write path):** asset published → enqueue (upsert `content`, `embedding=null`) → reindex job pulls the null queue → `embedBatch(contents)` → `update … set embedding, model`.

**Query (read path):** query text → `embed(query)` → `match_assets(vec, k, filter)` (vector top-k) **+** `search_ckcm(q)` (keyword top-k) → RRF fuse → tenant/role filter → resolve → return with similarity + snippet.

**Hybrid ranking:** RRF `score = Σ 1/(k + rank_i)` (k≈60) across the keyword and vector result lists — robust, no score-normalization needed, and it degrades cleanly to keyword-only when the vector list is empty.

## 4. Data-model changes

- **New:** `match_assets` RPC (migration 138).
- **Decision — tenant scoping:** `knowledge_embeddings` has **no `hospital_id`**. Two options: (a) add `hospital_id` + backfill (fast queries, one migration), or (b) post-filter by joining `object_id` to source tables (no schema change, slower). **Recommend (a)** for sub-second SLA.

## 5. Phased work breakdown

| Phase | Deliverable | Effort | Paid calls? |
|---|---|---|---|
| **1 — Indexing foundation** | `embed()`/`embedBatch()`, content extractors, `reindex` route, `match_assets` RPC (mig 138), `hospital_id` on embeddings | 2–3 d | No (dormant until backfill run) |
| **2 — Hybrid search** | `hybrid.ts`, `/api/search`, upgrade `LibrarySearch` to hybrid + facets, keyword fallback | 2–3 d | No (query embedding only when provider set) |
| **3 — Discovery + admin** | "Similar assets", saved searches, indexing-status admin, search analytics/audit | 2–3 d | No |
| **4 — RAG (optional)** | Feed retrieved assets into `generate()` as grounding for copilots | 1–2 d | Yes at query time (already metered) |

## 6. Decisions required

1. **Embedding provider + dimension.** The table is `vector(1536)`. Only OpenAI `text-embedding-3-small` (1536) matches the current defaults; **voyage-3 (~1024) and text-embedding-004 (768) do not.** Pin a 1536-dim model **or** alter the column — this must be settled *before* backfilling, because re-embedding is expensive.
2. **Backfill cost/scale.** One embedding call per asset chunk (thousands). One-time backfill + ongoing on-publish. Confirm provider rate limits + budget.
3. **Indexing trigger.** Manual "Reindex" button (batches per request) vs a scheduled drain (cron / scheduled-tasks) vs on-publish enqueue. Recommend on-publish enqueue + a super-admin reindex button for the initial backfill.
4. **Hybrid weights** — RRF `k` and whether to bias keyword vs vector for clinical exact-match terms.

## 7. Risks & mitigations

- **Dimension mismatch** (biggest) → pin model/dimension before any backfill; make dimension a config constant checked at embed time.
- **Paid embedding generation** → build everything dormant; the backfill only runs when the operator triggers it with a key. Consistent with "never fire paid LLM unsolicited." Until embedded, search returns keyword results (no regression).
- **Tenant leakage in vector search** → `match_assets` must apply the hospital filter (option 5a) — do not ship vector search without it.
- **ivfflat recall** → fine at current scale; revisit `lists` / consider HNSW at millions of rows.

## 8. What can be built now vs needs ops

- **Buildable now, dormant (no paid calls):** phases 1–3 in full — `embed()`, extractors, reindex route, `match_assets` RPC, `hybrid.ts`, `/api/search`, upgraded UI, admin panel. Verified with keyword-only results.
- **Needs the operator:** set an embedding provider key, confirm the 1536-dim model, run the initial backfill. Semantic ranking activates the moment embeddings exist; nothing else changes.

**Recommended first PR:** Phase 1 (indexing foundation) + the `hospital_id` decision — it stands alone, ships dormant, and de-risks everything downstream.
