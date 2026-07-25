// Incident Management Centre (UMG-QS-002) — the Unit Manager's incident oversight over the incident register
// (op_incidents, migration 073, the SSW-owned store). Per the detailed spec §3/§4 this consolidates the
// incident data; it does not fork it. Real (all derived from the incident records' own timestamps — no
// snapshot store needed): the executive KPIs with period-over-period deltas and 6-month sparklines (total,
// critical and median-investigation-time come straight from created_at / closed_at), incidents by category
// and by severity, the 6-month severity trend, the investigation-progress stages, the triage inbox and the
// recent-critical list. Current-state KPIs (open investigations, awaiting RCA, overdue) show the live value —
// their historical series isn't in the store, so no delta is fabricated. Incidents are CREATED/investigated
// via the audited /api/operations/incidents route (Shift Supervisor tier); this is the manager surface.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const TYPE_LABEL: Record<string, string> = { medication: "Medication Error", falls: "Patient Fall", equipment: "Equipment / Device", pressure_injury: "Pressure Injury", infection: "Infection / HAI", behaviour: "Behaviour", documentation: "Documentation", sentinel: "Sentinel", other: "Other" };
const TYPES = ["medication", "falls", "equipment", "pressure_injury", "infection", "behaviour", "documentation", "sentinel", "other"];
const TYPE_COLOR: Record<string, string> = { medication: "#ef4444", falls: "#f97316", equipment: "#14b8a6", pressure_injury: "#f59e0b", infection: "#8b5cf6", behaviour: "#ec4899", documentation: "#3b82f6", sentinel: "#991b1b", other: "#94a3b8" };
const SEV_COLOR: Record<string, string> = { critical: "#ef4444", major: "#f97316", moderate: "#f59e0b", minor: "#22c55e", nearMiss: "#3b82f6" };
const SEV_TREND: Record<string, string> = { critical: "critical", high: "major", medium: "moderate", low: "minor" };

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const monthKey = (iso: string) => String(iso ?? "").slice(0, 7);
const incRef = (i: any) => `INC-${String(i.created_at ?? "").slice(0, 4) || "20XX"}-${String(i.id ?? "").replace(/-/g, "").slice(0, 4).toUpperCase()}`;

export async function loadIncidentCentre(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const res = await scope(admin.from("op_incidents")
    .select("id, incident_type, severity, near_miss, status, description, corrective_action, reported_by_name, created_at, closed_at, op_patients!patient_id(label)"))
    .order("created_at", { ascending: false }).limit(5000);
  if (res.error && missing(res.error)) return { provisioned: false as const };
  const rows = (res.error ? [] : res.data ?? []) as any[];

  const T = new Date();
  const open = rows.filter(i => i.status !== "closed");
  const closed = rows.filter(i => i.status === "closed");
  const criticalOpen = open.filter(i => i.severity === "critical");
  const rcaPending = open.filter(i => (i.severity === "critical" || i.incident_type === "sentinel") && !i.corrective_action);
  const overdue = open.filter(i => i.created_at && (Date.now() - new Date(i.created_at).getTime()) / 864e5 > 30); // open >30d — investigation SLA proxy

  // ── 6-month buckets ──────────────────────────────────────────────────────────────────────────
  const months: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(T.getFullYear(), T.getMonth() - i, 1); months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en-US", { month: "short" }) }); }
  const idx = new Map(months.map((m, i) => [m.key, i]));
  const thisKey = months[5].key, lastKey = months[4].key;

  // Severity trend series (6mo) + totals.
  const bands = ["critical", "major", "moderate", "minor", "nearMiss"];
  const series: Record<string, number[]> = Object.fromEntries(bands.map(b => [b, new Array(6).fill(0)]));
  const totals: Record<string, number> = Object.fromEntries(bands.map(b => [b, 0]));
  const totalSpark = new Array(6).fill(0), criticalSpark = new Array(6).fill(0);
  const closeByMonth: Record<string, number[]> = {};
  rows.forEach(i => {
    const b = i.near_miss ? "nearMiss" : (SEV_TREND[i.severity] ?? "minor");
    totals[b]++;
    const mi = idx.get(monthKey(i.created_at));
    if (mi != null) { series[b][mi]++; totalSpark[mi]++; if (i.severity === "critical" && !i.near_miss) criticalSpark[mi]++; }
    if (i.status === "closed" && i.closed_at && i.created_at) { const mk = monthKey(i.closed_at); const days = (new Date(i.closed_at).getTime() - new Date(i.created_at).getTime()) / 864e5; if (days >= 0) { (closeByMonth[mk] ??= []).push(days); } }
  });
  const medianSpark = months.map(m => Math.round((median(closeByMonth[m.key] ?? []) ?? 0) * 10) / 10);

  // Period deltas (this month vs last month) — real from created_at.
  const inMonth = (k: string, pred: (i: any) => boolean = () => true) => rows.filter(i => monthKey(i.created_at) === k && pred(i)).length;
  const pctDelta = (now: number, prev: number) => (prev ? Math.round(((now - prev) / prev) * 100) : null);
  const totalThis = inMonth(thisKey), totalLast = inMonth(lastKey);
  const critThis = inMonth(thisKey, i => i.severity === "critical" && !i.near_miss), critLast = inMonth(lastKey, i => i.severity === "critical" && !i.near_miss);
  const medThis = median(closeByMonth[thisKey] ?? []), medLast = median(closeByMonth[lastKey] ?? []);
  const medianAll = median(closed.map(i => (i.closed_at && i.created_at) ? (new Date(i.closed_at).getTime() - new Date(i.created_at).getTime()) / 864e5 : NaN).filter(x => !isNaN(x) && x >= 0));

  const kpis = {
    total: totalThis, totalAll: rows.length,
    critical: critThis, criticalOpen: criticalOpen.length,
    openInvestigations: open.filter(i => i.status === "investigating").length,
    awaitingRca: rcaPending.length,
    overdueActions: overdue.length,
    medianDays: medThis != null ? Math.round(medThis * 10) / 10 : (medianAll != null ? Math.round(medianAll * 10) / 10 : null),
    deltas: {
      total: pctDelta(totalThis, totalLast),
      critical: pctDelta(critThis, critLast),
      median: (medThis != null && medLast != null) ? Math.round((medThis - medLast) * 10) / 10 : null,
    },
    sparks: { total: totalSpark, critical: criticalSpark, median: medianSpark },
  };

  // ── Incidents by category (donut) + severity distribution (donut) ────────────────────────────
  const catN = (t: string) => rows.filter(i => i.incident_type === t).length;
  const category = TYPES.map(t => ({ type: t, label: TYPE_LABEL[t], n: catN(t), color: TYPE_COLOR[t] })).filter(c => c.n > 0).map(c => ({ ...c, pct: rows.length ? Math.round((c.n / rows.length) * 100) : 0 })).sort((a, b) => b.n - a.n);
  const severity = [
    { key: "critical", label: "Critical", n: rows.filter(i => !i.near_miss && i.severity === "critical").length, color: SEV_COLOR.critical },
    { key: "major", label: "Major", n: rows.filter(i => !i.near_miss && i.severity === "high").length, color: SEV_COLOR.major },
    { key: "moderate", label: "Moderate", n: rows.filter(i => !i.near_miss && i.severity === "medium").length, color: SEV_COLOR.moderate },
    { key: "minor", label: "Minor", n: rows.filter(i => !i.near_miss && i.severity === "low").length, color: SEV_COLOR.minor },
    { key: "nearMiss", label: "Near Miss", n: rows.filter(i => i.near_miss).length, color: SEV_COLOR.nearMiss },
  ].map(s => ({ ...s, pct: rows.length ? Math.round((s.n / rows.length) * 100) : 0 }));

  // ── Investigation progress (real statuses) ───────────────────────────────────────────────────
  const investigationProgress = [
    { key: "reported", label: "New / Not Started", n: rows.filter(i => i.status === "reported").length, color: "#94a3b8" },
    { key: "investigating", label: "In Progress", n: rows.filter(i => i.status === "investigating").length, color: "#3b82f6" },
    { key: "awaiting_action", label: "Awaiting Actions", n: rows.filter(i => i.status === "awaiting_action").length, color: "#8b5cf6" },
    { key: "closed", label: "Closed", n: closed.length, color: "#10b981" },
  ].map(s => ({ ...s, pct: rows.length ? Math.round((s.n / rows.length) * 100) : 0 }));

  // ── Triage inbox (real-status tabs) + recent critical ────────────────────────────────────────
  const toRow = (i: any) => ({ id: i.id, ref: incRef(i), title: i.description ?? "Incident", type: TYPE_LABEL[i.incident_type] ?? i.incident_type, severity: i.severity, nearMiss: i.near_miss, status: i.status, reportedBy: i.reported_by_name ?? "—", at: (i.created_at ?? "").slice(0, 10), hasAction: !!i.corrective_action });
  const inbox = open.slice(0, 40).map(toRow);
  const triageCounts = {
    all: open.length,
    new: open.filter(i => i.status === "reported").length,
    investigating: open.filter(i => i.status === "investigating").length,
    awaitingAction: open.filter(i => i.status === "awaiting_action").length,
    urgent: open.filter(i => ["critical", "high"].includes(i.severity)).length,
  };
  const recentCritical = open.filter(i => i.severity === "critical").slice(0, 5).map(toRow);

  return {
    provisioned: true as const, hasData: rows.length > 0,
    kpis, trend: { months: months.map(m => m.label), series, totals }, category, severity, investigationProgress,
    inbox, triageCounts, recentCritical,
    rcaList: rcaPending.slice(0, 6).map(i => ({ type: TYPE_LABEL[i.incident_type] ?? i.incident_type, severity: i.severity, desc: i.description, at: i.created_at })),
  };
}
