// Incident Management (UMG-QS-002) — the Unit Manager's oversight lens over the incident register
// (op_incidents, migration 073, the SSW-owned store). Real: the KPIs, the report→investigate→awaiting-
// action→closed lifecycle funnel, incident-by-type and by-severity breakdowns, the 6-month severity trend,
// the named incident register and the RCA-pending flag (critical/sentinel incidents open without a recorded
// corrective action — the §6 business rule "critical incidents require RCA before closure"). Fail-soft +
// provisioned-aware. Incidents are CREATED/investigated via the audited /api/operations/incidents route
// (Shift Supervisor tier); this is the manager's read/oversight surface. Root-cause taxonomy is next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const TYPE_LABEL: Record<string, string> = { medication: "Medication", falls: "Falls", equipment: "Equipment", pressure_injury: "Pressure Injury", infection: "Infection / HAI", behaviour: "Behaviour", documentation: "Documentation", sentinel: "Sentinel", other: "Other" };
const TYPES = ["medication", "falls", "equipment", "pressure_injury", "infection", "behaviour", "documentation", "sentinel", "other"];
const SEVERITIES = ["critical", "high", "medium", "low"];
const SEV_LABEL: Record<string, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
const STATUSES = ["reported", "investigating", "awaiting_action", "closed"];
const STATUS_LABEL: Record<string, string> = { reported: "Reported", investigating: "Investigating", awaiting_action: "Awaiting Action", closed: "Closed" };

export async function loadIncidentCentre(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const res = await scope(admin.from("op_incidents")
    .select("id, incident_type, severity, near_miss, status, description, corrective_action, reported_by_name, created_at, closed_at, op_patients!patient_id(label)"))
    .order("created_at", { ascending: false }).limit(4000);
  if (res.error && missing(res.error)) return { provisioned: false as const };
  const rows = (res.error ? [] : res.data ?? []) as any[];

  const open = rows.filter(i => i.status !== "closed");
  const closed = rows.filter(i => i.status === "closed");
  const criticalOpen = open.filter(i => i.severity === "critical");
  // RCA pending — the §6 rule: critical/sentinel open with no corrective action recorded.
  const rcaPending = open.filter(i => (i.severity === "critical" || i.incident_type === "sentinel") && !i.corrective_action);

  // Days-to-close.
  const closeDays = closed.map(i => (i.closed_at && i.created_at) ? (new Date(i.closed_at).getTime() - new Date(i.created_at).getTime()) / 864e5 : null).filter((x: any): x is number => x != null && x >= 0);
  const avgClose = closeDays.length ? Math.round((closeDays.reduce((a, b) => a + b, 0) / closeDays.length) * 10) / 10 : null;

  const kpis = {
    total: rows.length, open: open.length, critical: criticalOpen.length,
    nearMiss: rows.filter(i => i.near_miss).length, investigating: rows.filter(i => i.status === "investigating").length,
    awaitingAction: rows.filter(i => i.status === "awaiting_action").length, closed: closed.length,
    rcaPending: rcaPending.length, avgClose,
    closureRate: rows.length ? Math.round((closed.length / rows.length) * 100) : 0,
  };

  const byType = TYPES.map(t => ({ type: t, label: TYPE_LABEL[t], n: rows.filter(i => i.incident_type === t).length, open: open.filter(i => i.incident_type === t).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  const bySeverity = SEVERITIES.map(s => ({ key: s, label: SEV_LABEL[s], n: rows.filter(i => i.severity === s).length, open: open.filter(i => i.severity === s).length }));
  const lifecycle = STATUSES.map(s => ({ key: s, label: STATUS_LABEL[s], n: rows.filter(i => i.status === s).length }));

  // 6-month trend by severity band (+ near-miss split out).
  const now = new Date();
  const months: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en-US", { month: "short" }) }); }
  const monthIdx = new Map(months.map((m, i) => [m.key, i]));
  const bands = ["critical", "high", "medium", "low", "nearMiss"];
  const series: Record<string, number[]> = Object.fromEntries(bands.map(b => [b, new Array(6).fill(0)]));
  rows.forEach(i => { const b = i.near_miss ? "nearMiss" : (i.severity ?? "low"); const mi = monthIdx.get(String(i.created_at ?? "").slice(0, 7)); if (mi != null && series[b]) series[b][mi]++; });

  const register = rows.slice(0, 20).map(i => ({
    id: i.id, type: TYPE_LABEL[i.incident_type] ?? i.incident_type, severity: i.severity, nearMiss: i.near_miss,
    status: STATUS_LABEL[i.status] ?? i.status, statusKey: i.status, desc: i.description, patient: i.op_patients?.label ?? null,
    reportedBy: i.reported_by_name, at: i.created_at, hasAction: !!i.corrective_action,
  }));

  return { provisioned: true as const, hasData: rows.length > 0, kpis, byType, bySeverity, lifecycle, trend: { months: months.map(m => m.label), series }, register, rcaList: rcaPending.slice(0, 6).map(i => ({ type: TYPE_LABEL[i.incident_type] ?? i.incident_type, severity: i.severity, desc: i.description, at: i.created_at })) };
}
