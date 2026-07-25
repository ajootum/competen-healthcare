import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadOperationalPerformance } from "@/lib/operations/ops-performance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../UnitFilters";

export const dynamic = "force-dynamic";

// Operational Performance & Capacity Management (UMW-OPC-000) — aligned to the high-fidelity mockup. The Unit
// Manager's strategic Operations & Capacity dashboard: a read-only manager lens over the operational stores
// (op_ops_snapshots monthly/daily aggregates, op_beds, op_flow_blockers, op_equipment, op_resources — migration
// 101 + the existing SSW stores). Real: the 6-KPI ribbon + MoM deltas, capacity donut + per-ward heat map +
// bottlenecks, workforce establishment, resource availability, equipment readiness, occupancy/LOS/discharge-delay
// trends, top operational metrics and rule-based AI operational insights. Live execution stays in the SSW.
// Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const SEG = { occupied: "#10b981", available: "#22c55e", blocked: "#ef4444", cleaning: "#f59e0b", reserved: "#6366f1", eqOp: "#10b981", eqMaint: "#f59e0b", eqOut: "#ef4444", eqCal: "#3b82f6" };
const statusDot: Record<string, string> = { red: "bg-rose-500", amber: "bg-amber-400", green: "bg-emerald-500" };
const demandPill: Record<string, string> = { available: "bg-emerald-100 text-emerald-700", busy: "bg-amber-100 text-amber-700", high: "bg-rose-100 text-rose-700", low: "bg-gray-100 text-gray-500" };
const sevPill: Record<string, string> = { High: "bg-rose-100 text-rose-700", Medium: "bg-amber-100 text-amber-700", Info: "bg-sky-100 text-sky-700" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (p: string) => { const d = new Date(p); return isNaN(+d) ? p : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

function Kpi({ icon, tint, label, value, unit, delta, deltaGood, deltaUnit = "" }: { icon: string; tint: string; label: string; value: any; unit?: string; delta?: number | null; deltaGood?: "up" | "down"; deltaUnit?: string }) {
  const good = delta != null && delta !== 0 ? ((delta > 0 && deltaGood === "up") || (delta < 0 && deltaGood === "down")) : null;
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-gray-500">{label}</span><span className={`w-8 h-8 rounded-lg ${tint} flex items-center justify-center text-sm`}>{icon}</span></div>
      <p className="text-2xl font-bold tabular-nums text-gray-900">{value}{unit && <span className="text-sm text-gray-400 font-normal ml-0.5">{unit}</span>}</p>
      {delta != null && <p className={`text-[11px] ${good == null ? "text-gray-400" : good ? "text-emerald-600" : "text-rose-600"}`}>{delta > 0 ? "↑" : delta < 0 ? "↓" : ""} {Math.abs(delta)}{deltaUnit} vs last month</p>}
    </div>
  );
}
function SegDonut({ segments, center, sub, size = 150 }: { segments: { n: number; color: string }[]; center: any; sub?: string; size?: number }) {
  const sum = segments.reduce((a, s) => a + s.n, 0) || 1;
  const active = segments.filter(s => s.n > 0);
  const grad = active.length ? `conic-gradient(${active.map((s, i) => { const b = active.slice(0, i).reduce((a, x) => a + x.n, 0); return `${s.color} ${(b / sum) * 360}deg ${((b + s.n) / sum) * 360}deg`; }).join(", ")})` : "#e5e7eb";
  return <div className="relative shrink-0" style={{ width: size, height: size }}><div className="rounded-full w-full h-full" style={{ background: grad }} /><div className="absolute bg-white rounded-full flex flex-col items-center justify-center" style={{ inset: size * 0.16 }}><span className="text-2xl font-bold text-gray-900 tabular-nums">{center}</span>{sub && <span className="text-[10px] text-gray-400">{sub}</span>}</div></div>;
}
function Ring({ pct, center, sub, color }: { pct: number; center: string; sub: string; color?: string }) {
  const col = color ?? (pct >= 85 ? "#10b981" : pct >= 70 ? "#f59e0b" : "#ef4444");
  return <div className="relative shrink-0" style={{ width: 120, height: 120 }}><div className="rounded-full w-full h-full" style={{ background: `conic-gradient(${col} ${pct * 3.6}deg, #f1f5f9 0deg)` }} /><div className="absolute inset-[13px] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-xl font-bold tabular-nums" style={{ color: col }}>{center}</span><span className="text-[9px] text-gray-400">{sub}</span></div></div>;
}
function DualLine({ days, occupancy, los }: { days: string[]; occupancy: number[]; los: number[] }) {
  const W = 460, Hh = 150, pad = 8; const n = days.length;
  const x = (i: number) => n < 2 ? W / 2 : (i / (n - 1)) * (W - pad * 2) + pad;
  const yO = (v: number) => Hh - 12 - (Math.max(0, Math.min(100, v)) / 100) * (Hh - 24);
  const maxL = Math.max(8, ...los); const yL = (v: number) => Hh - 12 - (v / maxL) * (Hh - 24);
  return <svg viewBox={`0 0 ${W} ${Hh}`} className="w-full" style={{ height: 180 }}>
    {[0, 25, 50, 75, 100].map(g => <line key={g} x1={0} x2={W} y1={yO(g)} y2={yO(g)} stroke="#f1f5f9" strokeWidth="1" />)}
    <polyline points={occupancy.map((v, i) => `${x(i)},${yO(v)}`).join(" ")} fill="none" stroke="#10b981" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    <polyline points={los.map((v, i) => `${x(i)},${yL(v)}`).join(" ")} fill="none" stroke="#3b82f6" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    {occupancy.map((v, i) => <circle key={i} cx={x(i)} cy={yO(v)} r="2" fill="#10b981" />)}
  </svg>;
}

export default async function OpsPerformancePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const [d, departments] = await Promise.all([
    loadOperationalPerformance(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <p className="text-[11px] text-gray-400 font-medium">UMW-OPC-000</p>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Operational Performance &amp; Capacity Management</h1>
        <p className="text-sm text-gray-500">Strategic overview of unit performance, capacity, resources and forecasting.</p>
      </div>
      <UnitFilters departments={departments} />
    </div>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational stores not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 101 (op_ops_snapshots / op_equipment / op_resources), then seed (scripts/seed-ops-performance.mjs).</p></div></div>;
  if (!d.hasData) return <div className="space-y-4">{header}<div className={`${card} p-8 text-center`}><p className="text-sm text-gray-500">No operational snapshots for this unit yet.</p><p className="text-xs text-gray-400 mt-1">Run scripts/seed-ops-performance.mjs for the AMU demo ward.</p></div></div>;

  const k = d.kpis; const w = d.workforce; const eq = d.equipment;
  const DELAY_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#94a3b8"];

  return (
    <div className="space-y-4">
      {header}

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="🛏️" tint="bg-violet-50" label="Average Occupancy" value={k.occupancy} unit="%" delta={k.occupancyDelta} deltaGood="up" deltaUnit="%" />
        <Kpi icon="➕" tint="bg-emerald-50" label="Total Admissions" value={k.admissions} delta={k.admissionsDelta} deltaGood="up" deltaUnit="%" />
        <Kpi icon="✅" tint="bg-amber-50" label="Total Discharges" value={k.discharges} delta={k.dischargesDelta} deltaGood="up" deltaUnit="%" />
        <Kpi icon="📅" tint="bg-indigo-50" label="Average LOS (Days)" value={k.avgLos} delta={k.losDelta} deltaGood="down" />
        <Kpi icon="⚠️" tint="bg-rose-50" label="Escalation Rate" value={k.escalationRate} unit="%" delta={k.escalationDelta} deltaGood="down" deltaUnit="%" />
        <Kpi icon="🛡️" tint="bg-sky-50" label="Unit Capacity Score" value={`${k.capacityScore}`} unit="/100" delta={k.capacityDelta} deltaGood="up" />
      </div>

      {/* Capacity overview + AI insights */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-2`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Capacity Overview</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex flex-col items-center">
              <SegDonut segments={d.capacity.segments.map((s: any) => ({ n: s.n, color: (SEG as any)[s.key] }))} center={d.capacity.total} sub="Total Beds" />
              <div className="space-y-1 mt-3 w-full">{d.capacity.segments.map((s: any) => (<div key={s.key} className="flex items-center justify-between text-[11px]"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: (SEG as any)[s.key] }} />{s.label}</span><span className="tabular-nums text-gray-500">{s.n} ({s.pct}%)</span></div>))}</div>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-500 mb-2">Capacity Heat Map</p>
              <table className="w-full text-[11px]"><thead><tr className="text-left text-gray-400"><th className="font-medium pb-1">Ward</th><th className="font-medium pb-1 text-right">Beds</th><th className="font-medium pb-1 text-right">Occ.</th><th className="font-medium pb-1 text-right"></th></tr></thead>
                <tbody>{d.heatMap.map((h: any) => (<tr key={h.ward}><td className="py-1 text-gray-700 truncate max-w-[90px]">{h.ward}</td><td className="py-1 text-right tabular-nums text-gray-500">{h.beds}</td><td className="py-1 text-right tabular-nums text-gray-700">{h.occ} ({h.occPct}%)</td><td className="py-1 text-right"><span className={`inline-block w-2 h-2 rounded-full ${statusDot[h.status]}`} /></td></tr>))}</tbody></table>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-500 mb-2">Bottlenecks (Top 5)</p>
              <div className="space-y-1.5">{d.bottlenecks.map((b: any) => (<div key={b.label} className="flex items-center justify-between text-[11px]"><span className="text-gray-600 truncate">{b.label}</span><span className="w-6 h-5 rounded bg-rose-50 text-rose-600 flex items-center justify-center font-semibold tabular-nums text-[10px]">{b.n}</span></div>))}</div>
            </div>
          </div>
        </div>

        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">AI Operational Insights</h2>
          <div className="space-y-2">{d.insights.map((ins: any, i: number) => (
            <div key={i} className="border border-gray-100 rounded-lg p-2.5">
              <div className="flex items-center gap-2 mb-1"><span className="text-xs font-semibold text-gray-800 flex-1">{ins.title}</span><span className={`text-[9px] px-1.5 py-0.5 rounded ${sevPill[ins.severity]}`}>{ins.severity}</span></div>
              <p className="text-[10px] text-gray-500 mb-1">{ins.detail}</p>
              <div className="flex flex-wrap gap-1">{ins.actions.map((a: string, j: number) => <span key={j} className="text-[9px] bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 text-gray-500">{a}</span>)}</div>
            </div>
          ))}</div>
          {d.equipmentStable && <div className="mt-2 text-[10px] text-emerald-600 bg-emerald-50 rounded-lg px-2.5 py-1.5">✓ No critical equipment failures predicted in next 7 days.</div>}
        </div>
      </div>

      {/* Workforce · resources · equipment */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Workforce Capacity</h2>
          <div className="flex items-center gap-4">
            <Ring pct={w.safeStaffing ?? 0} center={`${w.safeStaffing ?? "—"}%`} sub="Safe Staffing" />
            <div className="flex-1 space-y-1 text-[11px]">
              {[["Required FTE", w.required], ["Available FTE", w.available], ["Vacant FTE", w.vacant], ["Agency FTE", w.agency]].map(([l, v]: any) => (<div key={l} className="flex justify-between"><span className="text-gray-500">{l}</span><span className="tabular-nums text-gray-700">{v}</span></div>))}
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100"><span className={`text-[10px] px-1.5 py-0.5 rounded ${w.risk === "HIGH" ? "bg-rose-100 text-rose-700" : w.risk === "MODERATE" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>Risk: {w.risk}</span><span className="text-[11px] text-gray-500">Gap: <span className="font-semibold text-gray-700 tabular-nums">{w.gap} FTE</span></span></div>
        </div>

        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Resource Availability</h2>
          <div className="space-y-2">{d.resources.map((r: any) => (
            <div key={r.name} className="flex items-center justify-between text-[11px]"><span className="text-gray-600">{r.name}</span><div className="flex items-center gap-2"><span className="tabular-nums text-gray-700">{r.showCount ? `${r.available} / ${r.total}` : r.total}</span><span className={`text-[9px] px-1.5 py-0.5 rounded ${demandPill[r.demand]}`}>{r.demand === "available" ? "Available" : r.demand === "busy" ? "Busy" : r.demand === "high" ? "High" : "Low"}</span></div></div>
          ))}{!d.resources.length && <p className="text-[11px] text-gray-400">No resources recorded.</p>}</div>
        </div>

        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Equipment Readiness</h2>
          <div className="flex items-center gap-4">
            <Ring pct={eq.availability ?? 0} center={`${eq.availability ?? "—"}%`} sub="Availability" color="#10b981" />
            <div className="flex-1 space-y-1 text-[11px]">
              {[["Operational", eq.operational, SEG.eqOp], ["Under Maintenance", eq.maintenance, SEG.eqMaint], ["Out of Service", eq.outOfService, SEG.eqOut], ["Calibration Due", eq.calibration, SEG.eqCal]].map(([l, v, c]: any) => (<div key={l} className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-gray-500"><span className="w-2 h-2 rounded-full" style={{ background: c }} />{l}</span><span className="tabular-nums text-gray-700">{v}</span></div>))}
            </div>
          </div>
        </div>
      </div>

      {/* Trends + top metrics */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-2"><h2 className="font-semibold text-gray-900 text-sm">Occupancy &amp; LOS Trend</h2><div className="flex gap-2"><span className="flex items-center gap-1 text-[10px] text-gray-500"><span className="w-2 h-2 rounded-full bg-emerald-500" />Occupancy %</span><span className="flex items-center gap-1 text-[10px] text-gray-500"><span className="w-2 h-2 rounded-full bg-blue-500" />Avg LOS</span></div></div>
          {d.trend.days.length >= 2 ? <><DualLine days={d.trend.days} occupancy={d.trend.occupancy} los={d.trend.los} /><div className="flex justify-between text-[9px] text-gray-400 px-1">{[d.trend.days[0], d.trend.days[Math.floor(d.trend.days.length / 2)], d.trend.days[d.trend.days.length - 1]].map((p: string, i: number) => <span key={i}>{dayLabel(p)}</span>)}</div></> : <p className="text-[11px] text-gray-400 py-8 text-center">Trend accrues daily.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Discharge Delay Trend</h2>
          <div className="flex items-center gap-4">
            <div className="text-center shrink-0"><p className="text-[10px] text-gray-400">Avg Delay</p><p className="text-3xl font-bold text-rose-600 tabular-nums">{d.dischargeDelay.avg}</p><p className="text-[10px] text-gray-400">hours</p>{d.dischargeDelay.delta != null && <p className={`text-[10px] ${d.dischargeDelay.delta > 0 ? "text-rose-600" : "text-emerald-600"}`}>{d.dischargeDelay.delta > 0 ? "↑" : "↓"} {Math.abs(d.dischargeDelay.delta)} hrs</p>}</div>
            <div className="flex-1"><p className="text-[10px] font-semibold text-gray-500 mb-1.5">Delays by Reason</p><div className="space-y-1">{d.dischargeDelay.reasons.map((r: any, i: number) => (<div key={r.reason} className="flex items-center gap-2 text-[10px]"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: DELAY_COLORS[i % DELAY_COLORS.length] }} /><span className="text-gray-600 flex-1 truncate">{r.reason}</span><span className="tabular-nums text-gray-500">{r.pct}%</span></div>))}</div></div>
          </div>
        </div>

        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Top Operational Metrics</h2>
          <table className="w-full text-[11px]"><thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1 font-medium">Metric</th><th className="py-1 font-medium text-right">This</th><th className="py-1 font-medium text-right">Last</th><th className="py-1 font-medium text-right">Trend</th></tr></thead>
            <tbody>{d.topMetrics.map((m: any) => (<tr key={m.label} className="border-b border-gray-50"><td className="py-1.5 text-gray-700">{m.label}</td><td className="py-1.5 text-right tabular-nums text-gray-800">{m.cur}{m.unit}</td><td className="py-1.5 text-right tabular-nums text-gray-400">{m.prev}{m.unit}</td><td className={`py-1.5 text-right tabular-nums ${m.good == null ? "text-gray-400" : m.good ? "text-emerald-600" : "text-rose-600"}`}>{m.up ? "↑" : "↓"} {Math.abs(m.change ?? 0)}%</td></tr>))}</tbody></table>
        </div>
      </div>

      <div className={`${card} p-3`}>
        <p className="text-[10px] text-gray-400">Manager lens as of {d.asOf} · Data sources: Patient Operations, Bed Management, Workforce, Equipment, Flow Blockers, Ops Snapshots. Read-only — live bed allocation &amp; patient placement remain in the Shift Supervisor Workspace. Configurable KPIs/widgets, operational forecasting simulations, financial &amp; asset-lifecycle sub-modules (OPC §2–8) are next-phase.</p>
      </div>
    </div>
  );
}
