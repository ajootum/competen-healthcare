import { loadAiOrchestrator } from "@/lib/priorities/modules";
import { ppeGuard, Head, ModuleNav, Card, Stat, Pill, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// PPE-007 AI Priority Orchestrator — rule-based intelligence over the framework: conflict detection, strategic
// drift, hygiene and capacity insights, each explainable back to the originating objective/priority.
/* eslint-disable @typescript-eslint/no-explicit-any */
const KIND_TONE: Record<string, string> = { Conflict: "amber", Drift: "rose", Hygiene: "blue", Alignment: "violet", Capacity: "amber", Governance: "blue" };

export default async function AiOrchestratorPage() {
  const { admin } = await ppeGuard();
  const d = await loadAiOrchestrator(admin) as any;
  const head = <Head code="PPE-007 · Priority & Execution Framework" title="AI Priority Orchestrator" sub="Continuously analyse the strategic model for conflicts, drift, hygiene and capacity risks — every recommendation is explainable back to the objective or priority that triggered it." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<ModuleNav active="007" /><Provision module="the AI Orchestrator" /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <ModuleNav active="007" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Recommendations" value={k.recommendations} sub="actionable" tone="text-teal-600" />
        <Stat label="Conflicts" value={k.conflicts} sub="competing priorities" tone={k.conflicts ? "text-amber-600" : undefined} />
        <Stat label="Drift Alerts" value={k.drift} sub="objectives at risk" tone={k.drift ? "text-rose-600" : undefined} />
        <Stat label="Hygiene / Alignment" value={k.hygiene} sub="model quality" tone={k.hygiene ? "text-blue-600" : undefined} />
      </div>

      <Card title="Orchestration Insights" right={<span className="text-[11px] text-gray-400">rule-based · explainable</span>}>
        {d.recs.length ? <div className="space-y-2">{d.recs.map((r: any, i: number) => (
          <div key={i} className="flex items-start gap-3 border border-gray-100 rounded-lg p-3">
            <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm ${r.tone === "rose" ? "bg-rose-50" : r.tone === "amber" ? "bg-amber-50" : r.tone === "violet" ? "bg-violet-50" : "bg-blue-50"}`}>{r.kind === "Conflict" ? "⚖️" : r.kind === "Drift" ? "📉" : r.kind === "Capacity" ? "🧮" : r.kind === "Governance" ? "🔀" : "🧹"}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap"><p className="text-[13px] font-medium text-gray-900">{r.title}</p><Pill text={r.kind} tone={KIND_TONE[r.kind] ?? "slate"} /></div>
              <p className="text-[11px] text-gray-600 mt-0.5">{r.detail}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">↳ basis: {r.source}</p>
            </div>
          </div>
        ))}</div> : <p className="text-sm text-gray-400 py-8 text-center">No orchestration insights — the strategic model is healthy. ✅</p>}
      </Card>

      <Foot>PPE-007 — intelligence over the framework. These are <strong>rule-based</strong> insights (conflict / drift / hygiene / capacity / governance), each traceable to the objective or priority that triggered it — deliberately explainable rather than an opaque model. Wiring an LLM copilot for natural-language strategy drafting &amp; summaries is the next phase; the acceptance-tracking loop needs a decisions store.</Foot>
    </div>
  );
}
