import { loadAiSkills } from "@/lib/ai/services";
import { aisGuard, Head, Tabs, Card, Stat, Pill, Bars, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// AIS-004 Skills & Plugin Framework — the registry of governed capabilities the copilot and agents may invoke.
/* eslint-disable @typescript-eslint/no-explicit-any */
const CAT_TONE: Record<string, string> = { internal: "blue", external: "amber", data: "teal", action: "violet", knowledge: "emerald" };

export default async function SkillsPage() {
  const { admin } = await aisGuard();
  const d = await loadAiSkills(admin) as any;
  const head = <Head code="AIS-004 · AI Services Platform" title="Skills & Plugin Framework" sub="The registry of governed capabilities the copilot and agents can discover and invoke — each call re-authorised, permission-checked and (for writes) confirmed." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="004" /><Provision /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="004" />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Total Skills" value={k.total} sub={`${k.active} active`} />
        <Stat label="Write Skills" value={k.write} sub="mutate state" tone={k.write ? "text-amber-600" : undefined} />
        <Stat label="Need Approval" value={k.needApproval} sub="human-in-loop" tone="text-violet-700" />
        <Stat label="External" value={k.external} sub="third-party" />
        <Stat label="Invocations" value={k.invocations.toLocaleString()} sub="all-time" />
        <Stat label="Categories" value={d.byCategory.length} sub="skill types" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Skill Registry" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">by invocations</span>}>
          <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="w-40">Skill</span><span className="flex-1">Description</span><span className="w-20">Category</span><span className="w-16 text-center">Scope</span><span className="w-16 text-center">Approval</span><span className="w-20 text-right">Calls</span></div>
            {d.skills.map((s: any) => (
              <div key={s.id} className="flex items-center px-1 py-1.5 text-[12px] border-b border-gray-50">
                <span className="w-40"><span className="text-gray-900 font-medium">{s.name}</span><br /><span className="text-[10px] text-gray-400 font-mono">{s.code}</span></span>
                <span className="flex-1 text-gray-500 text-[11px] truncate pr-2">{s.description}</span>
                <span className="w-20"><Pill text={s.category} tone={CAT_TONE[s.category]} /></span>
                <span className="w-16 text-center"><Pill text={s.scope} tone={s.scope === "write" ? "amber" : "slate"} /></span>
                <span className="w-16 text-center">{s.requires_approval ? <span className="text-violet-600 text-[11px]">✓</span> : <span className="text-gray-300">—</span>}</span>
                <span className="w-20 text-right text-gray-900 tabular-nums font-semibold">{Number(s.invocations).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Skills by Category">
          <Bars rows={d.byCategory.map((c: any) => ({ label: c.label, n: c.n }))} />
          <p className="text-[10px] text-gray-400 mt-3">internal = platform code · data = read queries · action = state changes · knowledge = RAG · external = third-party. Write + external skills require confirmation.</p>
        </Card>
      </div>

      <Foot>AIS-004 — the skills/plugin registry over ais_skills. Skill definitions, scopes, approval gates and invocation counts are real config; the runtime skill dispatcher (per-call re-authorisation, permission checks, confirmation loop, sandboxed execution) extends the AI gateway (backend epic).</Foot>
    </div>
  );
}
