import { hexGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Trend, Foot, T } from "../_ui";
import { loadExecRisk } from "@/lib/hex/risk";
import Link from "next/link";

export const dynamic = "force-dynamic";

// HEX-008 Enterprise Risk Management (executive lens) over the real risk register.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Risk Dashboard", "Risk Register", "Heat Maps", "Risk Categories", "Mitigations", "Analytics", "Scenario Planning", "Business Continuity", "Reports"];
const IMPACT = ["Insignificant", "Minor", "Moderate", "Major", "Catastrophic"];
const LIKELI: Record<number, string> = { 5: "Almost certain", 4: "Likely", 3: "Possible", 2: "Unlikely", 1: "Rare" };
const ST_TONE: Record<string, string> = { open: "amber", mitigating: "blue", accepted: "emerald", escalated: "rose", closed: "slate" };

export default async function ExecRiskPage() {
  const { admin, isSuper, hid } = await hexGuard();
  const d = await loadExecRisk(admin, hid, isSuper);
  const head = <Head code="HEX-008 · Hospital Executive" title="Enterprise Risk Management" sub="Enterprise risk intelligence — monitor, predict, mitigate." action={{ label: "AI Risk Advisor →", href: "/hospital-executive/intelligence" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Risk Dashboard" /><Card><p className="text-sm text-gray-400">The risk register (<code>gov_risks</code>) is not provisioned yet.</p></Card></div>;
  const r = d.r, k = r.kpis;
  const ctrlTotal = r.ctrlEff.reduce((s: number, e: any) => s + e.value, 0);
  const ctrlEffective = r.ctrlEff.filter((e: any) => ["effective", "partially effective"].includes(e.label)).reduce((s: number, e: any) => s + e.value, 0);
  const ctrlPct = ctrlTotal ? Math.round((ctrlEffective / ctrlTotal) * 100) : null;

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Risk Dashboard" />

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Stat icon="🎯" tone={d.scoreTone} label="Enterprise risk score" value={d.score} sub={d.scoreBand} />
        <Stat icon="🔴" tone="rose" label="High & extreme" value={k.extreme + k.high} sub={`${k.extreme} extreme`} />
        <Stat icon="⏰" tone={d.mitigation.overdue ? "rose" : "emerald"} label="Overdue mitigations" value={d.mitigation.overdue} sub={`of ${d.mitigation.total} actions`} />
        <Stat icon="🛡️" tone={d.appetite ? "amber" : "emerald"} label="Above appetite" value={d.appetite} sub="high/extreme" />
        <Stat icon="📈" tone="violet" label="Emerging risks" value={d.emerging.length} sub="last 60 days" />
        <Stat icon="✓" tone="teal" label="Control effectiveness" value={ctrlPct != null ? `${ctrlPct}%` : "—"} sub={`${k.controls} controls`} />
        <Stat icon="📋" tone="blue" label="Total risks" value={k.total} sub="active register" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Enterprise risk heat map" className="xl:col-span-2" right="likelihood × impact">
          <div className="overflow-x-auto">
            <div className="min-w-[440px]">
              <div className="flex"><div className="w-24 shrink-0" /><div className="flex-1 grid grid-cols-5 gap-1">{IMPACT.map(im => <div key={im} className="text-[9px] text-gray-400 text-center leading-tight">{im}</div>)}</div></div>
              {r.heat.map((row: any) => (
                <div key={row.likelihood} className="flex items-center mt-1">
                  <div className="w-24 shrink-0 text-[10px] text-gray-500 text-right pr-2">{LIKELI[row.likelihood]}</div>
                  <div className="flex-1 grid grid-cols-5 gap-1">{row.cells.map((c: any) => <div key={c.impact} className="h-9 rounded flex items-center justify-center text-[13px] font-bold tabular-nums" style={{ backgroundColor: T(c.tone).hex + (c.count ? "26" : "12"), color: c.count ? T(c.tone).hex : "#cbd5e1" }}>{c.count}</div>)}</div>
                </div>
              ))}
              <div className="flex mt-1"><div className="w-24 shrink-0" /><div className="flex-1 text-center text-[9px] text-gray-400 uppercase tracking-wide">Impact →</div></div>
            </div>
          </div>
          <div className="flex gap-3 mt-2">{r.bandLegend.map((b: any) => <span key={b.label} className="flex items-center gap-1 text-[11px]"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: T(b.tone).hex }} />{b.label} ({b.value})</span>)}</div>
        </Card>

        <Card title="Top risks" right="by inherent score">
          <div className="space-y-1.5">
            {r.topRisks.map((risk: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <span className="text-gray-400 tabular-nums w-4">{i + 1}</span>
                <span className="text-gray-800 truncate flex-1">{risk.title}</span>
                <span className="inline-flex items-center justify-center w-6 h-6 rounded text-[11px] font-bold" style={{ backgroundColor: T(risk.tone).hex + "22", color: T(risk.tone).hex }}>{risk.score}</span>
                <Pill text={risk.status} tone={ST_TONE[risk.status] ?? "slate"} />
              </div>
            ))}
            {!r.topRisks.length && <p className="text-sm text-gray-400 py-4 text-center">No risks registered.</p>}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card title="Risks by category"><div className="flex items-center gap-2"><Donut segments={r.byCategory} total={k.total} label="Risks" size={118} /><Legend items={r.byCategory.slice(0, 6).map((c: any) => ({ label: c.label, value: c.value, tone: c.tone }))} /></div></Card>
        <Card title="Risks by level"><div className="flex items-center gap-2"><Donut segments={r.bandLegend} total={k.total} label="Risks" size={118} /><Legend items={r.bandLegend.filter((b: any) => b.value).map((b: any) => ({ label: b.label, value: b.value, tone: b.tone }))} /></div></Card>
        <Card title="Mitigation status"><div className="flex items-center gap-2"><Donut segments={d.mitigation.donut} total={d.mitigation.total} label="Actions" size={118} /><Legend items={d.mitigation.donut.filter((m: any) => m.value).map((m: any) => ({ label: m.label, value: m.value, tone: m.tone }))} /></div></Card>
        <Card title="Control effectiveness">{r.ctrlEff.some((e: any) => e.value) ? <Legend items={r.ctrlEff.filter((e: any) => e.value).map((e: any) => ({ label: e.label, value: e.value, tone: e.tone }))} /> : <p className="text-sm text-gray-400 py-4 text-center">No controls registered.</p>}</Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Risk trend" className="xl:col-span-2" right="high-risk, last 6 months">
          {r.trend.length >= 2 ? <><Trend points={r.trend.map((t: any) => t.value)} labels={r.trend.map((t: any) => t.label)} tone="rose" /><p className="text-[10px] text-gray-400 text-center mt-1">Open high/extreme risks per month (daily snapshots).</p></> : <p className="text-sm text-gray-400 py-8 text-center">Not enough snapshot history yet.</p>}
        </Card>

        <Card title="Top emerging risks" right="last 60 days">
          {d.emerging.length ? <div className="space-y-2">{d.emerging.map((e: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[12px]"><div className="min-w-0 flex-1"><p className="text-gray-800 truncate">{e.title}</p><p className="text-[10px] text-gray-400 capitalize">{e.category} · {e.when}</p></div><span className="tabular-nums font-semibold text-gray-700">{e.score}</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No new risks in the last 60 days.</p>}
          <p className="text-[10px] text-gray-400 mt-2"><Link href="/hospital-executive/intelligence" className="text-teal-600 hover:underline">Ask the AI Risk Advisor →</Link></p>
        </Card>
      </div>

      <Foot>HEX-008 — executive lens over the real risk register (<code>gov_risks</code> + <code>gov_controls</code>). Heat map, top risks, category/level mix, control effectiveness and the high-risk trend are live and tenant-scoped; the enterprise risk score is a transparent weighted composite of the band distribution, mitigation status reads the corrective-action queue (<code>capa_actions</code>), and emerging risks are the register&apos;s newest entries. Risk-appetite thresholds and scenario/business-continuity modules are the next build phase.</Foot>
    </div>
  );
}
