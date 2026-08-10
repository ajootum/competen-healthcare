import { requireHqCapability } from "@/lib/hq/context";
import { loadAiActions } from "@/lib/ai/services";
import { Head, Tabs, Card, Stat, Pill, Bars, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// AIS-005 Action & Workflow Orchestrator — the registry of governed actions AI can trigger (with approval + audit).
/* eslint-disable @typescript-eslint/no-explicit-any */
const TRIGGER_TONE: Record<string, string> = { recommendation: "violet", manual: "slate", scheduled: "blue", event: "amber" };

export default async function ActionsPage() {
  const { admin } = await requireHqCapability("hq.platform.ai.view");
  const d = await loadAiActions(admin) as any;
  const head = <Head code="AIS-005 · AI Services Platform" title="Action & Workflow Orchestrator" sub="Converts AI recommendations into governed, auditable actions — with confirmation, approval workflows and human-in-the-loop for every state change." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="005" /><Provision /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="005" />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Stat label="Actions" value={k.total} sub={`${k.active} active`} />
        <Stat label="Need Approval" value={k.needApproval} sub="human-in-loop" tone="text-violet-700" />
        <Stat label="Executions" value={k.executions.toLocaleString()} sub="all-time" />
        <Stat label="Avg Success" value={`${k.avgSuccess}%`} sub="completion" tone="text-[var(--cmp-text-success)]" />
        <Stat label="Triggers" value={d.byTrigger.length} sub="pathways" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Action Registry" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">by executions</span>}>
          <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Action</span><span className="w-24">Type</span><span className="w-28">Trigger</span><span className="w-16 text-center">Approval</span><span className="w-20 text-right">Executions</span><span className="w-16 text-right">Success</span></div>
            {d.actions.map((a: any) => (
              <div key={a.id} className="flex items-center px-1 py-1.5 text-[12px] border-b border-gray-50"><span className="flex-1 text-gray-800 truncate">{a.name}</span><span className="w-24 text-gray-500 text-[11px]">{a.action_type}</span><span className="w-28"><Pill text={a.trigger} tone={TRIGGER_TONE[a.trigger]} /></span><span className="w-16 text-center">{a.requires_approval ? <span className="text-violet-600 text-[11px]">✓</span> : <span className="text-gray-300">—</span>}</span><span className="w-20 text-right text-gray-900 tabular-nums font-semibold">{Number(a.executions).toLocaleString()}</span><span className="w-16 text-right text-[var(--cmp-text-success)] tabular-nums font-semibold">{Math.round(Number(a.success_rate || 0))}%</span></div>
            ))}
          </div>
        </Card>

        <Card title="By Trigger">
          <Bars rows={d.byTrigger.map((x: any) => ({ label: x.label, n: x.n }))} />
          <p className="text-[10px] text-gray-400 mt-3">recommendation = AI-proposed · event = reactive · scheduled = time-based · manual = admin. Write actions re-authorise and confirm before execution; all are audited.</p>
        </Card>
      </div>

      <Foot>AIS-005 — the action registry over ais_actions (trigger, approval gate, executions, success rate). Definitions and governance flags are real config; the orchestrator runtime (workflow execution, long-running operations, approval routing, outcome reporting) extends the platform workflow engine (backend epic).</Foot>
    </div>
  );
}
