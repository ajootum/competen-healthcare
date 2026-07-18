import Link from "next/link";
import { loadAnalytics, requireAnalyticsAccess, riskBuckets, competencyProfile } from "@/lib/analytics";
import { ModuleHeader, StatTiles, Card } from "../ui";

// Workforce Intelligence module — forward-looking figures computed from REAL
// dates already in the records (decision expiries, credential expiries), plus
// current gaps. Explicitly not ML prediction; every forecast is a date count.

export const dynamic = "force-dynamic";

export default async function WorkforceIntelligencePage() {
  const { admin, hospitalId } = await requireAnalyticsAccess();
  const ctx = await loadAnalytics(admin, hospitalId);

  const { data: credsRaw } = hospitalId
    ? await admin.from("professional_credentials").select("nurse_id, expiry_date, credential_type").not("expiry_date", "is", null).limit(2000)
    : { data: [] };
  const creds = (credsRaw ?? []).filter(c => ctx.nurseIds.has(c.nurse_id));

  const now = new Date().getTime();
  const monthKey = (offset: number) => {
    const d = new Date(now); d.setDate(1); d.setMonth(d.getMonth() + offset);
    return { key: d.toISOString().slice(0, 7), label: d.toLocaleDateString(undefined, { month: "short" }) };
  };
  const months = Array.from({ length: 6 }, (_, i) => monthKey(i));

  // Reassessment demand: passing decisions whose expiry falls in each month.
  const demand = months.map(m => ({
    ...m,
    n: ctx.latest.filter(d => d.passing && d.expiry_date && d.expiry_date.startsWith(m.key)).length,
  }));
  const demandMax = Math.max(1, ...demand.map(d => d.n));

  // Credential expiries per month.
  const credDemand = months.map(m => ({ ...m, n: creds.filter(c => c.expiry_date.startsWith(m.key)).length }));
  const credMax = Math.max(1, ...credDemand.map(d => d.n));

  // Readiness: compliant (passing, validated, unexpired) share of latest decisions.
  const compliant = ctx.latest.filter(d => d.passing && d.validated && !d.expired).length;
  const readiness = ctx.latest.length ? Math.round(compliant / ctx.latest.length * 100) : null;
  const expiredNow = ctx.latest.filter(d => d.expired).length;
  const risk = riskBuckets(ctx.latest, ctx.nurses.length);

  // Competency shortages: competencies with the fewest currently-competent holders.
  const comps = competencyProfile(ctx.latest);
  const shortages = comps.filter(c => c.total >= 2).sort((a, b) => a.pct - b.pct).slice(0, 5);

  const totalDemand = demand.reduce((s, d) => s + d.n, 0);
  const totalCred = credDemand.reduce((s, d) => s + d.n, 0);

  return (
    <div className="max-w-4xl">
      <ModuleHeader icon="🔮" title="Workforce Intelligence" sub="Forward workload and readiness — computed from real expiry dates on record, not ML prediction." />
      <StatTiles tiles={[
        { label: "Workforce Readiness", value: readiness != null ? `${readiness}%` : "—", sub: "validated & current decisions" },
        { label: "Reassessment Demand (6m)", value: String(totalDemand), sub: "decision expiries ahead", alert: totalDemand > 20 },
        { label: "Credential Expiries (6m)", value: String(totalCred) },
        { label: "Expired Now", value: String(expiredNow), sub: `${risk.high} high-risk learners`, alert: expiredNow > 0 },
      ]} />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Card title="Reassessment Demand" sub="competency expiries per month ahead">
          <div className="flex items-end gap-2 h-28">
            {demand.map(d => (
              <div key={d.key} className="flex-1 flex flex-col items-center gap-1" title={`${d.n} expiring`}>
                <span className="text-[9px] font-bold text-gray-700">{d.n}</span>
                <div className="w-full bg-gray-100 rounded-t flex items-end" style={{ height: "76px" }}>
                  <div className="w-full bg-amber-400 rounded-t" style={{ height: `${Math.round(d.n / demandMax * 72)}px` }} />
                </div>
                <span className="text-[8px] text-gray-400">{d.label}</span>
              </div>
            ))}
          </div>
          <Link href="/assessor/calendar" className="mt-2 inline-block text-[11px] font-semibold text-indigo-600 hover:underline">Plan sessions in the Assessment Calendar →</Link>
        </Card>
        <Card title="Credential Expiry Forecast" sub="professional credentials per month ahead">
          <div className="flex items-end gap-2 h-28">
            {credDemand.map(d => (
              <div key={d.key} className="flex-1 flex flex-col items-center gap-1" title={`${d.n} expiring`}>
                <span className="text-[9px] font-bold text-gray-700">{d.n}</span>
                <div className="w-full bg-gray-100 rounded-t flex items-end" style={{ height: "76px" }}>
                  <div className="w-full bg-indigo-400 rounded-t" style={{ height: `${Math.round(d.n / credMax * 72)}px` }} />
                </div>
                <span className="text-[8px] text-gray-400">{d.label}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Competency Shortages" sub="fewest currently-competent holders (≥2 decisions)">
        {shortages.length ? (
          <div className="space-y-1.5">
            {shortages.map(c => (
              <div key={c.name}>
                <div className="flex items-center justify-between text-[11px] mb-0.5">
                  <span className="text-gray-700">{c.name}</span>
                  <span className="font-bold text-red-600">{c.pct}% <span className="font-normal text-gray-300">competent of {c.total}</span></span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-red-400 rounded-full" style={{ width: `${c.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">Not enough decision data to identify shortages.</p>}
      </Card>

      <p className="text-[10px] text-gray-400 mt-4">
        Every figure here is a count of real dates and decisions on record. Predictive modelling (attrition, demand simulation) is not built —
        when the mockup says &quot;prediction&quot;, this module deliberately shows the factual forecast instead.
      </p>
    </div>
  );
}
