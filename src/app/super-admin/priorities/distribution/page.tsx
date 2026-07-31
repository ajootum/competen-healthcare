import { loadDistribution } from "@/lib/priorities/distribution";
import { ppeGuard, Head, ModuleNav, Card, Stat, Pill, Provision, Foot, URGENCY_TONE, PILL } from "../_ui";

export const dynamic = "force-dynamic";

// PPE-002 Priority Distribution & Inheritance Engine — the runtime cascade: priorities by scope level, inheritance /
// urgency breakdowns, and the effective resolved priority set for a representative context (engine resolver).
/* eslint-disable @typescript-eslint/no-explicit-any */
const MODE_TONE: Record<string, string> = { cascade: "teal", reference: "blue", local: "violet", block: "rose" };

export default async function DistributionPage() {
  const { admin } = await ppeGuard();
  const d = await loadDistribution(admin) as any;

  const head = <Head code="PPE-002 · Priority & Execution Framework" title="Priority Distribution & Inheritance Engine" sub="Publish and cascade approved priorities down the hierarchy, resolve inheritance and overrides, and compile the effective, ranked priority set every workspace runs on." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<ModuleNav active="002" /><Provision module="the Distribution Engine" /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <ModuleNav active="002" />

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Stat label="Total Priorities" value={k.total} sub={`${k.drafts} draft`} />
        <Stat label="Published" value={k.published} sub="in cascade" tone="text-teal-600" />
        <Stat label="Mandatory" value={k.mandatory} sub="must-acknowledge" tone={k.mandatory ? "text-[var(--cmp-text-error)]" : undefined} />
        <Stat label="Scope Levels" value={k.levels} sub="cascade depth" />
        <Stat label="Effective Set" value={k.effective} sub="resolved for context" tone="text-teal-600" />
        <Stat label="Suppressed" value={k.suppressed} sub="by local block" tone={k.suppressed ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Stat label="Avg Weight" value={k.avgWeight} sub="effective" />
        <Stat label="Pending Approval" value={k.pending} sub="priorities" tone={k.pending ? "text-[var(--cmp-text-warning)]" : undefined} />
      </div>

      {/* Cascade columns + effective set */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Cascade by Scope" right={<span className="text-[11px] text-gray-400">broad → specific</span>}>
          <div className="space-y-3">
            {d.byScope.map((col: any) => (
              <div key={col.level}>
                <div className="flex items-center gap-1.5 mb-1"><Pill text={col.label} tone="teal" /><span className="text-[11px] text-gray-400">{col.items.length}</span></div>
                <div className="space-y-1">
                  {col.items.map((p: any) => (
                    <div key={p.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-2 py-1.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.themeColor }} />
                      <span className="text-[12px] text-gray-800 flex-1 truncate">{p.title}</span>
                      {p.mandatory && <span className="text-rose-500 text-[10px]" title="mandatory">★</span>}
                      <Pill text={p.urgency} tone={URGENCY_TONE[p.urgency]} />
                      <span className={`text-[9px] font-semibold rounded px-1 py-0.5 ${PILL[MODE_TONE[p.inheritance_mode]]}`}>{p.inheritance_mode}</span>
                      <span className="text-[11px] font-bold text-gray-700 tabular-nums w-8 text-right">{p.weight}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Effective Priority Set" right={<span className="text-[11px] text-gray-400">{d.ctxLabel}</span>}>
          <p className="text-[11px] text-gray-500 mb-2">Resolved &amp; ranked for this context — what the workspace runtime actually presents. Weight = base × urgency × mandatory boost.</p>
          <div className="space-y-1.5">
            {d.effective.map((p: any) => (
              <div key={p.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-2.5 py-2">
                <span className="w-6 h-6 rounded-full bg-teal-50 text-teal-700 text-[11px] font-bold flex items-center justify-center shrink-0">{p.rank}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.themeColor }} /><p className="text-[12px] font-medium text-gray-900 truncate">{p.title}</p>{p.mandatory && <span className="text-rose-500 text-[10px]">★</span>}</div>
                  <p className="text-[10px] text-gray-400">from {p.sourceScope} · {p.themeName ?? "—"}</p>
                </div>
                <Pill text={p.urgency} tone={URGENCY_TONE[p.urgency]} />
                <span className="text-sm font-bold text-gray-800 tabular-nums w-9 text-right">{p.weight}</span>
              </div>
            ))}
          </div>
          {d.suppressed.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Suppressed by local override ({d.suppressed.length})</p>
              {d.suppressed.map((p: any) => <div key={p.id} className="flex items-center gap-1.5 text-[11px] text-gray-400"><span className="line-through truncate">{p.title}</span><span className="text-gray-300">·</span><span>{p.sourceScope}</span></div>)}
            </div>
          )}
        </Card>
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Inheritance Modes">
          <div className="space-y-2 text-[12px]">
            {d.byInheritance.map((m: any) => (
              <div key={m.mode} className="flex items-center gap-2"><span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${PILL[MODE_TONE[m.mode]]}`}>{m.mode}</span><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-teal-500" style={{ width: `${(m.n / k.published) * 100}%` }} /></div><span className="font-semibold text-gray-900 tabular-nums w-6 text-right">{m.n}</span></div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">cascade = flows down · reference = visible not enforced · local = context-only · block = suppresses broader priorities of the same theme.</p>
        </Card>
        <Card title="Urgency Distribution">
          <div className="space-y-2 text-[12px]">
            {d.byUrgency.map((u: any) => (
              <div key={u.urgency} className="flex items-center gap-2"><Pill text={u.urgency} tone={URGENCY_TONE[u.urgency]} /><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${u.urgency === "critical" ? "bg-[var(--cmp-color-error)]" : u.urgency === "high" ? "bg-[var(--cmp-color-warning)]" : u.urgency === "medium" ? "bg-[var(--cmp-color-information)]" : "bg-gray-400"}`} style={{ width: `${(u.n / k.published) * 100}%` }} /></div><span className="font-semibold text-gray-900 tabular-nums w-6 text-right">{u.n}</span></div>
            ))}
          </div>
        </Card>
      </div>

      <Foot>PPE-002 — the cascade runtime over ppe_priorities. The effective set is compiled live by the resolution engine (resolveEffectivePriorities): published + in-validity + in-scope candidates, local &lsquo;block&rsquo; suppression, ranked by effective weight with full lineage. Publish/distribution write actions are the next build phase — this is the authoritative resolution read model.</Foot>
    </div>
  );
}
