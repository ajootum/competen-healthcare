/* eslint-disable @typescript-eslint/no-explicit-any */
// CAPA-004 — Evidence Integrity Platform. Turns the passive evidence store (029) into a governed, verifiable one:
// a verification state (pending/verified/rejected/flagged, migration 149) + an immutable integrity-event log
// (chain-of-custody). Computes the verification backlog, integrity issues (rejected/flagged/expired/suspected
// duplicates by file-name+size) and completeness, over the REAL evidence rows. Fail-soft: pre-149 (no `status`
// column) resolves to provisioned:false so the surface honestly asks for the migration.

type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";
const isMissing = (e: any) => /does not exist|schema cache|column .* does not exist/i.test(String(e?.message ?? ""));

export async function loadEvidenceIntegrity(admin: Admin, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  // Probe the migration-149 column; its absence (or a missing table) → not provisioned.
  const probe = await admin.from("evidence").select("id, status").limit(1);
  if (probe.error && isMissing(probe.error)) return { provisioned: false as const };

  const { data, error } = await scope(admin.from("evidence").select("id, owner_id, competency_id, kind, file_name, size_bytes, status, verified, verified_at, expiry_date, created_at").order("created_at", { ascending: false }).limit(50000));
  if (error) return isMissing(error) ? { provisioned: false as const } : emptyResult();
  const rows = (data ?? []) as any[];
  if (!rows.length) return emptyResult();

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const st = (r: any) => r.status ?? "pending";

  const total = rows.length;
  const verified = rows.filter(r => st(r) === "verified").length;
  const pending = rows.filter(r => st(r) === "pending").length;
  const rejected = rows.filter(r => st(r) === "rejected").length;
  const flagged = rows.filter(r => st(r) === "flagged").length;
  const expired = rows.filter(r => r.expiry_date && r.expiry_date < today).length;
  const expiring = rows.filter(r => r.expiry_date && r.expiry_date >= today && r.expiry_date <= in30).length;

  // Suspected duplicates: same file name + byte size across more than one row.
  const dupeMap = new Map<string, any[]>();
  for (const r of rows) { if (!r.file_name) continue; const k = `${r.file_name}|${r.size_bytes ?? "?"}`; if (!dupeMap.has(k)) dupeMap.set(k, []); dupeMap.get(k)!.push(r); }
  const dupeGroups = [...dupeMap.values()].filter(v => v.length > 1);
  const duplicates = dupeGroups.reduce((n, g) => n + g.length, 0);

  const statusDist = [
    { label: "verified", n: verified, tone: "emerald" },
    { label: "pending", n: pending, tone: "amber" },
    { label: "flagged", n: flagged, tone: "rose" },
    { label: "rejected", n: rejected, tone: "gray" },
  ].filter(s => s.n > 0);

  const byKindMap = new Map<string, number>();
  for (const r of rows) byKindMap.set(r.kind ?? "evidence", (byKindMap.get(r.kind ?? "evidence") ?? 0) + 1);
  const byKind = [...byKindMap.entries()].map(([kind, n]) => ({ kind, n })).sort((a, b) => b.n - a.n);

  // Verification queue (pending first) + names.
  const queueRows = rows.filter(r => st(r) === "pending").slice(0, 40);
  const ownerIds = [...new Set(queueRows.map(r => r.owner_id).filter(Boolean))];
  const compIds = [...new Set(queueRows.map(r => r.competency_id).filter(Boolean))];
  const ownerName = new Map<string, string>(); const compName = new Map<string, string>();
  if (ownerIds.length) { const { data: p } = await admin.from("profiles").select("id, full_name").in("id", ownerIds.slice(0, 2000)); (p ?? []).forEach((x: any) => ownerName.set(x.id, x.full_name ?? "—")); }
  if (compIds.length) { const { data: c } = await admin.from("framework_competencies").select("id, name").in("id", compIds.slice(0, 2000)); (c ?? []).forEach((x: any) => compName.set(x.id, x.name)); }
  const queue = queueRows.map(r => ({ id: r.id, file: r.file_name ?? "evidence", kind: r.kind ?? "evidence", owner: ownerName.get(r.owner_id) ?? "—", competency: r.competency_id ? (compName.get(r.competency_id) ?? "—") : "—", created: r.created_at }));

  const suspicious = dupeGroups.slice(0, 8).map(g => ({ file: g[0].file_name, size: g[0].size_bytes, count: g.length }));

  // Integrity event log (chain-of-custody).
  let events: any[] = [];
  const evRes = await scope(admin.from("evidence_integrity_events").select("event_type, actor_name, note, created_at").order("created_at", { ascending: false }).limit(20));
  if (!evRes.error) events = (evRes.data ?? []) as any[];

  return {
    provisioned: true as const, empty: false,
    kpis: {
      total, verified, pending, rejected, flagged, expired, expiring, duplicates,
      verificationRate: total ? Math.round((verified / total) * 100) : 0,
      integrityIssues: rejected + flagged + expired + dupeGroups.length,
    },
    statusDist, byKind, queue, suspicious, events,
  };
}

function emptyResult() {
  return {
    provisioned: true as const, empty: true,
    kpis: { total: 0, verified: 0, pending: 0, rejected: 0, flagged: 0, expired: 0, expiring: 0, duplicates: 0, verificationRate: 0, integrityIssues: 0 },
    statusDist: [] as any[], byKind: [] as any[], queue: [] as any[], suspicious: [] as any[], events: [] as any[],
  };
}
