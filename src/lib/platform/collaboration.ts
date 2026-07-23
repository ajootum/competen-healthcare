// Collaboration Service (PCS-000 Collaboration). The reusable comment/discussion
// primitive over plat_comments (migration 078) — threaded comments with @-mentions
// that any workspace can attach to any entity via (entity_type, entity_id). This
// module provides the platform activity/moderation view (loadCollaboration) and a
// single-entity thread loader (loadThread) that entity pages embed. Fail-soft:
// reports not-provisioned before 078. Soft-deleted comments are excluded from feeds.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const titleCase = (s?: string) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "Entity");

const enrich = (r: any) => ({
  id: r.id, entityType: r.entity_type, entityLabel: titleCase(r.entity_type), entityId: r.entity_id,
  parentId: r.parent_id ?? null, body: r.body ?? "", mentions: (r.mentions ?? []) as string[],
  author: r.author_name ?? "—", authorId: r.author_id ?? null, at: r.created_at ?? null,
  edited: !!r.edited_at, isReply: !!r.parent_id,
});

export async function loadCollaboration(admin: any, hid: string | null, isSuper: boolean, opts: { limit?: number } = {}) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const probe = await admin.from("plat_comments").select("id").limit(1);
  if (probe.error && missing(probe.error)) return { provisioned: false as const };

  const { data } = await scope(admin.from("plat_comments")
    .select("id, entity_type, entity_id, parent_id, body, mentions, author_id, author_name, edited_at, created_at")
    .is("deleted_at", null).order("created_at", { ascending: false })).limit(opts.limit ?? 2000);

  const all = (data ?? []).map(enrich);
  if (!all.length) return { provisioned: true as const, empty: true, kpis: emptyKpis(), recent: [], byEntity: [], contributors: [] };

  const now = Date.now();
  const since7 = new Date(now - 7 * 864e5).toISOString();
  const threads = new Set(all.map((c: any) => `${c.entityType}:${c.entityId}`));
  const mentionCount = all.reduce((n: number, c: any) => n + c.mentions.length, 0);

  const kpis = {
    total: all.length,
    threads: threads.size,
    replies: all.filter((c: any) => c.isReply).length,
    mentions: mentionCount,
    thisWeek: all.filter((c: any) => (c.at ?? "") >= since7).length,
    contributors: new Set(all.map((c: any) => c.authorId).filter(Boolean)).size,
  };

  const grp = (key: (c: any) => string) => { const m: Record<string, number> = {}; for (const c of all) { const k = key(c); m[k] = (m[k] ?? 0) + 1; } return Object.entries(m).map(([label, n]) => ({ label, n, pct: all.length ? Math.round((n / all.length) * 100) : 0 })).sort((a, b) => b.n - a.n); };
  const byEntity = grp((c: any) => c.entityLabel);
  const contributors = grp((c: any) => c.author).slice(0, 6);

  return { provisioned: true as const, empty: false, kpis, recent: all.slice(0, 20), byEntity, contributors };
}

// Threaded view for one entity — roots with their nested replies. Entity pages embed this.
export async function loadThread(admin: any, entityType: string, entityId: string) {
  const probe = await admin.from("plat_comments").select("id").limit(1);
  if (probe.error && missing(probe.error)) return { provisioned: false as const, roots: [] };
  const { data } = await admin.from("plat_comments")
    .select("id, entity_type, entity_id, parent_id, body, mentions, author_id, author_name, edited_at, created_at")
    .eq("entity_type", entityType).eq("entity_id", entityId).is("deleted_at", null)
    .order("created_at", { ascending: true }).limit(500);
  const all = (data ?? []).map(enrich);
  const roots = all.filter((c: any) => !c.parentId).map((r: any) => ({ ...r, replies: all.filter((c: any) => c.parentId === r.id) }));
  return { provisioned: true as const, roots, count: all.length };
}

function emptyKpis() { return { total: 0, threads: 0, replies: 0, mentions: 0, thisWeek: 0, contributors: 0 }; }
