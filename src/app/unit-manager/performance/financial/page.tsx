import { loadPaFinancial } from "@/lib/analytics/performance-modules";
import { paGuard, Head, Tabs, Card, Kpi, Ring, Donut, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-PA-006 Financial Performance Analytics Centre — budget vs actual, cost-centre performance, cost KPIs and
// variance over pa_cost_centres + Financial-perspective KPIs. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const fmtVal = (v: any, unit: string) => (v == null ? "—" : unit === "$" ? money(Number(v)) : unit === "%" ? `${v}%` : `${v}`);
const SPEND_COLORS = ["#3b82f6", "#ef4444", "#a855f7", "#f59e0b", "#22c55e"];

export default async function FinancialPage() {
  const { admin, isSuper, hid } = await paGuard();
  const d = await loadPaFinancial(admin, hid, isSuper) as any;
  const head = <Head code="UMW-PA-006 · Performance Analytics" title="Financial Performance Analytics Centre" sub="Executive financial intelligence — budget performance, cost per patient day, cost-centre variance and workforce cost, to optimise resources and control cost." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="006" /><Provision module="Financial Analytics" /></div>;
  if (!d.hasData) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="006" /><div className="bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded-xl p-6 text-sm text-blue-800">Seed the performance stores first.</div></div>;

  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="006" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-3.5 flex items-center gap-2"><Ring pct={d.score} size={60} /><div><p className="text-[11px] text-gray-500 uppercase tracking-wide leading-tight">Financial Health</p><p className="text-[11px] text-[var(--cmp-text-success)] font-medium">{d.score >= 80 ? "Good" : "Watch"}</p></div></div>
        <Kpi label="Budget Variance" value={`${d.variancePct >= 0 ? "+" : ""}${d.variancePct}%`} sub={d.variancePct <= 5 ? "under control" : "over budget"} status={Math.abs(d.variancePct) <= 3 ? "green" : Math.abs(d.variancePct) <= 5 ? "amber" : "red"} />
        <Kpi label="Actual (MTD)" value={money(d.totalActual)} sub={`budget ${money(d.totalBudget)}`} />
        {d.cards.slice(0, 5).map((k: any) => <Kpi key={k.name} label={k.name} value={fmtVal(k.value, k.unit)} sub={`target ${fmtVal(k.target, k.unit)}`} status={k.status} delta={k.deltaPct != null ? `${k.deltaPct}%` : undefined} deltaUp={k.deltaUp} series={k.trend} />)}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Budget Utilisation" right={<span className="text-[11px] text-gray-400">by category</span>}>
          <div className="flex items-center gap-3">
            <Donut segs={d.spend.map((s: any, i: number) => ({ n: s.actual, color: SPEND_COLORS[i % SPEND_COLORS.length] }))} total={d.spend.reduce((a: number, s: any) => a + s.actual, 0)} centre={money(d.spend.reduce((a: number, s: any) => a + s.actual, 0)).replace("$", "$").slice(0, 6)} sub="spend" size={104} />
            <div className="flex-1 space-y-1 text-[11px]">{d.spend.map((s: any, i: number) => <div key={s.name} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: SPEND_COLORS[i % SPEND_COLORS.length] }} /><span className="text-gray-600 flex-1 truncate">{s.name}</span><span className="font-semibold text-gray-900 tabular-nums">{s.share}%</span></div>)}</div>
          </div>
        </Card>

        <Card title="Cost Centre Performance" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">actual vs budget</span>}>
          <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Cost Centre</span><span className="w-24 text-right">Actual</span><span className="w-24 text-right">Budget</span><span className="w-20 text-right">Variance</span><span className="w-14 text-right">%</span></div>
            {d.depts.map((c: any) => (
              <div key={c.name} className="flex items-center px-1 py-1 text-[12px]"><span className="flex-1 text-gray-800 truncate">{c.name}</span><span className="w-24 text-right text-gray-900 tabular-nums">{money(c.actual)}</span><span className="w-24 text-right text-gray-400 tabular-nums">{money(c.budget)}</span><span className={`w-20 text-right tabular-nums ${c.variance > 0 ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"}`}>{c.variance > 0 ? "+" : ""}{money(c.variance)}</span><span className={`w-14 text-right tabular-nums font-semibold ${c.variancePct > 0 ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"}`}>{c.variancePct > 0 ? "+" : ""}{c.variancePct}%</span></div>
            ))}
            <div className="flex items-center px-1 py-1.5 border-t border-gray-200 text-[12px] font-semibold"><span className="flex-1 text-gray-700">Total</span><span className="w-24 text-right text-gray-900 tabular-nums">{money(d.totalActual)}</span><span className="w-24 text-right text-gray-500 tabular-nums">{money(d.totalBudget)}</span><span className={`w-20 text-right tabular-nums ${d.totalActual - d.totalBudget > 0 ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"}`}>{d.totalActual - d.totalBudget > 0 ? "+" : ""}{money(d.totalActual - d.totalBudget)}</span><span className={`w-14 text-right tabular-nums ${d.variancePct > 0 ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"}`}>{d.variancePct > 0 ? "+" : ""}{d.variancePct}%</span></div>
          </div>
        </Card>
      </div>

      <Card title="Financial KPI Detail">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {d.cards.map((k: any) => <Kpi key={k.name} label={k.name} value={fmtVal(k.value, k.unit)} sub={`target ${fmtVal(k.target, k.unit)}`} status={k.status} delta={k.deltaPct != null ? `${k.deltaPct}%` : undefined} deltaUp={k.deltaUp} series={k.trend} />)}
        </div>
      </Card>

      <Foot>UMW-PA-006 — financial analytics over pa_cost_centres (budget vs actual by department + spend category) and the Financial-perspective KPIs. This is seeded demo financial data (no live finance-system integration yet) — clearly a management model, not billed figures. Forecasting &amp; value-based-care metrics are the next phase.</Foot>
    </div>
  );
}
