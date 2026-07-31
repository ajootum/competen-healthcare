import { qaGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Trend, Foot, T } from "../_ui";
import { loadRiskCentre } from "@/lib/qaw/risk-centre";
import Link from "next/link";

export const dynamic = "force-dynamic";

// QAW-004 Enterprise Risk Management Centre — ISO 31000 register, heat map, controls, treatment.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Risk Register", "Risk Assessment", "Risk Heat Map", "Treatment Plans", "Controls", "Risk Indicators", "Reports & Analytics"];
const IMPACT = ["Insignificant", "Minor", "Moderate", "Major", "Catastrophic"];
const LIKELI: Record<number, string> = { 5: "Almost certain", 4: "Likely", 3: "Possible", 2: "Unlikely", 1: "Rare" };
const ST_TONE: Record<string, string> = { open: "amber", mitigating: "blue", accepted: "emerald", escalated: "rose", closed: "slate" };

export default async function RiskCentrePage() {
  const { admin, isSuper, hid } = await qaGuard();
  const d = await loadRiskCentre(admin, hid, isSuper);
  const head = <Head code="QAW-004 · Quality & Accreditation" title="Enterprise Risk Management Centre" sub="Identify, assess, monitor and manage risks across the organization." action={{ label: "+ New risk", href: "/enterprise-governance" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">The risk register (<code>gov_risks</code>) is not provisioned yet.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="🛡️" tone="teal" label="Total risks" value={k.total} />
        <Stat icon="🔴" tone="rose" label="High / extreme" value={k.extreme + k.high} sub={`${k.extreme} extreme`} />
        <Stat icon="🟠" tone="amber" label="Medium risks" value={k.medium} />
        <Stat icon="🟢" tone="emerald" label="Low risks" value={k.low} />
        <Stat icon="🎯" tone="violet" label="With active controls" value={`${k.controlled}%`} sub={`${k.controls} controls`} />
        <Stat icon="🧯" tone="blue" label="Open treatment" value={k.openTreatment} sub="risks being treated" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Risk heat map" className="xl:col-span-2" right="likelihood × impact">
          <div className="overflow-x-auto">
            <div className="min-w-[440px]">
              <div className="flex">
                <div className="w-24 shrink-0" />
                <div className="flex-1 grid grid-cols-5 gap-1">
                  {IMPACT.map(im => <div key={im} className="text-[9px] text-gray-400 text-center leading-tight">{im}</div>)}
                </div>
              </div>
              {d.heat.map(row => (
                <div key={row.likelihood} className="flex items-center mt-1">
                  <div className="w-24 shrink-0 text-[10px] text-gray-500 text-right pr-2">{LIKELI[row.likelihood]}</div>
                  <div className="flex-1 grid grid-cols-5 gap-1">
                    {row.cells.map(c => (
                      <div key={c.impact} className="h-9 rounded flex items-center justify-center text-[13px] font-bold tabular-nums" style={{ backgroundColor: T(c.tone).hex + (c.count ? "26" : "12"), color: c.count ? T(c.tone).hex : "#cbd5e1" }}>{c.count}</div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex mt-1"><div className="w-24 shrink-0" /><div className="flex-1 text-center text-[9px] text-gray-400 uppercase tracking-wide">Impact →</div></div>
            </div>
          </div>
          <div className="flex gap-3 mt-2">{d.bandLegend.map((b: any) => <span key={b.label} className="flex items-center gap-1 text-[11px]"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: T(b.tone).hex }} />{b.label} ({b.value})</span>)}</div>
        </Card>

        <Card title="Risk by category">
          <div className="flex items-center gap-2">
            <Donut segments={d.byCategory} total={k.total} label="Total risks" size={130} />
            <Legend items={d.byCategory.slice(0, 7).map((c: any) => ({ label: c.label, value: c.value, tone: c.tone, pct: k.total ? Math.round((c.value / k.total) * 100) : 0 }))} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Top risks" className="xl:col-span-2" right="by inherent score">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100"><th className="pb-2 pr-3 font-medium">Risk</th><th className="pb-2 pr-3 font-medium">Category</th><th className="pb-2 pr-3 font-medium">Score</th><th className="pb-2 pr-3 font-medium">Residual</th><th className="pb-2 font-medium">Status</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {d.topRisks.map((r: any, i: number) => (
                  <tr key={i} className="text-gray-700">
                    <td className="py-2 pr-3 font-medium text-gray-800">{r.title}</td>
                    <td className="py-2 pr-3 text-gray-500 capitalize">{r.category}</td>
                    <td className="py-2 pr-3"><span className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-[12px] font-bold" style={{ backgroundColor: T(r.tone).hex + "22", color: T(r.tone).hex }}>{r.score}</span></td>
                    <td className="py-2 pr-3 tabular-nums text-gray-500">{r.residual}{r.lower && <span className="text-[var(--cmp-text-success)]"> ↓</span>}</td>
                    <td className="py-2"><Pill text={r.status} tone={ST_TONE[r.status] ?? "slate"} /></td>
                  </tr>
                ))}
                {!d.topRisks.length && <tr><td colSpan={5} className="py-6 text-center text-gray-400">No risks registered yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Risk status">
          <div className="flex items-center gap-2">
            <Donut segments={d.statusDonut} total={k.total} label="Total" size={120} />
            <Legend items={d.statusDonut.filter((s: any) => s.value > 0).map((s: any) => ({ label: s.label, value: s.value, tone: s.tone }))} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="High-risk trend" right="last 6 months">
          {d.trend.length >= 2 ? <><Trend points={d.trend.map((t: any) => t.value)} labels={d.trend.map((t: any) => t.label)} tone="rose" /><p className="text-[10px] text-gray-400 text-center mt-1">Open high/extreme risks per month (from daily quality snapshots).</p></> : <p className="text-sm text-gray-400 py-8 text-center">Not enough snapshot history yet for a trend.</p>}
        </Card>

        <Card title="Controls effectiveness" right={`${k.controls} controls`}>
          {d.ctrlEff.some((e: any) => e.value) ? <Legend items={d.ctrlEff.filter((e: any) => e.value).map((e: any) => ({ label: e.label, value: e.value, tone: e.tone }))} /> : <p className="text-sm text-gray-400 py-4 text-center">No controls registered yet.</p>}
          <p className="text-[10px] text-gray-400 mt-3">Treatment strategy: {d.treatmentSplit.map((t: any) => `${t.label} ${t.value}`).join(" · ") || "—"}.</p>
        </Card>

        <Card title="Key Risk Indicators (KRIs)">
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <span className="text-2xl mb-1">📡</span>
            <p className="text-[12px] text-gray-500">KRI threshold monitoring is the next phase.</p>
            <p className="text-[10px] text-gray-400 mt-1">Risk scores, controls and treatment above are live from the register; a dedicated KRI store (metric + threshold + breach state) lights this panel up.</p>
          </div>
        </Card>
      </div>

      <Foot>QAW-004 — live over <code>gov_risks</code> + <code>gov_controls</code>. Heat map, category mix, top risks, residual scores, status, treatment strategy and controls effectiveness are all real and tenant-scoped; the high-risk trend reads the daily <code>quality_score_snapshots</code>. Treatment <em>actions</em> are tracked as corrective actions in the <Link href="/quality-accreditation/improvements" className="text-teal-600 hover:underline">CAPA centre</Link>; KRI monitoring is next-phase.</Foot>
    </div>
  );
}
