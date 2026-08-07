// QAW-010 Incident, Safety & Learning Integration Centre — incident reporting, patient-safety events,
// investigations and learning. Grounded in op_incidents (073, spine) + op_safety_alerts (038) +
// op_escalations (038) + mm_cases (100, RCA/M&M). Complaints & a learning repository have no store yet
// → reported honestly as next-phase. Tenant-scoped by hospital_id.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/quality-accreditation/_ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TYPE_TONE = ["rose", "amber", "blue", "violet", "indigo", "teal", "emerald", "slate", "gray"];
const SEV_TONE: Record<string, string> = { critical: "rose", high: "amber", medium: "blue", low: "emerald" };

export async function loadSafety(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const { data: incRows, error } = await scope(admin.from("op_incidents").select("id, incident_type, severity, near_miss, status, reported_by_name, description, created_at").order("created_at", { ascending: false }).limit(6000));
  if (error) return { provisioned: false as const };
  const incidents = (incRows ?? []) as any[];

  // ⚠ A FIGURE THAT COULD NOT BE READ IS NOT A NOUGHT. The incidents read above already returns early on
  // error; these two did not, so a failed safety-alert or escalation read quietly became "0 active alerts"
  // and subtracted itself from `openInvestigations` — a quality lead's safety board reporting a calmer unit
  // than anyone had actually looked at. `unavailable` names the source; the affected figures go null so the
  // page renders an em dash rather than a reassuring zero.
  const unavailable: string[] = [];

  const { data: alertRows, error: alertErr } = await scope(admin.from("op_safety_alerts").select("id, category, severity, active").limit(6000));
  if (alertErr) unavailable.push("safety alerts");
  const alerts = (alertRows ?? []) as any[];

  let escOpen: number | null = 0;
  try {
    const { data, error: escErr } = await scope(admin.from("op_escalations").select("status").limit(6000));
    if (escErr) { unavailable.push("escalations"); escOpen = null; }
    else escOpen = (data ?? []).filter((e: any) => !["resolved", "closed"].includes(e.status)).length;
  } catch { unavailable.push("escalations"); escOpen = null; }

  // RCA effectiveness from M&M cases (optional).
  let rca: { pct: number | null; total: number } = { pct: null, total: 0 };
  try {
    const { data } = await scope(admin.from("mm_cases").select("status, rca_status").limit(4000));
    const rows = (data ?? []) as any[];
    const withRca = rows.filter(r => r.rca_status);
    const effective = rows.filter(r => ["closed", "peer_review", "pending_capa"].includes(r.status) || ["completed", "complete", "verified"].includes(String(r.rca_status)));
    rca = { total: rows.length, pct: rows.length ? Math.round((effective.length / rows.length) * 100) : null };
    void withRca;
  } catch { /* mm optional */ }

  const nearMiss = incidents.filter(i => i.near_miss);
  const realIncidents = incidents.filter(i => !i.near_miss);
  // NULL PROPAGATES. Adding an unread escalation count as 0 would report a smaller number of open
  // investigations with no sign that a component of it was missing — the arithmetic must go unknown too.
  const openInvestigations = escOpen === null
    ? null
    : incidents.filter(i => ["investigating", "awaiting_action"].includes(i.status)).length + escOpen;

  // By type.
  const typeMap = new Map<string, number>();
  incidents.forEach(i => typeMap.set(i.incident_type, (typeMap.get(i.incident_type) ?? 0) + 1));
  const byType = [...typeMap.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label: label.replace(/_/g, " "), value, tone: TYPE_TONE[i % TYPE_TONE.length] }));

  // By severity.
  const bySeverity = ["critical", "high", "medium", "low"].map(s => ({ label: s[0].toUpperCase() + s.slice(1), value: incidents.filter(i => i.severity === s).length, tone: SEV_TONE[s] }));

  // Investigation status.
  const investigationStatus = [
    { label: "Reported", value: incidents.filter(i => i.status === "reported").length, tone: "slate" },
    { label: "Investigating", value: incidents.filter(i => i.status === "investigating").length, tone: "blue" },
    { label: "Awaiting action", value: incidents.filter(i => i.status === "awaiting_action").length, tone: "amber" },
    { label: "Closed", value: incidents.filter(i => i.status === "closed").length, tone: "emerald" },
  ];

  // 6-month trend.
  const now = new Date();
  const buckets: { key: string; label: string; total: number; near: number }[] = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getMonth()], total: 0, near: 0 }); }
  const bk = new Map(buckets.map(b => [b.key, b]));
  incidents.forEach(i => { const b = bk.get(String(i.created_at).slice(0, 7)); if (b) { b.total++; if (i.near_miss) b.near++; } });

  const topThemes = byType.slice(0, 6).map(t => ({ theme: t.label, count: t.value, pct: incidents.length ? Math.round((t.value / incidents.length) * 100) : 0 }));
  const recent = incidents.slice(0, 8).map(i => ({ type: i.incident_type.replace(/_/g, " "), near: i.near_miss, severity: i.severity, status: i.status, by: i.reported_by_name, desc: i.description, when: i.created_at }));

  return {
    provisioned: true as const,
    unavailable,
    kpis: {
      total: incidents.length, incidents: realIncidents.length, nearMisses: nearMiss.length,
      // An unread alert table must not report "0 patient-safety events" or "0 active".
      pse: alertErr ? null : alerts.length,
      activePse: alertErr ? null : alerts.filter(a => a.active).length,
      openInvestigations, complaints: null as number | null,
    },
    byType, bySeverity, investigationStatus, trend: buckets, topThemes, recent, rca,
  };
}
