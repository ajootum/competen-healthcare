import { fetchCmoSuite, STATUS_TONE } from "@/lib/competency/cmo-suite";
import { cmoGuard, Head, Card, Kpi, Progress, Pill, Bars, Provision, Foot } from "../_cmo-ui";

export const dynamic = "force-dynamic";

// CMO-009 Enterprise Competency Planning — strategic roadmaps, investment, succession and recruitment planning.
/* eslint-disable @typescript-eslint/no-explicit-any */
const money = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);
const TYPE_LABEL: Record<string, string> = { roadmap: "Roadmap", investment: "Investment", succession: "Succession", recruitment: "Recruitment", education: "Education" };

export default async function PlanningPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await fetchCmoSuite(admin, hid, isSuper);
  const head = <Head code="CMO-009 · Competency Office" title="Enterprise Competency Planning" sub="Forecast, prioritise and manage enterprise competency requirements — strategic roadmaps, investment, succession and recruitment planning." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="Enterprise Planning" part="part 1" /></div>;

  const plans = [...d.plans].sort((a: any, b: any) => Number(b.progress_pct) - Number(a.progress_pct));
  const active = plans.filter((p: any) => p.status === "active");
  const budget = plans.reduce((a: number, p: any) => a + Number(p.budget || 0), 0);
  const byType = Object.entries(plans.reduce((acc: Record<string, number>, p: any) => { acc[p.plan_type] = (acc[p.plan_type] ?? 0) + 1; return acc; }, {})).map(([k, n]) => ({ label: TYPE_LABEL[k] ?? k, n: n as number }));

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Kpi label="Strategic Plans" value={plans.length} sub={`${active.length} active`} />
        <Kpi label="Avg Progress" value={`${active.length ? Math.round(active.reduce((a: number, p: any) => a + Number(p.progress_pct), 0) / active.length) : 0}%`} sub="active plans" />
        <Kpi label="Total Investment" value={money(budget)} sub="allocated" tone="text-teal-600" />
        <Kpi label="Plan Types" value={byType.length} sub="strategies" />
        <Kpi label="Forecasts Linked" value={d.forecasts.length} sub="demand models" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Strategic Plans" className="xl:col-span-2">
          <div className="space-y-2">{plans.map((p: any) => (
            <div key={p.id} className="border border-gray-100 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex items-center gap-1.5 flex-wrap"><p className="text-[13px] font-medium text-gray-900">{p.name}</p><Pill text={TYPE_LABEL[p.plan_type] ?? p.plan_type} tone="violet" /><Pill text={p.status} tone={STATUS_TONE[p.status]} /></div><p className="text-[11px] text-gray-400 mt-0.5">Horizon: {p.horizon}</p></div><div className="text-right shrink-0"><p className="text-sm font-bold text-gray-900 tabular-nums">{Math.round(Number(p.progress_pct))}%</p><p className="text-[10px] text-gray-400">{p.budget ? money(Number(p.budget)) : "—"}</p></div></div>
              <div className="mt-2"><Progress pct={Number(p.progress_pct)} /></div>
            </div>
          ))}</div>
        </Card>

        <Card title="Plans by Type">
          <Bars rows={byType} />
          <p className="text-[10px] text-gray-400 mt-3">Roadmaps set the competency trajectory; investment/recruitment/succession/education plans resource it. Demand forecasts (CMO-019) feed supply-vs-demand analysis.</p>
        </Card>
      </div>

      <Foot>CMO-009 — enterprise competency planning over cmo_plans. Roadmaps, progress and investment are real; scenario planning, supply-vs-demand analysis (with CMO-019) and AI planning assistance are the next phase.</Foot>
    </div>
  );
}
