import { fetchCmoSuite, RISK_TONE } from "@/lib/competency/cmo-suite";
import { cmoGuard, Head, Card, Kpi, Pill, Provision, Foot } from "../_cmo-ui";

export const dynamic = "force-dynamic";

// CMO-019 Competency Forecasting & Workforce Planning — predict future competency demand vs supply and surface gaps.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function ForecastingPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await fetchCmoSuite(admin, hid, isSuper);
  const head = <Head code="CMO-019 · Competency Office" title="Competency Forecasting & Workforce Planning" sub="Predict future competency demand, identify emerging capability gaps and support evidence-based recruitment, education and succession planning." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="Forecasting" part="part 1" /></div>;

  const fc = [...d.forecasts].sort((a: any, b: any) => b.gap - a.gap);
  const totalDemand = fc.reduce((a: number, f: any) => a + Number(f.demand || 0), 0);
  const totalSupply = fc.reduce((a: number, f: any) => a + Number(f.current_supply || 0), 0);
  const totalGap = fc.reduce((a: number, f: any) => a + Number(f.gap || 0), 0);
  const highRisk = fc.filter((f: any) => f.risk === "high");
  const maxScale = Math.max(1, ...fc.map((f: any) => Math.max(Number(f.demand), Number(f.current_supply))));

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Kpi label="Competencies Forecast" value={fc.length} sub="modelled" />
        <Kpi label="Total Demand" value={totalDemand} sub="required (FTE-competency)" />
        <Kpi label="Current Supply" value={totalSupply} sub="competent staff" />
        <Kpi label="Projected Gap" value={totalGap} sub="to close" tone={totalGap ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="High-Risk" value={highRisk.length} sub="competencies" tone={highRisk.length ? "text-rose-600" : undefined} />
      </div>

      <Card title="Supply vs Demand" right={<span className="text-[11px] text-gray-400">by projected gap</span>}>
        <div className="space-y-2">
          <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="w-48">Competency</span><span className="flex-1">Supply vs Demand</span><span className="w-16 text-right">Gap</span><span className="w-20 text-right">Horizon</span><span className="w-16 text-center">Risk</span></div>
          {fc.map((f: any) => (
            <div key={f.id} className="flex items-center gap-2 px-1 text-[12px]">
              <span className="w-48 text-gray-800 truncate">{f.competency}</span>
              <div className="flex-1 flex items-center gap-1">
                <div className="flex-1 h-3 rounded bg-gray-100 relative overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-teal-400 rounded" style={{ width: `${(Number(f.current_supply) / maxScale) * 100}%` }} />
                  <div className="absolute inset-y-0 left-0 border-r-2 border-rose-500" style={{ width: `${(Number(f.demand) / maxScale) * 100}%` }} title={`demand ${f.demand}`} />
                </div>
                <span className="text-[10px] text-gray-400 tabular-nums w-16 text-right">{f.current_supply}/{f.demand}</span>
              </div>
              <span className={`w-16 text-right tabular-nums font-semibold ${f.gap > 0 ? "text-rose-600" : "text-emerald-600"}`}>{f.gap > 0 ? `−${f.gap}` : "0"}</span>
              <span className="w-20 text-right text-gray-400 text-[11px]">{f.horizon}</span>
              <span className="w-16 text-center"><Pill text={f.risk} tone={RISK_TONE[f.risk]} /></span>
            </div>
          ))}
        </div>
        <div className="flex gap-3 mt-2 text-[10px] text-gray-400"><span className="flex items-center gap-1"><span className="w-2 h-2 bg-teal-400 rounded-full" />Current supply</span><span className="flex items-center gap-1"><span className="w-2 h-3 border-r-2 border-rose-500" />Demand threshold</span></div>
      </Card>

      <Card title="High-Risk Competencies" right={<span className="text-[11px] text-gray-400">prioritise</span>}>
        {highRisk.length ? <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">{highRisk.map((f: any) => (
          <div key={f.id} className="border border-rose-100 bg-rose-50/40 rounded-lg p-2.5"><p className="text-[12px] font-medium text-gray-900">{f.competency}</p><p className="text-[11px] text-gray-500 mt-0.5">Gap of {f.gap} over {f.horizon} — advance recruitment/education.</p></div>
        ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No high-risk competency shortfalls forecast. ✅</p>}
      </Card>

      <Foot>CMO-019 — workforce forecasting over cmo_forecasts (supply vs demand per competency + risk). Projections are real config; scenario planning, seasonality modelling and AI-driven succession/recruitment optimisation are the next phase. Feeds and is fed by the readiness snapshots (CMO-018).</Foot>
    </div>
  );
}
