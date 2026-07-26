import { hexGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Bars, Foot, T } from "../_ui";
import { loadExecIntelligence } from "@/lib/hex/intelligence";
import AiCopilotPanel from "@/components/AiCopilotPanel";

export const dynamic = "force-dynamic";

// HEX-002/010 Executive Intelligence & Decision Platform — live copilot + cross-domain intelligence.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["AI Summary", "Predictive Insights", "Benchmarking", "Scenario Planning", "Strategic Intelligence", "Sentiment & Signals", "Data Explorer", "Custom Analysis", "AI Copilot"];

export default async function ExecIntelligencePage() {
  const { admin, isSuper, hid } = await hexGuard();
  const d = await loadExecIntelligence(admin, hid, isSuper);
  const head = <Head code="HEX-002 · Hospital Executive" title="Executive Intelligence" sub="AI-powered insights, predictive intelligence and strategic foresight for smarter executive decisions." />;
  const k = d.kpis;
  const pct = (v: any) => (v != null ? `${Math.round(Number(v))}%` : "—");

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="AI Summary" />

      <AiCopilotPanel endpoint="/api/executive-ai/copilot" title="Executive Intelligence — live copilot" sublabel="Grounded in your live scorecard, workforce, quality, risk & operations data · logged to the AI gateway" placeholder="Ask for a briefing, top risks, or what needs leadership attention…" prompts={["Executive briefing", "Top enterprise risks", "What needs leadership attention?", "Summarise quality & safety"]} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="🎯" tone={k.performanceIndex != null && k.performanceIndex >= 75 ? "emerald" : "amber"} label="Performance index" value={pct(k.performanceIndex)} sub="readiness" />
        <Stat icon="🚀" tone="blue" label="Strategy progress" value={pct(k.strategyProgress)} />
        <Stat icon="🛡️" tone={k.riskExposure != null && k.riskExposure >= 50 ? "rose" : "amber"} label="Risk exposure" value={k.riskExposure != null ? `${k.riskExposure}/100` : "—"} sub={`${k.highRisks} high`} />
        <Stat icon="👥" tone="teal" label="Workforce readiness" value={pct(k.workforceReadiness)} />
        <Stat icon="🩺" tone="violet" label="Quality & safety" value={pct(k.qualitySafety)} />
        <Stat icon="🏥" tone="indigo" label="Bed occupancy" value={pct(k.occupancy)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="AI executive summary" right="rule-based">
          <div className="bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-100 rounded-lg p-3">
            <ul className="space-y-1.5">{d.summary.lines.map((l: string, i: number) => <li key={i} className="text-[12.5px] text-gray-800 leading-snug flex gap-2"><span className="text-violet-400">›</span>{l}</li>)}</ul>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">An at-a-glance rule-based summary. For natural-language reasoning, use the live copilot above (real LLM, grounded &amp; logged).</p>
        </Card>

        <Card title="Predictive insights" right="explainable">
          <div className="space-y-2">{d.insights.map((it: any, i: number) => (
            <div key={i} className="flex items-start gap-2 border border-gray-100 rounded-lg p-2.5">
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${T(it.tone).dot}`} />
              <div className="min-w-0 flex-1"><p className="text-[12.5px] font-medium text-gray-800 leading-snug">{it.title}</p><p className="text-[11px] text-gray-500">{it.detail}</p></div>
              <Pill text={it.level} tone={it.tone} />
            </div>
          ))}</div>
        </Card>

        <Card title="Strategic focus areas">
          {d.focus.length ? <Bars items={d.focus.map((f: any) => ({ label: f.label, pct: f.has ? f.pct : 0, value: f.has ? `${f.pct}%` : "—" }))} /> : <p className="text-sm text-gray-400 py-6 text-center">No scorecard data.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Risk intelligence">
          {d.riskByCat.length ? <div className="flex items-center gap-2"><Donut segments={d.riskByCat} total={d.riskByCat.reduce((s: number, x: any) => s + x.value, 0)} label="Risks" size={120} /><Legend items={d.riskByCat.map((c: any) => ({ label: c.label, value: c.value, tone: c.tone }))} /></div> : <p className="text-sm text-gray-400 py-6 text-center">No risks registered.</p>}
        </Card>

        <Card title="AI recommendations" right="ranked">
          {d.recommendations.length ? <div className="space-y-2">{d.recommendations.map((r: string, i: number) => (
            <div key={i} className="flex items-center gap-2 border border-gray-100 rounded-lg p-2.5"><span className="w-6 h-6 rounded-lg bg-indigo-50 flex items-center justify-center text-[13px] shrink-0">💡</span><p className="text-[12.5px] text-gray-800">{r}</p></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No elevated signals. ✅</p>}
        </Card>

        <Card title="Benchmarking">
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <span className="text-2xl mb-1">📊</span>
            <p className="text-[12px] text-gray-500">Peer benchmarking is the next phase.</p>
            <p className="text-[10px] text-gray-400 mt-1">Internal cross-domain intelligence is live; comparison vs similar hospitals needs a peer/reference dataset.</p>
          </div>
        </Card>
      </div>

      <Card title="Data & model health" right="plat_ai_requests">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-[12.5px]">
          <div className="flex justify-between border border-gray-100 rounded-lg px-3 py-2"><span className="text-gray-500">Executive copilot calls</span><b className="tabular-nums">{d.aiUsage.execCalls}</b></div>
          <div className="flex justify-between border border-gray-100 rounded-lg px-3 py-2"><span className="text-gray-500">Platform AI calls</span><b className="tabular-nums">{d.aiUsage.totalCalls}</b></div>
          <div className="flex justify-between border border-gray-100 rounded-lg px-3 py-2"><span className="text-gray-500">Tokens processed</span><b className="tabular-nums">{d.aiUsage.tokens.toLocaleString()}</b></div>
        </div>
        <p className="text-[10px] text-gray-400 mt-2">Every copilot call is metered to the AI Services Platform (AIS-011 Observability / AIS-008 Governance) — real spend and latency, fully auditable.</p>
      </Card>

      <Foot>HEX-002/010 — the <strong>live copilot</strong> (top) is a real LLM grounded in the cross-domain executive scorecard via the AI Runtime Gateway; every call logs to <code>plat_ai_requests</code>. The intelligence widgets aggregate real stores (executive scorecard, <code>ppe_*</code> strategy, <code>gov_risks</code>, ops &amp; quality snapshots); &ldquo;predicted&rdquo;/summary signals are transparent <strong>rule-based</strong> derivations, not black-box ML. Peer benchmarking and a persisted decision/scenario store are the next build phase.</Foot>
    </div>
  );
}
