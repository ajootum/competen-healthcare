/* eslint-disable @typescript-eslint/no-explicit-any */
// CAP-006 — hybrid search. Combines keyword full-text (search_ckcm, migrations 018/019) with vector kNN
// (match_assets, migration 138) using Reciprocal Rank Fusion. Degrades gracefully to keyword-only when no
// embedding provider is configured or no embeddings exist yet — so search always works, and gains
// semantic recall the moment the index is populated.

import { embed, embeddingConfigured } from "@/lib/ai/embed";

export type SearchHit = { objectType: string; objectId: string; title: string; snippet: string; score: number; matched: string[]; similarity?: number };

const RRF_K = 60;
const NONE = "00000000-0000-0000-0000-000000000000";
const firstLine = (s: string) => (s || "").split(/[.\n]/)[0].slice(0, 90);

export async function hybridSearch(admin: any, q: string, opts: { hospitalId?: string | null; isSuper?: boolean; limit?: number }): Promise<{ hits: SearchHit[]; semantic: boolean; note?: string }> {
  const limit = opts.limit ?? 24;
  const map = new Map<string, SearchHit>();

  // Both halves take the SAME tenant argument. They did not: the vector half passed p_hospital from the
  // day it was written, the keyword half took no tenant argument at all, so one result set mixed a scoped
  // and an unscoped source. search_ckcm now requires p_hospital (migration 167).
  //
  // The nil uuid, not null, for a caller with no hospital — null means UNRESTRICTED in both functions, so
  // `hospitalId ?? null` quietly opened the query for exactly the users least entitled to it.
  const pHospital = opts.isSuper ? null : (opts.hospitalId ?? NONE);

  // Keyword (always available).
  const { data: kw } = await admin.rpc("search_ckcm", { q, max_results: limit, p_hospital: pHospital });
  ((kw ?? []) as any[]).forEach((r, i) => {
    const key = `${r.object_type}:${r.object_id}`;
    const h: SearchHit = map.get(key) ?? { objectType: r.object_type, objectId: r.object_id, title: r.title ?? "", snippet: r.snippet ?? "", score: 0, matched: [] };
    h.score += 1 / (RRF_K + i + 1);
    if (!h.matched.includes("keyword")) h.matched.push("keyword");
    if (!h.title) h.title = r.title ?? "";
    if (!h.snippet) h.snippet = r.snippet ?? "";
    map.set(key, h);
  });

  // Semantic (only when embeddings can be produced).
  let semantic = false; let note: string | undefined;
  if (embeddingConfigured()) {
    const emb = await embed([q]);
    if (emb.ok && emb.vectors[0]) {
      const { data: vec } = await admin.rpc("match_assets", { query_embedding: JSON.stringify(emb.vectors[0]), match_count: limit, p_hospital: pHospital });
      const rows = (vec ?? []) as any[];
      semantic = true;
      if (rows.length === 0) note = "No embeddings indexed yet — run a reindex to enable semantic recall.";
      rows.forEach((r, i) => {
        const key = `${r.object_type}:${r.object_id}`;
        const h: SearchHit = map.get(key) ?? { objectType: r.object_type, objectId: r.object_id, title: firstLine(r.content), snippet: (r.content ?? "").slice(0, 180), score: 0, matched: [] };
        h.score += 1 / (RRF_K + i + 1);
        if (!h.matched.includes("semantic")) h.matched.push("semantic");
        h.similarity = Math.max(h.similarity ?? 0, Math.round((Number(r.similarity) || 0) * 100) / 100);
        if (!h.title) h.title = firstLine(r.content);
        if (!h.snippet) h.snippet = (r.content ?? "").slice(0, 180);
        map.set(key, h);
      });
    } else if (!emb.ok) {
      note = `Semantic search unavailable: ${emb.error}`;
    }
  } else {
    note = "Keyword search — configure an embedding provider and reindex to enable semantic search.";
  }

  const hits = [...map.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  return { hits, semantic, note };
}
