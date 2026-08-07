import { hexGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Bars, Foot, T } from "../_ui";
import { loadExecIntelligence } from "@/lib/hex/intelligence";
import AiCopilotPanel from "@/components/AiCopilotPanel";
import { gateFor } from "@/lib/platform/feature-flags";

export const dynamic = "force-dynamic";

// HEX-002/010 Executive Intelligence & Decision Platform — live copilot + cross-domain intelligence.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS IS THE PLATFORM FEATURE-FLAG ENGINE'S ONE LIVE GATE.
//
// plat_feature_flags has been seeded since migration 042 and the resolver, the scope precedence and the
// assignment UI were all written -- and NOTHING in the application ever asked it a question. Five
// switches on a page, wired to nothing. This module is the first real consumer, chosen deliberately:
//
//   * `executive_intelligence` is the flag whose own description ("Executive intelligence suite") names
//     this module. The key is not being repurposed to prove a point.
//   * Its default_on is TRUE and there are no assignments, so wiring the gate changes nothing for anyone
//     today. A gate whose introduction is itself an outage proves nothing.
//   * Off is SAFE: this is a read-only analytics lens. No clinical action, no authentication, no sign-in
//     and no write depends on it -- unlike the practice launch flags, which have live users behind them.
//   * Off is OBSERVABLE: the module says it is switched off, which flag did it, and at which scope --
//     rather than vanishing, erroring, or rendering empty widgets that read as "no data".
//
// The three states are rendered as three states. "off" is a decision and says who made it; "unresolved"
// is the absence of a decision and says so plainly, because a switch that cannot be read is not a switch
// that is off.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["AI Summary", "Predictive Insights", "Benchmarking", "Scenario Planning", "Strategic Intelligence", "Sentiment & Signals", "Data Explorer", "Custom Analysis", "AI Copilot"];

export default async function ExecIntelligencePage() {
  const { admin, user, isSuper, hid } = await hexGuard();

  const gate = await gateFor(admin, "executive_intelligence", user.id);
  if (gate.state !== "on") {
    const withheld = gate.state === "off";
    return (
      <div className="space-y-4">
        <Head code="HEX-002 · Hospital Executive" title="Executive Intelligence" sub="AI-powered insights, predictive intelligence and strategic foresight for smarter executive decisions." />
        <Card title={withheld ? "Switched off for this organisation" : "This module could not be switched on or off"}>
          <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
            <span className="text-2xl">{withheld ? "🔌" : "❓"}</span>
            <p className="text-[13px] text-gray-700 max-w-lg">
              {withheld
                ? "Executive Intelligence is switched off here. Nothing is broken and no data has been lost — the module is simply not enabled."
                : "Executive Intelligence is not showing, because the platform could not work out whether it should be. It is withheld rather than guessed."}
            </p>
            <p className="text-[12px] text-gray-500 max-w-lg">{gate.reason}</p>
            <p className="text-[10.5px] text-gray-400 font-mono">
              flag {gate.key} · state {gate.state} · decided by {gate.decidedBy}{gate.scopeRef ? ` (${gate.scopeRef})` : ""}
            </p>
            <p className="text-[11px] text-gray-400 max-w-lg">
              {withheld
                ? "A platform operator can change this in Control Plane → Feature Flags."
                : "This is not something an executive can change. A platform operator should check Control Plane → Feature Flags."}
            </p>
          </div>
        </Card>
      </div>
    );
  }

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
