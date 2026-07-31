import { loadPaOperational } from "@/lib/analytics/performance-modules";
import { paGuard, Head, Tabs, Card, Kpi, Ring, Pill, RagDot, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-PA-005 Operational Performance Analytics Centre — executive operational intelligence over the Operations-
// perspective KPIs, many resolving LIVE from op_ops_snapshots. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const fmtVal = (v: any, unit: string) => (v == null ? "—" : unit === "%" ? `${v}%` : unit === "days" ? `${v}d` : unit === "hrs" ? `${v}h` : `${v}`);

export default async function OperationalPage() {
  const { admin, isSuper, hid } = await paGuard();
  const d = await loadPaOperational(admin, hid, isSuper) as any;
  const head = <Head code="UMW-PA-005 · Performance Analytics" title="Operational Performance Analytics Centre" sub="Executive operational intelligence — patient flow, capacity, efficiency and operational quality, with KPIs live from real snapshots." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="005" /><Provision module="Operational Analytics" /></div>;
  if (!d.hasData) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="005" /><div className="bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded-xl p-6 text-sm text-blue-800">Seed the performance stores first.</div></div>;

  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="005" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-3.5 flex items-center gap-2"><Ring pct={d.score} size={60} /><div><p className="text-[11px] text-gray-500 uppercase tracking-wide leading-tight">Operational Health</p><p className="text-[11px] text-[var(--cmp-text-success)] font-medium">{d.live} live KPIs</p></div></div>
        {d.cards.slice(0, 7).map((k: any) => <Kpi key={k.name} label={k.name} value={fmtVal(k.value, k.unit)} sub={k.isLive ? "live · target " + fmtVal(k.target, k.unit) : `target ${fmtVal(k.target, k.unit)}`} status={k.status} delta={k.deltaPct != null ? `${k.deltaPct}%` : undefined} deltaUp={k.deltaUp} series={k.trend} />)}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Benchmarking" className="xl:col-span-2">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">{d.benchmarks.map((b: any) => (
            <div key={b.label} className={`flex items-center gap-2 text-[12px] ${b.you ? "font-semibold" : ""}`}><span className={`w-24 truncate ${b.you ? "text-indigo-700" : "text-gray-600"}`}>{b.label}</span><div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${b.value}%`, background: b.you ? "#4f46e5" : "#94a3b8" }} /></div><span className="text-gray-900 tabular-nums w-9 text-right">{b.value}</span></div>
          ))}</div>
          <p className="text-[11px] text-gray-500 mt-3">{d.green}/{d.total} operational KPIs on target · snapshot {d.snapshotPeriod ?? "—"}.</p>
        </Card>
        <Card title="Operational Risks">
          {d.risks.length ? <div className="space-y-2">{d.risks.map((k: any) => (
            <div key={k.name} className="flex items-center gap-2"><RagDot status={k.status} /><span className="text-[12px] text-gray-800 flex-1 truncate">{k.name}</span><span className="text-gray-500 text-[11px] tabular-nums">{fmtVal(k.value, k.unit)}</span><Pill text={k.status === "red" ? "high" : "medium"} tone={k.status === "red" ? "rose" : "amber"} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">All operational KPIs on target. ✅</p>}
        </Card>
      </div>

      <Card title="Operational KPI Detail">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {d.cards.map((k: any) => <Kpi key={k.name} label={k.name} value={fmtVal(k.value, k.unit)} sub={k.isLive ? "live" : `target ${fmtVal(k.target, k.unit)}`} status={k.status} delta={k.deltaPct != null ? `${k.deltaPct}%` : undefined} deltaUp={k.deltaUp} series={k.trend} />)}
        </div>
      </Card>

      <Foot>UMW-PA-005 — operational intelligence over the Operations-perspective KPIs. {d.live} KPIs (occupancy, LOS, readmission, escalation, ED boarding, bed turnover, theatre utilisation, discharge-before-11) resolve <strong>live</strong> from the latest op_ops_snapshots; this is the exec analytics lens over the OPC operational data. Forecasting &amp; capacity models are the next phase.</Foot>
    </div>
  );
}
