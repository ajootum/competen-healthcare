import { requireHqContext } from "@/lib/hq/context";
import { loadPersonalisation } from "@/lib/priorities/modules";
import { Head, ModuleNav, Card, Stat, Pill, Provision, Foot, URGENCY_TONE } from "../_ui";

export const dynamic = "force-dynamic";

// PPE-004 Personalisation & Context Resolution Engine — how the resolved priority set adapts per workspace/role, the
// context sources that shape it, and the effective set each workspace runs on.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function PersonalisationPage() {
  const { admin } = await requireHqContext("hq.executive.priorities.view");
  const d = await loadPersonalisation(admin) as any;
  const head = <Head code="PPE-004 · Priority & Execution Framework" title="Personalisation & Context Resolution Engine" sub="Resolve the effective priority set into each workspace and role — every dashboard, task list and AI recommendation adapts to the priorities that matter in that context." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<ModuleNav active="004" /><Provision module="Personalisation" /></div>;

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <ModuleNav active="004" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Effective Priorities" value={d.effectiveCount} sub="resolved" tone="text-teal-600" />
        <Stat label="Workspace Profiles" value={d.workspaces.length} sub="context views" />
        <Stat label="Context Sources" value={d.contextSources.length} sub="signals" />
        <Stat label="Mandatory Pinned" value={d.topEffective.filter((p: any) => p.mandatory).length} sub="always top" tone="text-[var(--cmp-text-error)]" />
      </div>

      <Card title="Workspace Behaviour" right={<span className="text-[11px] text-gray-400">resolved priorities per context</span>}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {d.workspaces.map((w: any) => (
            <div key={w.workspace} className="border border-gray-200 rounded-lg p-3">
              <p className="text-[13px] font-semibold text-gray-900">{w.workspace}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">{w.behaviour}</p>
              <div className="mt-2 space-y-1">
                {w.top.map((p: any, i: number) => (
                  <div key={i} className="flex items-center gap-1.5 text-[11px]"><span className="w-4 h-4 rounded-full bg-teal-50 text-teal-700 text-[9px] font-bold flex items-center justify-center shrink-0">{i + 1}</span><span className="text-gray-700 flex-1 truncate">{p.title}</span>{p.mandatory && <span className="text-rose-500 text-[9px]">★</span>}<Pill text={p.urgency} tone={URGENCY_TONE[p.urgency]} /></div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Context Sources">
          <div className="space-y-2">{d.contextSources.map((s: any, i: number) => (
            <div key={i} className="flex items-start gap-2"><span className="w-5 h-5 rounded bg-teal-50 text-teal-700 text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span><div><p className="text-[12px] font-medium text-gray-800">{s.source}</p><p className="text-[11px] text-gray-500">{s.detail}</p></div></div>
          ))}</div>
        </Card>

        <Card title="Base Effective Set" right={<span className="text-[11px] text-gray-400">before workspace tuning</span>}>
          <div className="space-y-1.5">{d.topEffective.map((p: any) => (
            <div key={p.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-2.5 py-1.5"><span className="w-6 h-6 rounded-full bg-teal-50 text-teal-700 text-[11px] font-bold flex items-center justify-center shrink-0">{p.rank}</span><span className="text-[12px] text-gray-800 flex-1 truncate">{p.title}</span>{p.mandatory && <span className="text-rose-500 text-[10px]">★</span>}<Pill text={p.urgency} tone={URGENCY_TONE[p.urgency]} /><span className="text-sm font-bold text-gray-700 tabular-nums w-8 text-right">{p.weight}</span></div>
          ))}</div>
        </Card>
      </div>

      <Foot>PPE-004 — context resolution over the engine resolver. The base effective set is real (resolveEffectivePriorities); per-workspace views apply a category→workspace affinity over that set to show how each context reorders. Live per-user signals (assignments, competency gaps, operational state) and audience selectors are the deeper integration phase — mandatory priorities always stay pinned regardless of preferences.</Foot>
    </div>
  );
}
