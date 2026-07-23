// Unified Document Service (PCS-000 Document). One service that aggregates the
// document-bearing stores — evidence / credential documents (evidence, migration 029)
// and assessment evidence (assessment_evidence, 009) — into a single normalised
// document index with type, owner, size and source. Read-only aggregation over what
// already exists (no new store); a write-path unified document API with versioning
// and retention is an honest next-phase gap. Super-admin (landlord) platform scope.
// Fail-soft: a missing source degrades to empty rather than failing the service.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type PlatDoc = { id: string; source: string; type: string; name: string; owner: string; sizeBytes: number | null; hasFile: boolean; at: string | null };

const titleCase = (s?: string) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "Document");
export const humanSize = (b: number | null) => { if (b == null || b <= 0) return "—"; const u = ["B", "KB", "MB", "GB"]; let i = 0, n = b; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`; };

export async function loadDocuments(admin: any, opts: { source?: string; limit?: number } = {}) {
  const limit = opts.limit ?? 4000;
  const [evRes, aeRes] = await Promise.all([
    admin.from("evidence").select("id, kind, file_name, size_bytes, created_at, profiles!owner_id(full_name)").order("created_at", { ascending: false }).limit(limit).then((r: any) => r).catch(() => ({ error: true, data: [] })),
    admin.from("assessment_evidence").select("id, evidence_type, title, file_url, created_at, profiles!recorded_by(full_name)").order("created_at", { ascending: false }).limit(limit).then((r: any) => r).catch(() => ({ error: true, data: [] })),
  ]);

  const evOk = !evRes.error, aeOk = !aeRes.error;
  const docs: PlatDoc[] = [];
  if (evOk) for (const r of evRes.data ?? []) docs.push({ id: r.id, source: "Evidence", type: r.kind === "credential_document" ? "Credential" : "Evidence", name: r.file_name ?? "File", owner: r.profiles?.full_name ?? "—", sizeBytes: r.size_bytes ?? null, hasFile: true, at: r.created_at ?? null });
  if (aeOk) for (const r of aeRes.data ?? []) docs.push({ id: r.id, source: "Assessment", type: titleCase(r.evidence_type), name: r.title ?? "Evidence", owner: r.profiles?.full_name ?? "—", sizeBytes: null, hasFile: !!r.file_url, at: r.created_at ?? null });

  if (!evOk && !aeOk) return { provisioned: false as const };
  docs.sort((a, b) => ((b.at ?? "") > (a.at ?? "") ? 1 : -1));

  const now = Date.now();
  const since7 = new Date(now - 7 * 864e5).toISOString();
  const totalSize = docs.reduce((n, d) => n + (d.sizeBytes ?? 0), 0);
  const grp = (key: (d: PlatDoc) => string) => { const m: Record<string, number> = {}; for (const d of docs) { const k = key(d); m[k] = (m[k] ?? 0) + 1; } return Object.entries(m).map(([label, n]) => ({ label, n, pct: docs.length ? Math.round((n / docs.length) * 100) : 0 })).sort((a, b) => b.n - a.n); };

  const kpis = {
    total: docs.length,
    withFile: docs.filter(d => d.hasFile).length,
    types: new Set(docs.map(d => d.type)).size,
    totalSize,
    thisWeek: docs.filter(d => (d.at ?? "") >= since7).length,
    sources: [evOk ? "Evidence" : null, aeOk ? "Assessment" : null].filter(Boolean).length,
  };
  const byType = grp(d => d.type);
  const bySource = grp(d => d.source);

  const filtered = opts.source && opts.source !== "All" ? docs.filter(d => d.source === opts.source) : docs;
  return { provisioned: true as const, kpis, byType, bySource, recent: filtered.slice(0, 30), sourcesAvailable: { Evidence: evOk, Assessment: aeOk } };
}
