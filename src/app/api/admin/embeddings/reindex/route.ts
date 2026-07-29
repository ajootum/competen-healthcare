import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { enqueueAssets, reindexBatch, indexStatus } from "@/lib/search/indexer";

// CAP-006 — asset embedding index admin. GET reports indexing status; POST {action:"enqueue"} queues
// asset content rows, POST {action:"embed", limit} embeds the next batch. Super-admin only. Embedding
// only calls a provider when POSTed with action embed AND a provider key is configured (dormant otherwise).

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Indexing is super-admin only");
  return NextResponse.json(await indexStatus(c.admin));
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Reindexing is super-admin only");

  const b = await req.json().catch(() => ({}));
  if (b.action === "enqueue") {
    const r = await enqueueAssets(c.admin);
    await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "embeddings_enqueue", entity_type: "knowledge_embeddings", new_value: r });
    return NextResponse.json({ ...r, status: await indexStatus(c.admin) });
  }
  const limit = Math.min(Math.max(parseInt(b.limit, 10) || 32, 1), 128);
  const r = await reindexBatch(c.admin, limit);
  if (r.processed > 0) await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "embeddings_reindex", entity_type: "knowledge_embeddings", new_value: { processed: r.processed } });
  return NextResponse.json({ ...r, status: await indexStatus(c.admin) });
}
