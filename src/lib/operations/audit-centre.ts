// Audit & Compliance Centre (UMG-QS-003) — the Unit Manager's clinical-audit oversight over the audit store
// (audits + audit_findings, migration 034). Real: KPIs (completed / avg compliance / pending / open &
// critical findings), compliance by audit type and by area (lowest-first), the 6-month compliance trend, the
// recent-audit register and the open critical-finding list. compliance_pct is Postgres numeric → PostgREST
// returns it as a STRING, so it is Number()-coerced before arithmetic. Fail-soft + provisioned-aware. Audits
// run through the audited /api/quality routes; checklists live in the competency framework (§ next-phase).
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const TYPE_LABEL: Record<string, string> = { concurrent: "Concurrent", retrospective: "Retrospective", clinical: "Clinical" };

export async function loadAuditCentre(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const res = await scope(admin.from("audits")
    .select("id, audit_type, title, area, status, compliance_pct, items_met, items_not_met, items_na, conducted_by_name, conducted_at"))
    .order("conducted_at", { ascending: false }).limit(3000);
  if (res.error && missing(res.error)) return { provisioned: false as const };
  const rows = (res.error ? [] : res.data ?? []) as any[];
  const auditIds = rows.map(a => a.id);

  const completed = rows.filter(a => a.status === "completed");
  const withPct = completed.filter(a => a.compliance_pct != null);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const avgCompliance = avg(withPct.map(a => Number(a.compliance_pct)));

  // Findings for in-scope audits.
  const findings = { open: 0, critical: 0, list: [] as any[] };
  if (auditIds.length) {
    try {
      const { data } = await admin.from("audit_findings").select("audit_id, item_text, is_critical, result").in("audit_id", auditIds).eq("result", "not_met").limit(20000);
      const fr = (data ?? []) as any[];
      findings.open = fr.length;
      findings.critical = fr.filter(f => f.is_critical).length;
      const titleById = new Map(rows.map(a => [a.id, a.title]));
      findings.list = fr.filter(f => f.is_critical).slice(0, 8).map(f => ({ item: f.item_text, audit: titleById.get(f.audit_id) ?? "Audit" }));
    } catch { /* fail-soft */ }
  }

  const kpis = {
    total: rows.length, completed: completed.length, avgCompliance,
    pending: rows.filter(a => a.status === "planned" || a.status === "in_progress").length,
    planned: rows.filter(a => a.status === "planned").length, inProgress: rows.filter(a => a.status === "in_progress").length,
    findingsOpen: findings.open, findingsCritical: findings.critical,
  };

  // Compliance by type + by area (completed audits with a score).
  const groupAvg = (keyFn: (a: any) => string) => {
    const m = new Map<string, number[]>();
    withPct.forEach(a => { const k = keyFn(a) || "—"; if (!m.has(k)) m.set(k, []); m.get(k)!.push(Number(a.compliance_pct)); });
    return [...m.entries()].map(([name, xs]) => ({ name, n: xs.length, pct: avg(xs) ?? 0 }));
  };
  const byType = groupAvg(a => TYPE_LABEL[a.audit_type] ?? a.audit_type).sort((a, b) => b.pct - a.pct);
  const byArea = groupAvg(a => a.area).sort((a, b) => a.pct - b.pct).slice(0, 8);

  // 6-month compliance trend (avg of completed audits per month).
  const now = new Date();
  const months: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) { const dt = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`, label: dt.toLocaleString("en-US", { month: "short" }) }); }
  const trend = months.map(mo => { const xs = withPct.filter(a => String(a.conducted_at ?? "").slice(0, 7) === mo.key).map(a => Number(a.compliance_pct)); return { label: mo.label, pct: avg(xs) }; });

  const register = rows.slice(0, 12).map(a => ({ title: a.title, type: TYPE_LABEL[a.audit_type] ?? a.audit_type, area: a.area, status: a.status, pct: a.compliance_pct != null ? Number(a.compliance_pct) : null, by: a.conducted_by_name, at: a.conducted_at }));

  return { provisioned: true as const, hasData: rows.length > 0, kpis, byType, byArea, trend, register, criticalFindings: findings.list };
}
