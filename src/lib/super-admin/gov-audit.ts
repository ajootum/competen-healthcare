// Audit & Assurance (GOV-001.5) loader — audit programme oversight built on the
// REAL quality-engine tables (audits / audit_findings / capa_actions, migration
// 034). Platform-wide, fail-soft. Compliance uses the canonical definition
// (N/A excluded — computed upstream into audits.compliance_pct). CAPA ageing is
// bucketed from created_at for open actions, overdue from due_date. The
// assurance-coverage panel ties the three lines of defence to the now-real
// registers: controls (060), obligations (059) and audits (034).
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (r: any) => (r?.error ? null : r?.count ?? 0);
const bucket = (rows: any[], key: string) => { const m: Record<string, number> = {}; for (const r of rows) { const k = r[key] ?? "unknown"; m[k] = (m[k] ?? 0) + 1; } return m; };
const DAY = 86400000;
const CAPA_CLOSED = new Set(["completed", "verified", "closed"]);

export async function loadAuditAssurance(admin: any) {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [auditRows, findingRows, recentFindings, capaRows, hospitals, controlsCount, obligationsCount] = await Promise.all([
    admin.from("audits").select("id, title, audit_type, status, compliance_pct, area, hospital_id, conducted_by_name, conducted_at, record_ref").order("conducted_at", { ascending: false, nullsFirst: false }).limit(5000),
    admin.from("audit_findings").select("result, is_critical").limit(20000),
    admin.from("audit_findings").select("item_text, is_critical, created_at").eq("result", "not_met").order("created_at", { ascending: false }).limit(6),
    admin.from("capa_actions").select("id, title, status, priority, due_date, owner_name, created_at, closed_at").order("created_at", { ascending: false }).limit(4000),
    admin.from("hospitals").select("id, name").limit(2000),
    admin.from("gov_controls").select("*", { count: "exact", head: true }),
    admin.from("gov_obligations").select("*", { count: "exact", head: true }),
  ]);

  const audits = (auditRows.error ? [] : auditRows.data ?? []) as any[];
  const findings = (findingRows.error ? [] : findingRows.data ?? []) as any[];
  const capas = (capaRows.error ? [] : capaRows.data ?? []) as any[];
  const hospName = new Map<string, string>((hospitals.error ? [] : hospitals.data ?? []).map((h: any) => [h.id, h.name]));

  // ── Audit programme ─────────────────────────────────────────────────────────
  const byStatus = bucket(audits, "status");
  const byType = bucket(audits, "audit_type");
  const compVals = audits.map(a => a.compliance_pct).filter((x: any) => x != null).map(Number);
  const avgCompliance = compVals.length ? +(compVals.reduce((a, b) => a + b, 0) / compVals.length).toFixed(1) : null;

  const auditList = audits.slice(0, 8).map(a => ({
    id: a.id, title: a.title, type: a.audit_type, status: a.status,
    pct: a.compliance_pct == null ? null : Math.round(Number(a.compliance_pct)),
    area: a.area, by: a.conducted_by_name, at: a.conducted_at,
    plannedFor: a.status === "planned" ? a.record_ref : null,
    org: a.hospital_id ? (hospName.get(a.hospital_id) ?? "Tenant") : "Platform",
  }));

  // ── Findings ────────────────────────────────────────────────────────────────
  const fBuckets = bucket(findings, "result");
  const criticalFails = findings.filter(f => f.result === "not_met" && f.is_critical).length;

  // ── CAPA workflow ───────────────────────────────────────────────────────────
  const openCapas = capas.filter(c => !CAPA_CLOSED.has(String(c.status ?? "").toLowerCase()));
  const capaByStatus = bucket(capas, "status");
  const overdueCapa = openCapas.filter(c => c.due_date && c.due_date < todayStr).length;
  const now = Date.now();
  const ageing = { fresh: 0, week: 0, month: 0 }; // <7d, 7–30d, >30d open
  for (const c of openCapas) {
    const age = (now - new Date(c.created_at).getTime()) / DAY;
    if (age < 7) ageing.fresh++; else if (age <= 30) ageing.week++; else ageing.month++;
  }
  const capaClosure = capas.length ? Math.round((capas.filter(c => CAPA_CLOSED.has(String(c.status ?? "").toLowerCase())).length / capas.length) * 100) : null;
  const capaList = openCapas.slice(0, 6).map(c => ({
    id: c.id, title: c.title, status: c.status, priority: c.priority,
    due: c.due_date, overdue: !!(c.due_date && c.due_date < todayStr), owner: c.owner_name,
  }));

  // ── Assurance coverage (three lines of defence, tied to real registers) ─────
  const assurance = [
    { line: "1st line — operational controls", count: num(controlsCount), source: "controls library (module 4)", href: "/super-admin/governance/risk" },
    { line: "2nd line — compliance oversight", count: num(obligationsCount), source: "obligations register (module 3)", href: "/super-admin/governance/compliance" },
    { line: "3rd line — internal audit", count: audits.length || null, source: "audit programme (this module)", href: null },
  ];

  return {
    kpis: {
      total: auditRows.error ? null : audits.length,
      completed: auditRows.error ? null : byStatus.completed ?? 0,
      planned: auditRows.error ? null : byStatus.planned ?? 0,
      inProgress: auditRows.error ? null : byStatus.in_progress ?? 0,
      avgCompliance,
      criticalFindings: findingRows.error ? null : criticalFails,
    },
    byType,
    auditList,
    findings: { met: fBuckets.met ?? 0, notMet: fBuckets.not_met ?? 0, na: fBuckets.na ?? 0, total: findings.length, criticalFails },
    recentFindings: recentFindings.error ? [] : recentFindings.data ?? [],
    capa: {
      total: capas.length, open: openCapas.length, overdue: overdueCapa,
      byStatus: capaByStatus, ageing, closure: capaClosure, list: capaList,
    },
    assurance,
    pickers: {
      openCapas: openCapas.slice(0, 500).map(c => ({ id: c.id, label: `${c.title} (${String(c.status).replace(/_/g, " ")}${c.priority === "high" ? " · high" : ""})` })),
    },
    generatedAt: new Date().toISOString(),
  };
}
