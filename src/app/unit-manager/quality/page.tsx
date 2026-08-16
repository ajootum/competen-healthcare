import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadQualityCommand } from "@/lib/operations/quality-command";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../UnitFilters";
import QualityTabs from "./QualityTabs";
import { estateRolesOf } from "@/lib/roles";

export const dynamic = "force-dynamic";

// Quality & Safety Command Centre (UMG-QS-001) — the executive quality dashboard, aligned to the detailed
// exec spec: Quality Health Summary (§6), the executive KPI ribbon with sparklines + prior-period deltas
// (§7, from quality_score_snapshots), the Priority Action Queue (§8), incident trend (§9), audit compliance
// (§10), alerts (§11), CAPA pipeline (§12), patient-safety breakdown (§13), the residual 5×5 risk heat map
// (§14) + top risks (§15), accreditation framework cards (§16), the 12-month quality trend (§17) and
// explainable AI insights (§18). Consolidation only — no source records forked. Honest: sparklines/deltas/
// 12-month trend are empty until snapshots accrue; write quick-actions live in the source modules (§21).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const INC_META = [
  { key: "critical", label: "Critical", color: "#ef4444" },
  { key: "major", label: "Major", color: "#f97316" },
  { key: "moderate", label: "Moderate", color: "#f59e0b" },
  { key: "minor", label: "Minor", color: "#22c55e" },
  { key: "nearMiss", label: "Near Miss", color: "#3b82f6" },
];
const LIKELIHOOD = ["Almost certain", "Likely", "Possible", "Unlikely", "Rare"]; // rows top→bottom (5→1)
const IMPACT = ["Insignificant", "Minor", "Moderate", "Major", "Catastrophic"]; // cols 1→5
const riskCellTone = (score: number) => (score >= 15 ? "bg-[var(--cmp-color-error)] text-white" : score >= 10 ? "bg-[var(--cmp-color-warning)] text-white" : score >= 5 ? "bg-amber-300 text-amber-900" : "bg-[var(--cmp-color-success)]/80 text-emerald-950");
const pctTone = (p: number | null) => (p == null ? "text-gray-300" : p >= 85 ? "text-[var(--cmp-text-success)]" : p >= 70 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]");
const prTone: Record<string, string> = { critical: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", high: "bg-[var(--cmp-surface-warning)] text-orange-700", medium: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", low: "bg-gray-100 text-gray-600" };

function Spark({ series, color }: { series: number[]; color: string }) {
  if (!series || series.length < 2) return <div className="h-6 flex items-center"><span className="text-[9px] text-gray-300">— trend builds daily —</span></div>;
  const max = Math.max(...series), min = Math.min(...series), rng = max - min || 1;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * 100},${22 - ((v - min) / rng) * 20}`).join(" ");
  return <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="w-full h-6"><polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}
function Delta({ v, invert }: { v: number | null | undefined; invert?: boolean }) {
  if (v == null) return null;
  if (v === 0) return <span className="text-[11px] text-gray-400">→ 0</span>;
  const good = invert ? v < 0 : v > 0;
  return <span className={`text-[11px] font-medium ${good ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{v > 0 ? "↑" : "↓"} {Math.abs(v)}</span>;
}
// Multi-series line chart (0–max scaled).
function MultiLine({ labels, series, max }: { labels: string[]; series: { color: string; data: (number | null)[] }[]; max: number }) {
  const W = 320, H = 150, pad = 8;
  const x = (i: number) => pad + (i / Math.max(1, labels.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - 18 - (v / (max || 1)) * (H - 30);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 150 }}>
      {[0, 0.5, 1].map((f, i) => <line key={i} x1={pad} x2={W - pad} y1={y(max * f)} y2={y(max * f)} stroke="#f1f5f9" strokeWidth="1" />)}
      {series.map((s, si) => { const pts = s.data.map((v, i) => v == null ? null : `${x(i)},${y(v)}`).filter(Boolean).join(" "); return <polyline key={si} points={pts} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />; })}
      {series.map((s, si) => s.data.map((v, i) => v == null ? null : <circle key={`${si}-${i}`} cx={x(i)} cy={y(v)} r="2" fill={s.color} />))}
      {labels.map((l, i) => (i % Math.ceil(labels.length / 6) === 0 || i === labels.length - 1) ? <text key={i} x={x(i)} y={H - 4} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 8 }}>{l}</text> : null)}
    </svg>
  );
}

export default async function QualityCommandCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const [d, departments, hosp] = await Promise.all([
    loadQualityCommand(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
    hid ? admin.from("hospitals").select("name").eq("id", hid).single().then((r: any) => r.data?.name ?? null).catch(() => null) : Promise.resolve(null),
  ]);
  const facility = hosp ?? (isSuper ? "All facilities" : "Facility");
  const refreshedLabel = (d.refreshedAt ?? "").slice(11, 16);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-lg bg-[var(--cmp-surface-error)] flex items-center justify-center text-lg">🛡️</span>
          <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Quality &amp; Safety Command Centre</h1><p className="text-sm text-gray-500">{facility} · Reporting period: This month · Last refreshed {refreshedLabel} · <span className={d.ready ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"}>Data status: {d.ready ? "Complete" : "Partial"}</span></p></div>
        </div>
        <div className="flex items-center gap-2">
          <UnitFilters departments={departments} />
          <Link href="/unit-manager/quality" className="text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-50">↻ Refresh</Link>
          <Link href="/unit-manager/reports" className="text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-50">⇩ Export</Link>
        </div>
      </div>
      <QualityTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Quality command centre warming up</p><p className="text-sm text-amber-800 mt-1">This centre consolidates incidents, audits, CAPA, the risk register, clinical indicators and accreditation. Once any source has live data, the dashboards populate automatically. Nothing here is fabricated.</p></div></div>;

  const h = d.health, k = d.kpis, inc = d.incidents, au = d.audits, capa = d.capa, risk = d.risks, acc = d.accreditation, tr = d.trends;
  const val = (n: any, s = "%") => (n == null ? "—" : `${n}${s}`);
  const auditTotal = au.total || 1;

  return (
    <div className="space-y-4">
      {header}

      {/* ── Quality Health Summary (§6) ─────────────────────────────────────── */}
      <div className={`${card} p-5`}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="flex items-center gap-4">
            <div className="relative w-[112px] h-[112px] shrink-0" style={{ background: `conic-gradient(${h.score == null ? "#e5e7eb" : h.score >= 80 ? "#10b981" : h.score >= 70 ? "#f59e0b" : "#ef4444"} ${(h.score ?? 0) * 3.6}deg, #f1f5f9 0)`, borderRadius: "9999px" }}>
              <div className="absolute inset-[11px] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-3xl font-bold text-gray-900 tabular-nums leading-none">{h.score ?? "—"}</span><span className="text-[9px] text-gray-400">/ 100</span></div>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-500">Unit Quality Health</p>
              <p className={`text-lg font-bold ${h.score == null ? "text-gray-300" : h.score >= 80 ? "text-[var(--cmp-text-success)]" : h.score >= 70 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]"}`}>{h.band}</p>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400"><span>Completeness {h.completeness}%</span>{tr?.health?.delta != null && <Delta v={tr.health.delta} />}</div>
            </div>
          </div>
          <div className="lg:col-span-2">
            <p className="text-xs font-medium text-gray-500 mb-2">Contributing dimensions <span className="text-gray-300">· weighted composite</span></p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">{h.dimensions.map((dim: any) => (
              <div key={dim.label}><div className="flex items-center justify-between text-[11px] mb-0.5"><span className="text-gray-600">{dim.label} <span className="text-gray-300">{dim.weight}%</span></span><b className={`tabular-nums ${pctTone(dim.value)}`}>{dim.value}%</b></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${dim.value}%`, background: dim.value >= 85 ? "#10b981" : dim.value >= 70 ? "#f59e0b" : "#ef4444" }} /></div></div>
            ))}</div>
          </div>
        </div>
        {h.criticalException && <div className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--cmp-surface-error)] border border-[var(--cmp-color-error)] px-3 py-2"><span className="text-[var(--cmp-text-error)]">⛔</span><p className="text-xs text-rose-800"><b>Critical exception:</b> {k.criticalIncidents} critical incident(s) and {k.risksExtreme} extreme risk(s) require attention regardless of the composite score.</p></div>}
      </div>

      {/* ── Executive KPI ribbon (§7) ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <KpiCard icon="⭐" tint="bg-[var(--cmp-surface-information)]" label="Quality Score" value={val(k.qualityScore)} tone={pctTone(k.qualityScore)} delta={tr?.quality?.delta} spark={tr?.quality?.spark} sparkColor="#0ea5e9" sub="composite of approved indicators" source="PMS · quality indicators" />
        <KpiCard icon="🛡️" tint="bg-[var(--cmp-surface-success)]" label="Patient Safety Index" value={val(k.safetyIndex)} tone={pctTone(k.safetyIndex)} delta={tr?.safety?.delta} spark={tr?.safety?.spark} sparkColor="#10b981" sub={`${inc.criticalOpen} critical · ${inc.open} open events`} source="Patient Ops · Incidents · Safety" />
        <KpiCard icon="📋" tint="bg-indigo-50" label="Compliance Score" value={val(k.complianceScore)} tone={pctTone(k.complianceScore)} delta={tr?.compliance?.delta} spark={tr?.compliance?.spark} sparkColor="#6366f1" sub={`${au.completed} audits · ${au.findingsOpen} open findings`} source="Audit & Compliance" />
        <KpiCard icon="🗂️" tint="bg-[var(--cmp-surface-warning)]" label="Open CAPAs" value={capa.provisioned ? k.openCapa : "—"} suffix="" tone={k.openCapa ? "text-[var(--cmp-text-warning)]" : "text-gray-400"} delta={tr?.openCapa?.delta} deltaInvert spark={tr?.openCapa?.spark} sparkColor="#f59e0b" sub={`${k.capaOverdue} overdue · ${k.capaDueSoon} due ≤7d · ${k.capaHigh} high`} source="CAPA & Improvement" href="/unit-manager/capa" />
        <KpiCard icon="❗" tint="bg-[var(--cmp-surface-error)]" label="Critical Incidents" value={inc.provisioned ? k.criticalIncidents : "—"} suffix="" tone={k.criticalIncidents ? "text-[var(--cmp-text-error)]" : "text-gray-400"} delta={tr?.critical?.delta} deltaInvert spark={tr?.critical?.spark} sparkColor="#ef4444" sub={`${k.incidentsNew} new · ${k.incidentsAwaitingRca} awaiting RCA`} source="Incident Management" href="/unit-manager/quality/incidents" />
        <KpiCard icon="⚠️" tint="bg-[var(--cmp-surface-warning)]" label="High / Extreme Risks" value={risk.provisioned ? k.highRisks : "—"} suffix="" tone={k.highRisks ? "text-[var(--cmp-text-warning)]" : "text-gray-400"} delta={tr?.highRisks?.delta} deltaInvert spark={tr?.highRisks?.spark} sparkColor="#f97316" sub={`${k.risksExtreme} extreme · ${k.risksReviewOverdue} review due · ${k.risksIneffectiveControls} weak controls`} source="Unit Risk Register" href="/unit-manager/quality/risk" />
      </div>

      {/* ── Priority Action Queue (§8) ──────────────────────────────────────── */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Priority Action Queue <span className="text-[10px] text-gray-400 font-normal">consolidated across Quality &amp; Safety</span></h3><div className="flex items-center gap-2 text-[10px]">{d.queueCounts.critical > 0 && <span className="font-semibold bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)] rounded-full px-2 py-0.5">{d.queueCounts.critical} critical</span>}{d.queueCounts.high > 0 && <span className="font-semibold bg-[var(--cmp-surface-warning)] text-orange-700 rounded-full px-2 py-0.5">{d.queueCounts.high} high</span>}</div></div>
        {d.actionQueue.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">Priority</th><th className="py-1.5 font-medium">Action</th><th className="py-1.5 font-medium">Source</th><th className="py-1.5 font-medium">Related record</th><th className="py-1.5 font-medium">Owner</th><th className="py-1.5 font-medium text-right">Due</th><th className="py-1.5 font-medium text-right">Age</th><th className="py-1.5 font-medium text-right"></th></tr></thead>
              <tbody>{d.actionQueue.map((q: any, i: number) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2"><span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 capitalize ${prTone[q.priority]}`}>{q.priority}</span></td>
                  <td className="py-2 text-gray-800 font-medium whitespace-nowrap">{q.action}</td>
                  <td className="py-2 text-gray-500">{q.source}</td>
                  <td className="py-2 text-gray-600 max-w-[220px] truncate" title={q.related}>{q.related}</td>
                  <td className="py-2 text-gray-500">{q.owner ?? "Unassigned"}</td>
                  <td className="py-2 text-right text-gray-500 tabular-nums">{q.due ?? "—"}</td>
                  <td className="py-2 text-right text-gray-400 tabular-nums">{q.age ? `${q.age}d` : "—"}</td>
                  <td className="py-2 text-right"><Link href={q.href} className="text-[11px] font-medium text-[var(--cmp-text-error)] hover:underline">Open →</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="text-sm text-gray-400 py-6 text-center">No priority actions outstanding — the unit is in good standing. 🎉</p>}
        <p className="text-[10px] text-gray-400 mt-2">Consolidated from incidents, CAPA, audits, the risk register and accreditation. Owner assignment, escalation and snooze are performed in the source modules (§21), each audit-logged.</p>
      </div>

      {/* ── Incident trend (line) · audit compliance · alerts ───────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Incident Trend <span className="text-[10px] text-gray-400 font-normal">last 6 months</span></h3>
          {inc.provisioned ? (<>
            <MultiLine labels={inc.trend.months} max={Math.max(1, ...INC_META.map(m => Math.max(...(inc.trend.series[m.key] ?? [0]))))} series={INC_META.map(m => ({ color: m.color, data: inc.trend.series[m.key] ?? [] }))} />
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">{INC_META.map(m => <span key={m.key} className="flex items-center gap-1 text-[11px] text-gray-500"><span className="w-2 h-2 rounded-sm" style={{ background: m.color }} />{m.label} <b className="tabular-nums text-gray-700">{inc.totals[m.key] ?? 0}</b></span>)}</div>
          </>) : <p className="text-sm text-gray-400 py-10 text-center">Incident register not provisioned.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Audit Compliance <span className="text-[10px] text-gray-400 font-normal">this period</span></h3>
          {au.provisioned && au.total > 0 ? (
            <div className="flex items-center gap-4">
              <div className="relative w-[112px] h-[112px] shrink-0" style={{ background: `conic-gradient(#10b981 ${(au.avgCompliance ?? 0) * 3.6}deg, #f1f5f9 0)`, borderRadius: "9999px" }}><div className="absolute inset-[11px] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-xl font-bold text-gray-900 tabular-nums">{au.avgCompliance != null ? `${au.avgCompliance}%` : "—"}</span><span className="text-[9px] text-gray-400">compliant</span></div></div>
              <div className="text-[11px] text-gray-600 space-y-1.5 min-w-0">
                <RowL color="#10b981" label="Completed" v={`${au.completed} (${Math.round((au.completed / auditTotal) * 100)}%)`} />
                <RowL color="#3b82f6" label="In progress" v={au.inProgress} />
                <RowL color="#f59e0b" label="Planned" v={au.planned} />
                <div className="border-t border-gray-100 pt-1.5 flex justify-between"><span className="text-gray-500">Total audits</span><b className="tabular-nums text-gray-800">{au.total}</b></div>
                {au.findingsOpen > 0 && <p className="text-[10px] text-rose-500">{au.findingsOpen} open findings · {au.findingsCritical} critical</p>}
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 py-10 text-center">No audits recorded yet.</p>}
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Alerts &amp; Notifications</h3>{d.alerts.length > 0 && <span className="text-[10px] font-bold bg-[var(--cmp-color-error)] text-white rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">{d.alerts.length}</span>}</div>
          {d.alerts.length ? <div className="space-y-2">{d.alerts.map((a: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${a.level === "high" ? "bg-[var(--cmp-color-error)]" : a.level === "medium" ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-information)]"}`} /><div className="min-w-0"><p className="text-xs font-medium text-gray-800 leading-snug">{a.title}</p><p className="text-[11px] text-gray-400">{a.detail}</p></div></div>))}</div> : <p className="text-sm text-gray-400 py-8 text-center">No active alerts. 🎉</p>}
        </div>
      </div>

      {/* ── CAPA pipeline · patient safety · residual risk heat map ─────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">CAPA Pipeline</h3>
          {capa.provisioned && capa.total > 0 ? (<div className="space-y-2">
            <PipeL label="Open" n={capa.open} total={capa.total} color="#3b82f6" />
            <PipeL label="In progress" n={capa.inProgress} total={capa.total} color="#10b981" />
            <PipeL label="Overdue" n={capa.overdue} total={capa.total} color="#ef4444" />
            <PipeL label="Completed" n={capa.completed} total={capa.total} color="#94a3b8" />
            <Link href="/unit-manager/capa" className="inline-block text-[11px] font-medium text-[var(--cmp-text-error)] hover:underline mt-1">Go to CAPA Centre →</Link>
            <p className="text-[10px] text-gray-400">Store lifecycle is open/in-progress/overdue/completed; the fuller triage→verification→effectiveness stages are next-phase.</p>
          </div>) : <p className="text-sm text-gray-400 py-8 text-center">No CAPA actions yet. Raise them in the <Link href="/unit-manager/capa" className="text-[var(--cmp-text-error)] hover:underline">CAPA Centre</Link>.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Patient Safety <span className="text-[10px] text-gray-400 font-normal">open incidents by type</span></h3>
          {inc.provisioned ? <div className="grid grid-cols-2 gap-2">{inc.byType.map((t: any) => (<div key={t.type} className="rounded-lg border border-gray-100 p-2.5"><p className="text-[11px] text-gray-500 truncate">{t.label}</p><p className={`text-xl font-bold tabular-nums ${t.n ? "text-gray-900" : "text-gray-300"}`}>{t.n}</p></div>))}</div> : <p className="text-sm text-gray-400 py-8 text-center">Incident register not provisioned.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Risk Heat Map <span className="text-[10px] text-gray-400 font-normal">residual · likelihood × impact</span></h3>
          {risk.provisioned && risk.total > 0 ? (
            <div className="flex gap-1.5">
              <div className="flex flex-col justify-around text-[8px] text-gray-400 text-right pr-0.5 w-14 shrink-0">{LIKELIHOOD.map(l => <span key={l} className="leading-tight">{l}</span>)}</div>
              <div className="flex-1 min-w-0">
                <div className="grid grid-cols-5 gap-1">
                  {[5, 4, 3, 2, 1].map(l => [1, 2, 3, 4, 5].map(im => { const n = risk.heat[l - 1][im - 1]; const score = l * im; const marker = risk.top.find((r: any) => r.likelihood === l && r.impact === im); return <div key={`${l}-${im}`} className={`relative aspect-square rounded flex items-center justify-center text-[11px] font-bold ${n ? riskCellTone(score) : "bg-gray-50 text-gray-200"}`} title={`Likelihood ${l} × Impact ${im} = ${score}`}>{n || ""}{marker && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-gray-900 text-white text-[8px] flex items-center justify-center">{marker.rank}</span>}</div>; }))}
                </div>
                <div className="grid grid-cols-5 gap-1 mt-1 text-[7px] text-gray-400 text-center">{IMPACT.map(im => <span key={im} className="leading-tight truncate">{im}</span>)}</div>
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No open risks on the register.</p>}
        </div>
      </div>

      {/* ── Top risks · accreditation cards · 12-month quality trend ────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Top Risks</h3><Link href="/unit-manager/quality/risk" className="text-[11px] text-[var(--cmp-text-error)] hover:underline">View all →</Link></div>
          {risk.provisioned && risk.top.length ? <div className="space-y-1.5">{risk.top.map((r: any) => (
            <div key={r.rank} className="flex items-center gap-2 text-xs">
              <span className="w-4 h-4 rounded-full bg-gray-900 text-white text-[9px] flex items-center justify-center shrink-0">{r.rank}</span>
              <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0 ${riskCellTone(r.residual)}`}>{r.residual}</span>
              <div className="min-w-0 flex-1"><p className="text-gray-800 truncate">{r.title}</p><p className="text-[10px] text-gray-400 capitalize truncate">{r.category}{r.owner ? ` · ${r.owner}` : ""} · control {r.control}</p></div>
              {r.reviewOverdue && <span className="text-[9px] text-amber-500 shrink-0">review due</span>}
            </div>
          ))}</div> : <p className="text-sm text-gray-400 py-8 text-center">No risks registered.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Accreditation Readiness</h3>
          {acc.frameworks.length ? (<>
            <div className="grid grid-cols-2 gap-2">{acc.frameworks.map((f: any) => (
              <div key={f.code} className="rounded-lg border border-gray-100 p-2.5"><div className="flex items-center justify-between"><span className="text-[11px] font-medium text-gray-700">{f.code}</span><b className={`text-sm tabular-nums ${pctTone(f.readiness)}`}>{f.readiness != null ? `${f.readiness}%` : "—"}</b></div><p className="text-[9px] text-gray-400 truncate">{f.name}</p></div>
            ))}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-[11px]">
              <div className="flex justify-between"><span className="text-gray-500">Overall</span><b className={`tabular-nums ${pctTone(acc.readiness)}`}>{acc.readiness != null ? `${acc.readiness}%` : "—"}</b></div>
              <div className="flex justify-between"><span className="text-gray-500">Evidence gaps</span><b className={`tabular-nums ${acc.evidenceGaps ? "text-[var(--cmp-text-warning)]" : "text-gray-700"}`}>{acc.evidenceGaps}</b></div>
              <div className="flex justify-between"><span className="text-gray-500">Std. objects</span><b className="tabular-nums text-gray-700">{acc.objects}</b></div>
              <div className="flex justify-between"><span className="text-gray-500">Days to survey</span><b className="tabular-nums text-gray-700">{acc.surveyDays != null ? `${acc.surveyDays}d` : "—"}</b></div>
            </div>
          </>) : (
            <div className="flex items-center gap-4"><div className="relative w-[88px] h-[88px] shrink-0" style={{ background: `conic-gradient(#14b8a6 ${(acc.readiness ?? 0) * 3.6}deg, #f1f5f9 0)`, borderRadius: "9999px" }}><div className="absolute inset-[9px] bg-white rounded-full flex items-center justify-center"><span className="text-lg font-bold text-gray-900">{acc.readiness != null ? `${acc.readiness}%` : "—"}</span></div></div><p className="text-xs text-gray-400">Audit-derived readiness. Record framework self-assessments for framework-by-framework cards.</p></div>
          )}
          <Link href="/unit-manager/quality/accreditation" className="inline-block text-[11px] font-medium text-[var(--cmp-text-error)] hover:underline mt-3">Accreditation readiness →</Link>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Quality Trends <span className="text-[10px] text-gray-400 font-normal">last 12 months</span></h3>
          {tr?.trend12 && tr.trend12.length >= 2 ? (<>
            <MultiLine labels={tr.trend12.map((p: any) => p.month)} max={100} series={[{ color: "#0ea5e9", data: tr.trend12.map((p: any) => p.quality) }, { color: "#10b981", data: tr.trend12.map((p: any) => p.safety) }, { color: "#8b5cf6", data: tr.trend12.map((p: any) => p.compliance) }]} />
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-gray-500"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[var(--cmp-color-information)]" />Quality</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[var(--cmp-color-success)]" />Safety</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-violet-500" />Compliance</span></div>
          </>) : (
            <div className="py-8 text-center"><p className="text-sm text-gray-400">Trend builds as daily snapshots accrue.</p><p className="text-[11px] text-gray-400 mt-1">{tr?.points ? `${tr.points} day(s) captured` : "Snapshots start today"} — the 12-month Quality / Safety / Compliance trend appears once ≥2 months exist. Not simulated.</p></div>
          )}
          <Link href="/unit-manager/quality/analytics" className="inline-block text-[11px] font-medium text-[var(--cmp-text-error)] hover:underline mt-2">Quality analytics →</Link>
        </div>
      </div>

      {/* ── AI Quality Insights (§18) ───────────────────────────────────────── */}
      <div className={`${card} p-5`}>
        <div className="flex items-center gap-2 mb-3"><span className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center text-sm">🤖</span><h3 className="font-semibold text-gray-900 text-sm">AI Quality Insights</h3><span className="text-[10px] text-violet-600 bg-violet-50 border border-violet-100 rounded-full px-2 py-0.5">explainable · evidence-linked</span></div>
        {d.ai.length ? <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{d.ai.map((a: any, i: number) => (
          <Link key={i} href={a.href} className="block rounded-lg border border-gray-100 p-3 hover:border-violet-200 transition-colors">
            <div className="flex items-center justify-between mb-1"><span className="text-[9px] font-semibold uppercase tracking-wide text-violet-600">{a.type}</span><span className="text-[10px] text-gray-400">confidence {a.confidence}%</span></div>
            <p className="text-xs font-medium text-gray-800 leading-snug">{a.text}</p>
            <p className="text-[10px] text-gray-400 mt-1">Why: {a.why}</p>
            <span className="inline-block mt-1.5 text-[10px] font-semibold text-violet-700">{a.action} →</span>
          </Link>
        ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No quality signals to action right now.</p>}
        <p className="text-[10px] text-gray-400 mt-3">Insights are rule-based and explainable — each links to its evidence and recommended action. Per §18.4, no AI insight closes an incident, approves an RCA, closes a CAPA or changes a risk rating; every consequential action requires human approval in the source module.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Quality &amp; Safety Command Centre (UMG-QS-001) — a consolidation surface (§19) composing the incident register (op_incidents), operational quality actions / CAPA (op_quality_actions), audits &amp; findings (audits/audit_findings), the enterprise 5×5 risk register (gov_risks/gov_controls), clinical indicators (quality_indicators) and accreditation self-assessments (gov_standard_assessments). The Quality Health Summary, KPI sparklines, prior-period deltas and 12-month trend read the immutable quality-score snapshot history (quality_score_snapshots, migration 091, §26/§33). Real: the health summary, KPI ribbon, Priority Action Queue, incident trend, audit compliance, CAPA pipeline, patient-safety breakdown, residual risk heat map, top risks, accreditation cards, alerts and explainable AI insights. Honest next-phase: sparklines/deltas/12-month trend build as snapshots accrue; write quick-actions (assign / escalate / snooze), saved views and asynchronous exports live in the source modules (§21). Source: real-time data from multiple systems · {d.scope} scope · last refreshed {refreshedLabel}. Gate hospital_admin/super_admin.</p>
    </div>
  );
}

function KpiCard({ icon, tint, label, value, suffix = "", sub, tone, spark, sparkColor, delta, deltaInvert, source, href }: { icon: string; tint: string; label: string; value: any; suffix?: string; sub?: string; tone?: string; spark?: number[]; sparkColor: string; delta?: number | null; deltaInvert?: boolean; source: string; href?: string }) {
  const inner = (
    <div className={`${card} p-4 h-full`}>
      <div className="flex items-center justify-between mb-1.5"><div className="flex items-center gap-2"><span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span><span className="text-xs font-medium text-gray-500">{label}</span></div><span className="text-[10px] text-gray-300" title={`Source: ${source}`}>ⓘ</span></div>
      <div className="flex items-end justify-between gap-2">
        <div><div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}{suffix}</div>{sub && <div className="text-[10px] text-gray-400 mt-0.5 leading-tight">{sub}</div>}</div>
        <div className="w-24 shrink-0"><Spark series={spark ?? []} color={sparkColor} /><div className="text-right"><Delta v={delta} invert={deltaInvert} /></div></div>
      </div>
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90 transition-opacity">{inner}</Link> : inner;
}
function RowL({ color, label, v }: { color: string; label: string; v: any }) {
  return <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} /><span className="text-gray-500">{label}</span><b className="ml-auto tabular-nums text-gray-700">{v}</b></div>;
}
function PipeL({ label, n, total, color }: { label: string; n: number; total: number; color: string }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return <div><div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600">{label}</span><b className="tabular-nums text-gray-800">{n}</b></div><div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div></div>;
}
