// Quality & Accreditation Workspace data (QAS-001) — audits, findings, CAPA,
// improvement projects, quality standards/indicators and accreditation readiness.
// Tenant-scoped by hospital_id; standards/indicators are scoped via their
// hospital-owned quality_objects. No accreditation/risk tables exist, so
// readiness is derived from audit compliance and risk from critical items.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";

export async function loadQualityDashboard(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const today = new Date().toISOString().slice(0, 10);

  // ── Audits
  const audits = { total: 0, planned: 0, inProgress: 0, completed: 0, avgCompliance: null as number | null };
  let auditIds: string[] = [];
  try {
    // compliance_pct is Postgres numeric → PostgREST returns it as a STRING, so
    // it must be Number()-coerced before arithmetic (otherwise "+" concatenates).
    const { data } = await scope(admin.from("audits").select("id, status, compliance_pct").limit(5000));
    const rows = data ?? []; auditIds = rows.map((a: any) => a.id);
    audits.total = rows.length;
    audits.planned = rows.filter((a: any) => a.status === "planned").length;
    audits.inProgress = rows.filter((a: any) => a.status === "in_progress").length;
    audits.completed = rows.filter((a: any) => a.status === "completed").length;
    const done = rows.filter((a: any) => a.status === "completed" && a.compliance_pct != null);
    audits.avgCompliance = done.length ? Math.round(done.reduce((s: number, a: any) => s + Number(a.compliance_pct), 0) / done.length) : null;
  } catch { /* pre-migration */ }

  // ── Open findings (for the in-scope audits only)
  const findings = { open: 0, critical: 0 };
  try {
    if (auditIds.length) {
      const { data } = await admin.from("audit_findings").select("is_critical").in("audit_id", auditIds).eq("result", "not_met").limit(20000);
      findings.open = (data ?? []).length;
      findings.critical = (data ?? []).filter((f: any) => f.is_critical).length;
    }
  } catch { /* ignore */ }

  // ── CAPA (corrective/preventive actions)
  const capa = { open: 0, overdue: 0, critical: 0 };
  try {
    const { data } = await scope(admin.from("capa_actions").select("status, priority, due_date").limit(3000));
    const openRows = (data ?? []).filter((c: any) => !["completed", "verified", "closed"].includes(c.status));
    capa.open = openRows.length;
    capa.overdue = openRows.filter((c: any) => c.due_date && c.due_date < today).length;
    capa.critical = openRows.filter((c: any) => c.priority === "high" || c.priority === "critical").length;
  } catch { /* ignore */ }

  // ── Improvement projects (QI / PDSA)
  const improvements = { total: 0, active: 0 };
  try {
    const { data } = await scope(admin.from("improvement_objects").select("status").limit(2000));
    improvements.total = (data ?? []).length;
    improvements.active = (data ?? []).filter((i: any) => !["completed", "closed"].includes(i.status)).length;
  } catch { /* ignore */ }

  // ── Standards + indicators via the hospital's quality_objects
  let standards = 0, indicators = 0, objects = 0;
  try {
    const { data: objs } = await scope(admin.from("quality_objects").select("id").limit(3000));
    const objIds = (objs ?? []).map((o: any) => o.id); objects = objIds.length;
    if (objIds.length) {
      const { count: sc } = await admin.from("quality_standards").select("id", { count: "exact", head: true }).in("quality_object_id", objIds);
      standards = sc ?? 0;
      const { count: ic } = await admin.from("quality_indicators").select("id", { count: "exact", head: true }).in("quality_object_id", objIds).eq("is_active", true);
      indicators = ic ?? 0;
    }
  } catch { /* ignore */ }

  return {
    audits, findings, capa, improvements, standards, indicators, objects,
    accreditationReadiness: audits.avgCompliance,   // derived from audit compliance
    complianceScore: audits.avgCompliance,
    // Open, actionable risk = open high-priority corrective actions. (A critical
    // audit finding auto-creates a high-priority CAPA, so adding both would
    // double-count the same issue.)
    riskItems: capa.critical,
  };
}
