import { requireHqContext } from "@/lib/hq/context";
import { loadAiAgents } from "@/lib/ai/services";
import { Head, Tabs, Card, Stat, Pill, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// AIS-012 Agent Framework — the registry of specialist AI agents (model + skills + autonomy) operating across workspaces.
/* eslint-disable @typescript-eslint/no-explicit-any */
const AUTO_TONE: Record<string, string> = { assist: "blue", suggest: "amber", act: "violet" };

export default async function AgentsPage() {
  const { admin } = await requireHqContext("hq.platform.ai.view");
  const d = await loadAiAgents(admin) as any;
  const head = <Head code="AIS-012 · AI Services Platform" title="Agent Framework" sub="The registry of specialist AI agents — each with a model, a governed skill set and an autonomy level — orchestrated across every workspace with human-in-the-loop." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="012" /><Provision /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="012" />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Agents" value={k.total} sub={`${k.active} active`} />
        <Stat label="Autonomy: Act" value={k.act} sub="can execute" tone={k.act ? "text-violet-700" : undefined} />
        <Stat label="Total Runs" value={k.runs.toLocaleString()} sub="all-time" />
        <Stat label="Workspaces" value={k.workspaces} sub="covered" />
        <Stat label="Avg Skills" value={k.avgSkills} sub="per agent" />
        <Stat label="Skill-bound" value={k.total} sub="governed tools" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Agent Registry" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">by runs</span>}>
          <div className="space-y-2">
            {d.agents.map((a: any) => (
              <div key={a.id} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="flex items-center gap-1.5 flex-wrap"><p className="text-[13px] font-medium text-gray-900">{a.name}</p><Pill text={a.autonomy} tone={AUTO_TONE[a.autonomy]} /><Pill text={a.workspace} tone="slate" /></div><p className="text-[11px] text-gray-500 mt-0.5">{a.description}</p></div>
                  <div className="text-right shrink-0"><p className="text-sm font-bold text-gray-900 tabular-nums">{Number(a.runs).toLocaleString()}</p><p className="text-[10px] text-gray-400">runs</p></div>
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap"><span className="text-[10px] text-gray-400 font-mono">{a.model_id}</span><span className="text-gray-300">·</span>{(a.skills ?? []).map((s: string) => <span key={s} className="text-[9px] bg-gray-50 border border-gray-100 rounded px-1 py-0.5 text-gray-500 font-mono">{s}</span>)}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Autonomy Distribution">
          <div className="space-y-2.5">
            {d.byAutonomy.map((a: any) => (
              <div key={a.label}><div className="flex items-center justify-between text-[12px] mb-0.5"><span className="text-gray-700 capitalize">{a.label}</span><span className="font-semibold text-gray-900">{a.n}</span></div><div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${a.label === "act" ? "bg-violet-500" : a.label === "suggest" ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-information)]"}`} style={{ width: `${(a.n / k.total) * 100}%` }} /></div></div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">assist = answers only · suggest = proposes actions for approval · act = executes governed skills (with confirmation for high-impact). No agent bypasses permissions.</p>
        </Card>
      </div>

      <Foot>AIS-012 — the agent registry over ais_agents (model + skills + autonomy + workspace). Definitions, skill bindings and run counts are real config; the multi-agent execution runtime (lifecycle, orchestration, memory, tool loops, human-in-the-loop) extends src/lib/ai/* (backend epic).</Foot>
    </div>
  );
}
