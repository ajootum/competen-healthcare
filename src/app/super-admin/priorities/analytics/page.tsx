import { loadAnalytics } from "@/lib/priorities/modules";
import { ppeGuard, Head, ModuleNav, Card, Stat, Progress, Ring, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// PPE-006 Priority Analytics & Impact Dashboard — strategic alignment, objective achievement, KR attainment,
// initiative delivery and theme/scope comparison over the framework.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function AnalyticsPage() {
  const { admin } = await ppeGuard();
  const d = await loadAnalytics(admin) as any;
  const head = <Head code="PPE-006 · Priority & Execution Framework" title="Priority Analytics & Impact Dashboard" sub="Measure strategic performance end-to-end: alignment, objective achievement, KPI attainment, initiative delivery and where strategy is at risk." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<ModuleNav active="006" /><Provision module="Analytics" /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <ModuleNav active="006" />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Alignment Score" value={`${k.alignmentScore}%`} sub="strategy → execution" tone={k.alignmentScore >= 80 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} />
        <Stat label="Objective Achievement" value={`${k.objectiveAchievement}%`} sub="avg progress" />
        <Stat label="KPI Attainment" value={`${k.krAttainment}%`} sub="KRs on track" tone={k.krAttainment >= 70 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} />
        <Stat label="Initiative Delivery" value={`${k.initiativeDelivery}%`} sub="campaigns" />
        <Stat label="Mandatory Share" value={`${k.priorityCompletion}%`} sub="of priorities" />
        <Stat label="Live Objectives" value={k.objectives} sub={`${k.priorities} priorities`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Objective Progress by Theme" className="xl:col-span-2">
          {d.byTheme.length ? <div className="space-y-2.5">{d.byTheme.map((t: any) => (
            <div key={t.name}>
              <div className="flex items-center justify-between text-[12px] mb-1"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: t.color }} /><span className="text-gray-700">{t.name}</span><span className="text-gray-400 text-[10px]">({t.objectives} obj · {t.priorities} prio)</span></span><span className="font-semibold text-gray-900 tabular-nums">{t.progress}%</span></div>
              <Progress pct={t.progress} tone={t.progress >= 70 ? "bg-[var(--cmp-color-success)]" : t.progress >= 40 ? "bg-teal-500" : "bg-[var(--cmp-color-warning)]"} />
            </div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No theme data.</p>}
        </Card>

        <Card title="Strategic Alignment">
          <div className="flex justify-center mb-3"><Ring pct={k.alignmentScore} size={90} label="alignment score" /></div>
          <div className="space-y-2 text-[11px]">
            {[["Objectives linked to a theme", d.alignment.objLinked], ["Priorities linked to an objective", d.alignment.prioLinked], ["Objectives with key results", d.alignment.objWithKr]].map(([l, v]: any) => (
              <div key={l}><div className="flex items-center justify-between mb-0.5"><span className="text-gray-600">{l}</span><span className="font-semibold text-gray-900">{v}%</span></div><Progress pct={v} /></div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Scope Comparison">
          <div className="space-y-2 text-[12px]">{d.scopeCompare.map((s: any) => (
            <div key={s.scope}><div className="flex items-center justify-between mb-0.5"><span className="text-gray-600 capitalize">{s.scope} <span className="text-gray-400 text-[10px]">({s.n})</span></span><span className="font-semibold text-gray-900">{s.progress}%</span></div><Progress pct={s.progress} /></div>
          ))}</div>
        </Card>

        <Card title="Top Objectives">
          <div className="space-y-2 text-[12px]">{d.topProgress.map((o: any) => (
            <div key={o.title} className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: o.color }} /><span className="text-gray-700 flex-1 truncate">{o.title}</span><span className="font-semibold text-gray-900 tabular-nums">{o.progress}%</span></div>
          ))}</div>
        </Card>

        <Card title="At Risk" right={<span className="text-[11px] text-gray-400">&lt;40%</span>}>
          {d.atRisk.length ? <div className="space-y-2 text-[12px]">{d.atRisk.map((o: any) => (
            <div key={o.title} className="flex items-center gap-2 rounded-lg bg-[var(--cmp-surface-error)] border border-[var(--cmp-color-error)] px-2 py-1.5"><span className="text-rose-500">⚠</span><span className="text-gray-700 flex-1 truncate">{o.title}</span><span className="font-semibold text-[var(--cmp-text-error)] tabular-nums">{o.progress}%</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">Nothing at risk. ✅</p>}
        </Card>
      </div>

      <Foot>PPE-006 — analytics over the framework (objectives, key results, priorities, campaigns). Alignment score = mean of objective↔theme, priority↔objective and objective↔KR linkage. All figures are real rollups; time-series trend history needs a snapshot store (next-phase).</Foot>
    </div>
  );
}
