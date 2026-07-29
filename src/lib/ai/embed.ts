/* eslint-disable @typescript-eslint/no-explicit-any */
// CAP-006 — embedding generation for semantic search. Provider-agnostic via fetch against each provider's
// REST embeddings endpoint (no SDK, per the AI gateway convention). Dormant by design: returns
// not_configured until an embedding provider + key is set, so nothing paid runs until the operator
// triggers a reindex. The knowledge_embeddings column is vector(1536); a dimension guard makes a model
// mismatch an explicit, actionable error rather than a silent bad index.

import { aiStatus } from "./config";

export const EMBED_DIM = 1536;

export type EmbedResult = { ok: true; vectors: number[][]; model: string } | { ok: false; error: string };

// True only when embeddings can actually be produced (Anthropic has no native embeddings — it uses Voyage).
export function embeddingConfigured(): boolean {
  const s = aiStatus();
  if (!s.configured) return false;
  if (s.provider === "anthropic") return !!process.env.VOYAGE_API_KEY;
  if (s.provider === "openai") return !!process.env.OPENAI_API_KEY;
  if (s.provider === "gemini") return !!process.env.GEMINI_API_KEY;
  return false;
}

export async function embed(texts: string[]): Promise<EmbedResult> {
  const s = aiStatus();
  if (!s.configured || !s.models) return { ok: false, error: "not_configured" };
  if (texts.length === 0) return { ok: true, vectors: [], model: s.models.embedding };
  const model = s.models.embedding;

  try {
    let vectors: number[][];
    if (s.provider === "openai" || s.provider === "anthropic") {
      // OpenAI-compatible contract. Anthropic recommends Voyage, whose API mirrors OpenAI's.
      const isVoyage = s.provider === "anthropic";
      const url = isVoyage ? "https://api.voyageai.com/v1/embeddings" : "https://api.openai.com/v1/embeddings";
      const key = isVoyage ? process.env.VOYAGE_API_KEY : process.env.OPENAI_API_KEY;
      if (!key) return { ok: false, error: isVoyage ? "VOYAGE_API_KEY not set (Anthropic uses Voyage for embeddings)" : "OPENAI_API_KEY not set" };
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, input: texts }) });
      if (!res.ok) return { ok: false, error: `embedding provider ${res.status}: ${(await res.text()).slice(0, 200)}` };
      const j = await res.json();
      vectors = ((j.data ?? []) as any[]).map(d => d.embedding);
    } else {
      // Google Gemini batch embeddings.
      const key = process.env.GEMINI_API_KEY;
      if (!key) return { ok: false, error: "GEMINI_API_KEY not set" };
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${key}`;
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests: texts.map(t => ({ model: `models/${model}`, content: { parts: [{ text: t }] } })) }) });
      if (!res.ok) return { ok: false, error: `embedding provider ${res.status}: ${(await res.text()).slice(0, 200)}` };
      const j = await res.json();
      vectors = ((j.embeddings ?? []) as any[]).map(e => e.values);
    }

    if (!vectors.length || !Array.isArray(vectors[0])) return { ok: false, error: "no vectors returned by provider" };
    if (vectors[0].length !== EMBED_DIM) {
      return { ok: false, error: `embedding dimension ${vectors[0].length} != ${EMBED_DIM}. Set AI_MODEL_EMBEDDING to a ${EMBED_DIM}-dim model (e.g. text-embedding-3-small) or alter knowledge_embeddings.embedding.` };
    }
    return { ok: true, vectors, model };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
