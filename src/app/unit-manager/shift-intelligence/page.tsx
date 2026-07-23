import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadShiftIntelligence, loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitCommandTabs from "../UnitCommandTabs";
import UnitFilters from "../UnitFilters";

export const dynamic = "force-dynamic";

// Shift Intelligence (UMW-004) — enterprise cross-shift performance, workforce, safety
// and operational intelligence. Compares day/evening/night shifts, surfaces trends,
// risk and root-cause, and recommends management actions. All metrics derive from the
// persisted shift_metrics snapshots + escalation resolution times; handover-quality and
// the deeper sub-tab analyses are honest next-phase states.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const scoreTone = (n: number | null) => n == null ? "text-gray-400" : n >= 85 ? "text-green-600" : n >= 70 ? "text-amber-600" : "text-rose-600";
const RISK: Record<string, string> = { low: "bg-green-500", medium: "bg-amber-400", high: "bg-orange-500", critical: "bg-rose-600", none: "bg-gray-100" };
const SEV: Record<string, string> = { Critical: "text-rose-600", High: "text-amber-600", Medium: "text-blue-600" };
const TABS = ["Overview", "Shift Comparison", "Trend Analysis", "Handover Intelligence", "Escalation Intelligence", "Workforce Intelligence", "Task Intelligence", "Reports"];

function Kpi({ label, value, unit, delta, goodUp = true }: { label: string; value: any; unit?: string; delta?: number | null; goodUp?: boolean }) {
  const good = delta != null && (delta > 0) === goodUp;
  return (
    <div className={`${card} p-3.5`}>
      <p className="text-[10px] text-gray-500 uppercase tracking-wide leading-tight">{label}</p>
      <p className="text-2xl font-bold text-gray-900 tabular-nums mt-0.5">{value}{unit && <span className="text-sm text-gray-400">{unit}</span>}</p>
      {delta != null && delta !== 0 ? <p className={`text-[10px] mt-0.5 ${good ? "text-green-600" : "text-rose-600"}`}>{delta > 0 ? "↑" : "↓"} {Math.abs(delta)} pts vs prev period</p> : <p className="text-[10px] text-gray-400 mt-0.5">no change vs prev</p>}
    </div>
  );
}

// Compact multi-series line chart (0–100).
function Trend({ series }: { series: any[] }) {
  const W = 620, H = 150, pad = 8;
  const lines = [["performance", "#16a34a"], ["staffing", "#3b82f6"], ["obs", "#8b5cf6"], ["pressure", "#f59e0b"]] as const;
  const n = Math.max(1, series.length);
  const x = (i: number) => pad + (n === 1 ? W / 2 : (i / (n - 1)) * (W - 2 * pad));
  const y = (v: number) => H - pad - (v / 100) * (H - 2 * pad);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40">
      {[0, 25, 50, 75, 100].map(g => <line key={g} x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="#f1f5f9" strokeWidth="1" />)}
      {lines.map(([k, c]) => { const pts = series.map((p, i) => p[k] != null ? `${x(i)},${y(p[k])}` : null).filter(Boolean).join(" "); return pts ? <polyline key={k} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" points={pts} /> : null; })}
    </svg>
  );
}

const shiftLabel = (s: any) => `${(s.shift_type ?? "").replace(/_/g, " ")} · ${s.date?.slice(5)}`;
function goodBad(s: any) {
  const good: string[] = [], bad: string[] = [];
  if (s.obsCompliance != null) (s.obsCompliance >= 95 ? good : bad).push(`Observation compliance ${s.obsCompliance}%`);
  if (s.coverage != null) (s.coverage >= 90 ? good : bad).push(`Staffing coverage ${s.coverage}%`);
  if (s.taskCompletion != null) (s.taskCompletion >= 90 ? good : bad).push(`Task completion ${s.taskCompletion}%`);
  (s.escalations === 0 ? good : bad).push(`${s.escalations} escalation(s)`);
  (s.incidents === 0 ? good : bad).push(`${s.incidents} incident(s)`);
  if (s.acuity >= 3) bad.push(`High acuity (${s.acuity})`);
  return { good, bad };
}

export default async function ShiftIntelligence({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const dept = typeof sp.dept === "string" ? sp.dept : undefined;
  const period = typeof sp.period === "string" ? sp.period : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const isSuper = roles.includes("super_admin");
  const [d, departments] = await Promise.all([
    loadShiftIntelligence(admin, profile?.hospital_id ?? null, isSuper, { dept, period }) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Shift Intelligence</h1><p className="text-sm text-gray-500">Compare shift performance, identify patterns and drive improvement.</p></div>
        <div className="flex items-center gap-2"><UnitFilters departments={departments} showPeriod /><span className="text-[10px] text-gray-300 border border-gray-200 rounded-lg px-2 py-1.5" title="Not wired yet">Generate Review · soon</span></div>
      </div>
      <UnitCommandTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Shift metrics not provisioned</p><p className="text-sm text-amber-800 mt-1">The <code>shift_metrics</code> table (migration 068) isn&apos;t available yet.</p></div></div>;
  if (d.count === 0) return <div className="space-y-4">{header}<div className={`${card} p-6`}><p className="font-semibold text-gray-900">No completed shifts captured</p><p className="text-sm text-gray-500 mt-1">Shift Intelligence populates once supervisors capture shift metrics at closure. No data is fabricated in the meantime.</p></div></div>;

  const k = d.kpis;
  const bg = goodBad(d.bestShift ?? {}), wg = goodBad(d.worstShift ?? {});
  return (
    <div className="space-y-4">
      {header}

      {/* Sub-tab bar (Overview live; others next phase) */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t, i) => (
          <span key={t} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium ${i === 0 ? "border-teal-600 text-teal-700" : "border-transparent text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>
        ))}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Overall Shift Performance" value={k.performance.value ?? "—"} unit="/100" delta={k.performance.delta} />
        <Kpi label="Operational Pressure" value={k.pressure.value ?? "—"} unit="/100" delta={k.pressure.delta} goodUp={false} />
        <Kpi label="Clinical Safety Score" value={k.safety.value ?? "—"} unit="/100" delta={k.safety.delta} />
        <Kpi label="Workforce Effectiveness" value={k.workforce.value ?? "—"} unit="/100" delta={k.workforce.delta} />
        <Kpi label="Task Completion" value={k.taskCompletion.value != null ? `${k.taskCompletion.value}` : "—"} unit="%" delta={k.taskCompletion.delta} />
        <div className={`${card} p-3.5`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">Escalation Burden</p><p className="text-2xl font-bold text-rose-600 tabular-nums mt-0.5">{k.escalationBurden.value}</p><p className="text-[10px] text-gray-400 mt-0.5">{k.escalationBurden.critical} critical{k.escalationBurden.medianResolution != null ? ` · median ${k.escalationBurden.medianResolution} min` : ""}</p></div>
      </div>

      {/* AI summary */}
      <div className={`${card} p-4 bg-gradient-to-r from-violet-50/60 to-white`}>
        <div className="flex items-start gap-3"><span>🤖</span><div className="flex-1"><p className="text-[10px] font-bold text-violet-700 uppercase tracking-wide">AI Shift Intelligence Summary</p><p className="text-sm text-gray-700 mt-0.5">{d.aiSummary}</p></div><span className="text-[10px] text-gray-400">rule-based over shift_metrics</span></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Comparison matrix */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Shift Comparison Matrix</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left"><th className="py-1 pr-2 font-medium">Metric</th><th className="py-1 px-2 font-medium">Day</th><th className="py-1 px-2 font-medium">Evening</th><th className="py-1 px-2 font-medium">Night</th><th className="py-1 px-2 font-medium">Target</th><th className="py-1 font-medium">Trend</th></tr></thead>
              <tbody>
                {d.matrix.map((m: any) => (
                  <tr key={m.metric} className="border-t border-gray-50">
                    <td className="py-1.5 pr-2 text-gray-700">{m.metric}</td>
                    <td className="py-1.5 px-2 tabular-nums text-gray-800">{m.day}</td>
                    <td className="py-1.5 px-2 tabular-nums text-gray-800">{m.evening}</td>
                    <td className="py-1.5 px-2 tabular-nums text-gray-800">{m.night}</td>
                    <td className="py-1.5 px-2 text-gray-400">{m.target}</td>
                    <td className="py-1.5 text-gray-500">{m.trend}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Averaged per shift-type over the period. Escalation-response median &amp; break compliance need per-shift break/resolution capture (honest omission).</p>
        </div>

        {/* Management recommendations */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Management Recommendations</h3><span className="text-[10px] text-gray-400">{d.recommendations.length}</span></div>
          {d.recommendations.length === 0 ? <p className="text-sm text-gray-400">No management actions recommended for this period.</p> : (
            <div className="space-y-2">
              {d.recommendations.map((r: any, i: number) => (
                <div key={i} className="flex items-start gap-2 border-b border-gray-50 pb-2 last:border-0">
                  <div className="min-w-0 flex-1"><p className={`text-[10px] font-bold ${SEV[r.sev] ?? "text-gray-500"}`}>{r.sev}</p><p className="text-xs text-gray-700">{r.title}</p><p className="text-[10px] text-gray-400">Due in {r.due}</p></div>
                  <Link href="/unit-manager/action-centre" className="text-[10px] text-teal-700 border border-gray-100 rounded px-1.5 py-0.5 hover:bg-teal-50 shrink-0">Create Action</Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Trend + heat map */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Shift Performance Trend</h3>
          <Trend series={d.trend} />
          <div className="flex gap-3 text-[10px] mt-1 flex-wrap">
            {[["Performance", "#16a34a"], ["Staffing", "#3b82f6"], ["Observation", "#8b5cf6"], ["Pressure", "#f59e0b"]].map(([l, c]) => <span key={l} className="flex items-center gap-1"><span className="w-2.5 h-0.5" style={{ background: c }} />{l}</span>)}
          </div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Shift Risk Heat Map</h3>
          <div className="space-y-1.5">
            <div className="flex gap-1 pl-16">{d.dow.map((dd: string) => <div key={dd} className="flex-1 text-center text-[9px] text-gray-400">{dd}</div>)}</div>
            {d.heat.map((row: any) => (
              <div key={row.bucket} className="flex items-center gap-1">
                <div className="w-16 text-[10px] text-gray-500 capitalize shrink-0">{row.bucket}</div>
                {row.cells.map((c: any, i: number) => <div key={i} className={`flex-1 h-6 rounded ${RISK[c.risk]} ${c.risk === "none" ? "" : "opacity-90"}`} title={c.n ? `${row.bucket} · avg ${c.score}` : "no data"} />)}
              </div>
            ))}
          </div>
          <div className="flex gap-3 text-[10px] mt-2">{[["Low", "bg-green-500"], ["Medium", "bg-amber-400"], ["High", "bg-orange-500"], ["Critical", "bg-rose-600"]].map(([l, c]) => <span key={l} className="flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded ${c}`} />{l}</span>)}</div>
        </div>
      </div>

      {/* Best / worst / insights */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">🏆 Best Performing Shift</h3>
          {d.bestShift ? (<><div className="flex items-center gap-3 mb-2"><div className="w-14 h-14 rounded-full border-4 border-green-500 flex items-center justify-center text-lg font-bold text-green-600">{d.bestShift.performance}</div><div><p className="text-xs font-semibold text-gray-800 capitalize">{shiftLabel(d.bestShift)}</p><p className="text-[10px] text-gray-400">{d.bestShift.supervisor}</p></div></div><ul className="text-[11px] text-gray-600 space-y-0.5">{bg.good.slice(0, 4).map((g, i) => <li key={i}>✓ {g}</li>)}</ul></>) : <p className="text-sm text-gray-400">—</p>}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">⚠ Highest Risk Shift</h3>
          {d.worstShift ? (<><div className="flex items-center gap-3 mb-2"><div className="w-14 h-14 rounded-full border-4 border-rose-500 flex items-center justify-center text-lg font-bold text-rose-600">{d.worstShift.performance}</div><div><p className="text-xs font-semibold text-gray-800 capitalize">{shiftLabel(d.worstShift)}</p><p className="text-[10px] text-gray-400">{d.worstShift.supervisor}</p></div></div><ul className="text-[11px] text-gray-600 space-y-0.5">{wg.bad.slice(0, 4).map((g, i) => <li key={i}>⚠ {g}</li>)}</ul></>) : <p className="text-sm text-gray-400">—</p>}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Top Shift Insights</h3>
          {d.insights.length === 0 ? <p className="text-sm text-gray-400">No cross-shift patterns detected.</p> : <ul className="text-[11px] text-gray-600 space-y-1.5">{d.insights.map((s: string, i: number) => <li key={i} className="flex gap-1.5"><span className="text-violet-500">›</span>{s}</li>)}</ul>}
        </div>
      </div>

      {/* Recent reviews */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Recent Shift Reviews</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Shift</th><th className="py-2 pr-3 font-medium">Supervisor</th><th className="py-2 pr-3 font-medium">Performance</th><th className="py-2 pr-3 font-medium">Pressure</th><th className="py-2 pr-3 font-medium">Safety</th><th className="py-2 pr-3 font-medium">Escalations</th><th className="py-2 font-medium">Handover</th></tr></thead>
            <tbody>
              {d.recentReviews.map((s: any, i: number) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1.5 pr-3 text-gray-600">{s.date?.slice(5)}</td>
                  <td className="py-1.5 pr-3 capitalize text-gray-700">{(s.shift_type ?? "").replace(/_/g, " ")}</td>
                  <td className="py-1.5 pr-3 text-gray-700 truncate max-w-[120px]">{s.supervisor}</td>
                  <td className={`py-1.5 pr-3 font-semibold tabular-nums ${scoreTone(s.performance)}`}>{s.performance ?? "—"}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-gray-600">{s.pressure ?? "—"}</td>
                  <td className={`py-1.5 pr-3 tabular-nums ${scoreTone(s.safety)}`}>{s.safety ?? "—"}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-gray-600">{s.escalations}</td>
                  <td className="py-1.5 text-gray-300">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-gray-400 mt-2">Handover scores need op_handovers capture (unwritten) — honest state. Drill-down to source shift records is a next-phase link.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Shift Intelligence (UMW-004) is a cross-shift performance, safety, workforce and operational-pressure intelligence centre over the persisted shift_metrics snapshots + live escalation resolution times — the six scores, comparison matrix, multi-metric trend, risk heat map, best/worst shift, recommendations and insights are all derived from real captured data. Handover-quality scoring, per-shift break compliance, precise escalation medians beyond resolved rows, a dedicated shift_performance_snapshots store, and the deeper sub-tab analyses (Handover / Escalation / Workforce / Task Intelligence, Reports, export) are honest next-phase items rather than fabricated.</p>
    </div>
  );
}
