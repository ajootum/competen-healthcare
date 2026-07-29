/* eslint-disable @typescript-eslint/no-explicit-any */
// CAP-006 — asset indexing pipeline. Populates knowledge_embeddings (migration 017) for the governed
// asset types, then fills embeddings in batches via the embed() gateway. Dormant: enqueue only writes
// content rows (embedding stays null); embedding generation runs only when reindexBatch is invoked AND a
// provider is configured. The `embedding is null` partial index is the work queue.

import { embed, embeddingConfigured } from "@/lib/ai/embed";

// object_type ↔ source table + text builder. Uses select("*") so a column drift never breaks enqueue.
const SOURCES: { type: string; table: string; active?: boolean; text: (r: any) => string }[] = [
  { type: "framework", table: "frameworks", active: true, text: r => `${r.name ?? ""}. ${r.description ?? ""}` },
  { type: "competency", table: "framework_competencies", text: r => `${r.name ?? ""}. ${r.description ?? ""}` },
  { type: "skill", table: "skill_library", active: true, text: r => `${r.name ?? ""}. ${r.description ?? ""}` },
  { type: "cpu", table: "clinical_practice_units", text: r => `${r.name ?? ""}. ${r.description ?? ""}` },
  { type: "resource", table: "learning_resources", active: true, text: r => `${r.title ?? r.name ?? ""}. ${r.description ?? ""}` },
];

// Insert content rows for assets not yet in the index (embedding stays null → queued). Never clobbers
// an existing embedding. Returns how many new rows were queued.
export async function enqueueAssets(admin: any): Promise<{ queued: number }> {
  let queued = 0;
  for (const src of SOURCES) {
    let q = admin.from(src.table).select("*").limit(20000);
    if (src.active) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error || !data) continue;
    const rows = (data as any[]).map(r => ({
      object_type: src.type, object_id: r.id, content: src.text(r).slice(0, 8000),
      hospital_id: r.hospital_id ?? null, embedding: null,
    })).filter(r => r.content.trim().length > 1);
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error: upErr, count } = await admin.from("knowledge_embeddings").upsert(chunk, { onConflict: "object_type,object_id", ignoreDuplicates: true, count: "exact" });
      if (!upErr) queued += count ?? 0;
    }
  }
  return { queued };
}

// Embed the next batch of un-embedded rows. No-op (with a reason) when no provider is configured.
export async function reindexBatch(admin: any, limit = 32): Promise<{ processed: number; remaining: number; error?: string }> {
  if (!embeddingConfigured()) return { processed: 0, remaining: await queuedCount(admin), error: "no embedding provider configured" };
  const { data: rows } = await admin.from("knowledge_embeddings").select("id, content").is("embedding", null).limit(limit);
  const batch = (rows ?? []) as any[];
  if (!batch.length) return { processed: 0, remaining: 0 };

  const result = await embed(batch.map(r => r.content));
  if (!result.ok) return { processed: 0, remaining: await queuedCount(admin), error: result.error };

  let processed = 0;
  for (let i = 0; i < batch.length; i++) {
    const vec = result.vectors[i];
    if (!vec) continue;
    const { error } = await admin.from("knowledge_embeddings").update({ embedding: JSON.stringify(vec), model: result.model, updated_at: new Date().toISOString() }).eq("id", batch[i].id);
    if (!error) processed++;
  }
  return { processed, remaining: await queuedCount(admin) };
}

async function queuedCount(admin: any): Promise<number> {
  const { count } = await admin.from("knowledge_embeddings").select("id", { count: "exact", head: true }).is("embedding", null);
  return count ?? 0;
}

export async function indexStatus(admin: any): Promise<{ total: number; embedded: number; queued: number; configured: boolean }> {
  const total = (await admin.from("knowledge_embeddings").select("id", { count: "exact", head: true })).count ?? 0;
  const embedded = (await admin.from("knowledge_embeddings").select("id", { count: "exact", head: true }).not("embedding", "is", null)).count ?? 0;
  return { total, embedded, queued: total - embedded, configured: embeddingConfigured() };
}
