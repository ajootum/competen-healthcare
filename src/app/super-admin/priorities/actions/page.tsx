import { requireHqCapability } from "@/lib/hq/context";
import { loadGoalToAction } from "@/lib/priorities/modules";
import { Head, ModuleNav, Card, Stat, Pill, Provision, Foot, STATUS_TONE } from "../_ui";

export const dynamic = "force-dynamic";

// PPE-003 Goal-to-Action Translation Engine — how objectives & priorities become executable work (tasks, learning,
// audits, notifications, dashboards), with objective → priority → action traceability.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPE_ICON: Record<string, string> = { task: "✅", learning: "🎓", audit: "🔍", competency: "🎯", notification: "📨", dashboard: "📊", report: "🧾" };

export default async function ActionsPage() {
  const { admin } = await requireHqCapability("hq.executive.priorities.view");
  const d = await loadGoalToAction(admin) as any;
  const head = <Head code="PPE-003 · Priority & Execution Framework" title="Goal-to-Action Translation Engine" sub="Compile approved objectives and priorities into executable work — tasks, learning, audits, notifications and dashboards — with full traceability from strategy to output." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<ModuleNav active="003" /><Provision module="the Translation Engine" /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <ModuleNav active="003" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
        <Stat label="Generated Actions" value={k.total} sub="from strategy" />
        <Stat label="In Progress" value={k.inProgress} sub="executing" tone="text-[var(--cmp-text-information)]" />
        <Stat label="Completed" value={k.completed} sub="delivered" tone="text-[var(--cmp-text-success)]" />
        <Stat label="Newly Generated" value={k.generated} sub="awaiting pickup" tone={k.generated ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Stat label="Completion Rate" value={`${k.completionRate}%`} sub="of generated" tone={k.completionRate >= 60 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Traceability — Strategy → Execution" className="xl:col-span-2" right={<span className="text-[11px] text-gray-500">objective → priority → action</span>}>
          {d.chains.length ? <div className="space-y-3">{d.chains.map((c: any, i: number) => (
            <div key={i} className="border border-gray-100 rounded-lg p-3">
              <p className="text-[13px] font-medium text-gray-900">🎯 {c.objective}</p>
              {c.priorities.length > 0 && <p className="text-[11px] text-gray-500 mt-0.5 ml-4">↳ priorities: {c.priorities.join(", ")}</p>}
              <div className="ml-4 mt-1.5 border-l-2 border-gray-100 pl-3 space-y-1">
                {c.actions.map((a: any, j: number) => (
                  <div key={j} className="flex items-center gap-2 text-[11px]"><span>{TYPE_ICON[a.type] ?? "•"}</span><span className="text-gray-700 flex-1 truncate">{a.title}</span><Pill text={a.status} tone={STATUS_TONE[a.status] ?? "slate"} /></div>
                ))}
              </div>
            </div>
          ))}</div> : <p className="text-sm text-gray-500 py-6 text-center">No traceability chains.</p>}
        </Card>

        <Card title="Actions by Type">
          {d.byType.length ? <div className="space-y-2 text-[12px]">{d.byType.map((t: any) => (
            <div key={t.type} className="flex items-center gap-2"><span>{TYPE_ICON[t.type] ?? "•"}</span><span className="text-gray-600 flex-1 capitalize">{t.type}</span><div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-teal-500" style={{ width: `${(t.n / k.total) * 100}%` }} /></div><span className="font-semibold text-gray-900 tabular-nums w-5 text-right">{t.n}</span></div>
          ))}</div> : <p className="text-sm text-gray-500 py-4 text-center">No actions.</p>}
        </Card>
      </div>

      <Card title="Generated Work" right={<span className="text-[11px] text-gray-500">{d.actions.length} actions</span>}>
        <div className="space-y-1.5">
          <div className="flex items-center text-[10px] text-gray-500 uppercase tracking-wide px-1"><span className="w-6" /><span className="flex-1">Action</span><span className="w-28">Source priority</span><span className="w-28">Target</span><span className="w-20 text-right">Status</span></div>
          {d.actions.map((a: any) => (
            <div key={a.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-2 py-1.5 text-[11px]">
              <span className="w-6 text-center">{TYPE_ICON[a.action_type] ?? "•"}</span>
              <span className="text-gray-800 flex-1 truncate">{a.title}</span>
              <span className="text-gray-500 w-28 truncate">{a.priorityTitle ?? "—"}</span>
              <span className="text-gray-500 w-28 truncate">{a.targetLabel}</span>
              <span className="w-20 text-right"><Pill text={a.status} tone={STATUS_TONE[a.status] ?? "slate"} /></span>
            </div>
          ))}
        </div>
      </Card>

      <Foot>PPE-003 — the execution bridge over ppe_actions (linked to their originating priority, objective and campaign). Traceability and generated work are real; automatic generation into the live op_tasks / learning / audit engines is the next integration phase — actions here are the strategic intents seeded per priority.</Foot>
    </div>
  );
}
