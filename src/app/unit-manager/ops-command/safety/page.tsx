import Link from "next/link";
import { loadSafetyCommand } from "@/lib/operations/ops-safety";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import { opcGuard, TopStrip, SurfaceHead, Card, Kpi, Donut, Pill, OpsFoot, fmtT } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-OPC-006 Safety & Escalation Oversight — live risks, incidents, escalation timing and a bed-level risk hotspot
// over op_safety_alerts + op_escalations + op_patients. Dark command surface. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const RISK_TONE: Record<string, string> = { high: "bg-rose-500/90 text-white", medium: "bg-amber-500/90 text-slate-900", low: "bg-emerald-500/90 text-slate-900", empty: "bg-slate-700/40 text-slate-500 border border-slate-600" };
const bandDot = (b: string) => (b === "high" ? "bg-rose-500" : b === "medium" ? "bg-amber-500" : "bg-slate-500");
const fmtElapsed = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

export default async function SafetyPage({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const { dept } = await searchParams;
  const { admin, isSuper, hid } = await opcGuard();
  const [d, departments] = await Promise.all([
    loadSafetyCommand(admin, hid, isSuper, dept || null) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const strip = <TopStrip code="UMW-OPC-006 · Operational Command" title="Safety & Escalation Oversight" departments={departments} />;
  if (!d.provisioned) return <div className="space-y-4">{strip}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational stores not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 038 then seed safety + escalations.</p></div></div>;

  const k = d.kpis;
  const maxTrend = Math.max(1, ...d.trend.map((t: any) => t.n));
  return (
    <div className="space-y-3">
      {strip}
      <div className="bg-slate-900 rounded-2xl p-4 md:p-5 space-y-4 text-slate-100">
        <SurfaceHead title="Safety & Escalation Oversight" meta={d.asOf ? `as of ${d.asOf}` : "real-time"} refresh="10s" />

        {/* KPI ribbon */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Kpi label="Critical Alerts" value={k.criticalAlerts} sub="high severity" tone={k.criticalAlerts ? "text-rose-400" : "text-white"} />
          <Kpi label="High Risk Patients" value={k.highRiskPatients} sub="risk level high" tone={k.highRiskPatients ? "text-amber-400" : "text-white"} />
          <Kpi label="Safety Incidents" value={k.safetyIncidentsToday} sub="today" tone={k.safetyIncidentsToday ? "text-amber-400" : "text-white"} />
          <Kpi label="Deteriorating" value={k.deteriorating} sub="active alerts" tone={k.deteriorating ? "text-rose-400" : "text-white"} />
          <Kpi label="Escalations Open" value={k.escalationsOpen} sub={`${k.resolvedToday} resolved today`} tone={k.escalationsOpen ? "text-rose-400" : "text-white"} />
          <Kpi label="Safety Compliance" value={`${k.safetyCompliance}%`} sub="composite" tone={k.safetyCompliance >= 90 ? "text-emerald-400" : "text-amber-400"} />
          <Kpi label="Avg Resolve Time" value={k.avgResolveMin != null ? fmtElapsed(k.avgResolveMin) : "—"} sub="escalations" />
          <Kpi label="Resolved Today" value={k.resolvedToday} sub="escalations" tone="text-emerald-400" />
        </div>

        {/* Risk overview + highlights + escalation summary + alert feed */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Safety Risk Overview">
            <div className="flex items-center gap-3">
              <Donut segs={d.riskOverview.map((r: any) => ({ n: r.n, color: r.color }))} total={d.totalRisk} centre={d.totalRisk} sub="Patients" />
              <div className="space-y-1 text-[11px] flex-1">{d.riskOverview.map((r: any) => <div key={r.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: r.color }} /><span className="text-slate-300 flex-1">{r.label}</span><span className="font-semibold text-white">{r.n}</span></div>)}</div>
            </div>
          </Card>

          <Card title="Patient Safety Highlights">
            <div className="grid grid-cols-2 gap-1.5">{d.highlights.map((h: any) => (
              <div key={h.label} className="flex items-center justify-between rounded-lg bg-slate-800/50 px-2 py-1.5"><span className="text-[10px] text-slate-300 truncate">{h.label}</span><span className={`text-sm font-bold tabular-nums ${h.n ? "text-amber-400" : "text-slate-500"}`}>{h.n}</span></div>
            ))}</div>
          </Card>

          <Card title="Escalation Summary">
            <div className="grid grid-cols-2 gap-2 text-center mb-3">
              {[["Open", k.escalationsOpen, "text-rose-400"], ["Resolved Today", k.resolvedToday, "text-emerald-400"], ["Avg Resolve", k.avgResolveMin != null ? fmtElapsed(k.avgResolveMin) : "—", "text-white"], ["Compliance", `${k.safetyCompliance}%`, "text-blue-400"]].map(([l, v, tone]: any) => (
                <div key={l} className="rounded-lg bg-slate-800/50 p-2"><p className={`text-base font-bold tabular-nums ${tone}`}>{v}</p><p className="text-[9px] text-slate-400 leading-tight">{l}</p></div>
              ))}
            </div>
            <div className="space-y-1">{d.workflow.map((w: any) => <div key={w.stage} className="flex items-center gap-2 text-[10px]"><span className="text-slate-400 w-24">{w.stage}</span><div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden"><div className="h-full rounded-full bg-blue-500" style={{ width: `${(w.n / Math.max(1, d.workflow[0].n)) * 100}%` }} /></div><span className="text-white tabular-nums w-6 text-right">{w.n}</span></div>)}</div>
          </Card>

          <Card title="Live Alert Feed">
            {d.alertFeed.length ? <div className="space-y-2">{d.alertFeed.map((a: any, i: number) => (
              <div key={i} className="flex items-start gap-2"><span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${bandDot(a.band)}`} /><div className="min-w-0 flex-1"><p className="text-[12px] text-slate-200 leading-tight">{a.title}</p><p className="text-[10px] text-slate-500">{a.sub}{a.at ? ` · ${fmtT(a.at)}` : ""}</p></div></div>
            ))}</div> : <p className="text-xs text-slate-400 py-4 text-center">No active alerts. ✅</p>}
          </Card>
        </div>

        {/* Incidents + trend + escalations in progress + hotspot */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Incidents by Type" right={<span className="text-[9px] text-slate-500">today</span>}>
            {d.incidentsByType.length ? <div className="space-y-2 text-[11px]">{d.incidentsByType.map((it: any) => <div key={it.label} className="flex items-center gap-2"><span className="text-slate-300 flex-1 truncate">{it.label}</span><span className="text-white font-semibold tabular-nums">{it.n}</span></div>)}</div> : <p className="text-xs text-slate-400 py-4 text-center">No incidents today. ✅</p>}
          </Card>

          <Card title="Incident Trend" right={<span className="text-[9px] text-slate-500">7 days</span>}>
            <div className="flex items-end gap-1.5 h-24">{d.trend.map((t: any) => (
              <div key={t.d} className="flex-1 flex flex-col items-center gap-1" title={`${t.d}: ${t.n}`}><div className="w-full bg-rose-500/70 rounded-t" style={{ height: `${(t.n / maxTrend) * 76}px` }} /><span className="text-[7px] text-slate-500">{t.d}</span></div>
            ))}</div>
          </Card>

          <Card title="Escalations in Progress">
            {d.inProgress.length ? <div className="space-y-2">{d.inProgress.map((e: any, i: number) => (
              <div key={i} className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[12px] text-slate-200 leading-tight truncate">{e.title}</p><p className="text-[10px] text-slate-500">L{e.level} · {e.type} · {fmtElapsed(e.elapsedMin)}</p></div><Pill text={e.severity} tone={e.severity === "high" ? "rose" : e.severity === "medium" ? "amber" : "slate"} /></div>
            ))}</div> : <p className="text-xs text-slate-400 py-4 text-center">No escalations in progress.</p>}
            <Link href="/unit-manager/quality/incidents" className="block text-center text-[11px] text-blue-400 hover:underline pt-2">Incident Management →</Link>
          </Card>

          <Card title="Risk Hotspot Map">
            <div className="grid grid-cols-6 gap-1.5">{d.hotspot.map((b: any) => <div key={b.label} title={`${b.label} · ${b.risk} risk`} className={`aspect-square rounded-md flex items-center justify-center text-[9px] font-semibold ${RISK_TONE[b.risk]}`}>{String(b.label).replace(/\D/g, "").slice(-3) || b.label}</div>)}</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[10px] text-slate-400"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" />High</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />Medium</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Low</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-600" />Empty</span></div>
          </Card>
        </div>
      </div>

      <OpsFoot>UMW-OPC-006 — live safety &amp; escalation oversight over op_safety_alerts (categories/severity) + op_escalations (levels/status/timing) + op_patients (risk/isolation). Risk donut, highlights, incident trend, escalation timing and the bed-level hotspot are your unit&apos;s real data; safety-compliance is a composite (audit-by-area lives in Quality &amp; Safety). Read-only manager lens.</OpsFoot>
    </div>
  );
}
