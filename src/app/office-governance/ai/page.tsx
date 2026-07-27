import { ogsGuard, Head, Stat, Card, Pill, Bars, Foot, T } from "../_ui";
import { loadOgsAi } from "@/lib/ogs/ai";
import AiCopilotPanel from "@/components/AiCopilotPanel";

export const dynamic = "force-dynamic";

// OGS-009 Office Lifecycle Intelligence & AI Governance Engine — live copilot + rule-based governance intelligence.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function OgsAiPage() {
  const { admin, isSuper, hid } = await ogsGuard();
  const d = await loadOgsAi(admin, hid, isSuper);
  const head = <Head code="OGS-009 · Office Governance System" title="Office Lifecycle Intelligence & AI Governance" sub="AI-powered insights, predictions and recommendations to optimise governance performance." />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Card><p className="text-sm text-gray-400">No governance offices provisioned yet.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}

      <AiCopilotPanel endpoint="/api/office-governance/copilot" title="Office Governance — live copilot" sublabel="Grounded in your live offices, appointments, delegations & decisions · advisory only · logged to the AI gateway" placeholder="Ask about office health, coverage gaps or governance actions…" prompts={["Governance briefing", "Which offices need attention?", "Expiring delegations?", "Top governance actions"]} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="🩺" tone={k.officeHealth != null && k.officeHealth >= 85 ? "emerald" : "amber"} label="Office health" value={k.officeHealth != null ? `${k.officeHealth}%` : "—"} sub="composite" />
        <Stat icon="⚠️" tone={k.predictedRisk ? "rose" : "emerald"} label="Governance risks" value={k.predictedRisk} sub="high priority" />
        <Stat icon="💡" tone="violet" label="AI recommendations" value={k.aiRecs} sub="actionable" />
        <Stat icon="⚖️" tone="blue" label="Decision throughput" value={k.decisionThroughput != null ? `${k.decisionThroughput}%` : "—"} />
        <Stat icon="⚙️" tone="teal" label="Active-office rate" value={k.activeRate != null ? `${k.activeRate}%` : "—"} />
        <Stat icon="✨" tone="indigo" label="AI interactions" value={k.aiCalls} sub="logged calls" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Governance risk intelligence" className="xl:col-span-2" right="rule-based · explainable">
          {d.risk.length ? <div className="space-y-2">{d.risk.map((r: any, i: number) => (
            <div key={i} className="flex items-start gap-2 border border-gray-100 rounded-lg p-2.5"><span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: T(r.tone).hex }} /><div className="min-w-0 flex-1"><p className="text-[12.5px] font-medium text-gray-800 leading-snug">{r.label}</p><p className="text-[11px] text-gray-500">{r.detail}</p></div><Pill text={r.level} tone={r.tone} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No governance risks detected. ✅</p>}
          <p className="text-[10px] text-gray-400 mt-2">Transparent rule-based signals from the live governance read-model — not a black-box model. For natural-language reasoning use the copilot above.</p>
        </Card>

        <Card title="AI recommendations">
          {d.recommendations.length ? <div className="space-y-2">{d.recommendations.map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-2 border border-gray-100 rounded-lg p-2.5"><span className="w-6 h-6 rounded-lg bg-indigo-50 flex items-center justify-center text-[13px] shrink-0">💡</span><p className="text-[12px] text-gray-800 flex-1">{r.title}</p><Pill text={r.impact} tone={r.tone} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No actions recommended. ✅</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Top governance strengths" className="xl:col-span-2">
          <Bars items={d.strengths.map((s: any) => ({ label: s.label, pct: s.pct, value: `${s.pct}%` }))} />
        </Card>

        <Card title="AI usage telemetry" right="plat_ai_requests">
          <div className="space-y-2 text-[12.5px]">
            <div className="flex justify-between"><span className="text-gray-500">Governance copilot calls</span><b className="tabular-nums">{d.aiUsage.govCalls}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Platform AI calls</span><b className="tabular-nums">{d.aiUsage.totalCalls}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Tokens processed</span><b className="tabular-nums">{d.aiUsage.tokens.toLocaleString()}</b></div>
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Every copilot call is metered to the AI Services Platform (AIS-011 / AIS-008) — real, auditable spend.</p>
        </Card>
      </div>

      <Foot>OGS-009 — the <strong>live copilot</strong> (top) is a real LLM grounded in the governance command-centre data via the AI Runtime Gateway, logged to <code>plat_ai_requests</code>; it is <strong>advisory only</strong> (never appoints, votes, certifies or dissolves). The risk-intelligence, recommendations and strengths are transparent <strong>rule-based</strong> signals over the live read-model — not black-box ML. Predictive office-health forecasting + a persisted governance-intelligence store are the next build phase.</Foot>
    </div>
  );
}
