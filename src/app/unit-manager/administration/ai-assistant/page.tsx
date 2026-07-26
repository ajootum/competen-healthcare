import { loadAdmAi } from "@/lib/admin/admin-modules";
import { admGuard, Head, Tabs, Card, Kpi, Ring, Pill, Provision, Foot } from "../_ui";
import AiCopilotPanel from "@/components/AiCopilotPanel";

export const dynamic = "force-dynamic";

// UMW-ADM-009 AI Administration Assistant — AI-powered administrative copilot: recommendations, automations,
// knowledge and predictive insights. Rule-based/seeded + explainable (not an opaque model). Gate admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const CAT_TONE: Record<string, string> = { governance: "rose", configuration: "violet", document: "blue", asset: "amber", optimization: "emerald", compliance: "teal" };

export default async function AiAssistantPage() {
  const { admin, isSuper, hid } = await admGuard();
  const d = await loadAdmAi(admin, hid, isSuper) as any;
  const head = <Head code="UMW-ADM-009 · Administration & Configuration" title="AI Administration Assistant" sub="Your intelligent partner for unit administration, configuration, optimization and governance — every recommendation explainable and auditable." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="009" /><Provision module="the AI Assistant" part="part 2" /></div>;

  const k = d.kpis;
  const chips = (((d.prompts as string[]) ?? []).slice(0, 4));
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="009" />
      <AiCopilotPanel endpoint="/api/administration/copilot" title="AI Administration Assistant — live copilot" sublabel="Grounded in your live documents, assets, changes, config & delegations · logged to the AI gateway" placeholder="Ask what needs attention across administration…" prompts={chips.length ? chips : ["Administration briefing", "What needs attention?", "Document & compliance risks", "Change approval backlog"]} />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-3.5 flex items-center gap-2"><Ring pct={k.avgConfidence} size={56} /><div><p className="text-[11px] text-gray-500 uppercase tracking-wide leading-tight">AI Confidence</p><p className="text-[11px] text-blue-600 font-medium">avg</p></div></div>
        <Kpi label="Recommendations" value={k.recommendations} sub={`${k.highImpact} high impact`} tone="text-blue-600" />
        <Kpi label="Acceptance Rate" value={`${k.acceptanceRate}%`} sub="accepted" />
        <Kpi label="Active Automations" value={k.activeAutomations} sub="running" tone="text-emerald-600" />
        <Kpi label="Automation Runs" value={k.totalRuns.toLocaleString()} sub="this month" />
        <Kpi label="High Impact" value={k.highImpact} sub="recommendations" tone={k.highImpact ? "text-rose-600" : undefined} />
        <Kpi label="AI Health" value={`${k.avgConfidence}%`} sub="composite" tone="text-blue-600" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Top AI Recommendations" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">explainable</span>}>
          {d.recommendations.length ? <div className="space-y-2">{d.recommendations.map((r: any, i: number) => (
            <div key={i} className="flex items-start gap-3 border border-gray-100 rounded-lg p-3">
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm ${r.impact === "high" ? "bg-rose-50" : r.impact === "medium" ? "bg-amber-50" : "bg-blue-50"}`}>{r.category === "governance" ? "🛡️" : r.category === "asset" ? "🖥️" : r.category === "document" ? "📄" : r.category === "configuration" ? "🔧" : r.category === "compliance" ? "✅" : "⚡"}</span>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5 flex-wrap"><p className="text-[13px] font-medium text-gray-900">{r.title}</p><Pill text={r.category} tone={CAT_TONE[r.category] ?? "slate"} /><Pill text={`${r.impact} impact`} tone={r.impact === "high" ? "rose" : r.impact === "medium" ? "amber" : "slate"} /></div><p className="text-[11px] text-gray-500 mt-0.5">{r.detail}</p></div>
              <span className="text-[11px] text-gray-400 shrink-0">{r.confidence}%</span>
            </div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No recommendations.</p>}
        </Card>

        <Card title="Automation Designer" right={<span className="text-[11px] text-gray-400">{k.activeAutomations} active</span>}>
          {d.automations.length ? <div className="space-y-2">{d.automations.map((a: any) => (
            <div key={a.id} className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" /><div className="min-w-0 flex-1"><p className="text-[12px] text-gray-800 leading-tight truncate">{a.name}</p><p className="text-[10px] text-gray-400">{a.automation_type} · {a.runs} runs</p></div><Pill text={a.status} tone={a.status === "active" ? "emerald" : "amber"} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No automations.</p>}
        </Card>
      </div>

      <Card title="Suggested Prompts" right={<span className="text-[11px] text-gray-400">natural-language administration</span>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {d.prompts.map((p: string, i: number) => (
            <div key={i} className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2"><span className="text-blue-500">✦</span><span className="text-[12px] text-gray-700">{p}</span></div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-2">These asks are now <strong>live</strong> — click any chip in the copilot above to run it against the real AI Runtime Gateway, grounded in this unit&apos;s administration data. Permission enforcement, human approval for privileged actions and mandatory explainability still apply; the copilot advises, it does not execute changes.</p>
      </Card>

      <Foot>UMW-ADM-009 — AI administration over adm_ai_recommendations + adm_automations, now with a <strong>live LLM copilot</strong> (top) wired to the real AI Runtime Gateway and grounded in the unit&apos;s documents, assets, changes, config, delegations &amp; capacity. Every copilot call logs to the AI Services Platform (AIS-011 Observability / AIS-008 Governance). The seeded recommendations (explainable, confidence + impact) and automations remain real from the stores; knowledge retrieval and the continuous-learning loop are the next phase. AI never bypasses permissions; privileged actions require approval.</Foot>
    </div>
  );
}
