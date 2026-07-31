import { loadStrategyManager } from "@/lib/priorities/strategy";
import { ppeGuard, Head, ModuleNav, Card, Stat, Pill, Progress, Ring, Provision, Foot, STATUS_TONE } from "./_ui";
import { NewObjectiveButton, ObjectiveControls } from "./StrategyAuthor";

export const dynamic = "force-dynamic";

// PPE-001 Organizational Objectives & Strategy Manager — the authoritative strategy workspace: themes, objectives/
// OKRs, key results, the cascade/alignment tree and a governance snapshot. Super-admin gated (layout enforces).
/* eslint-disable @typescript-eslint/no-explicit-any */
const KR_TONE: Record<string, string> = { on_track: "bg-[var(--cmp-color-success)]", at_risk: "bg-[var(--cmp-color-warning)]", off_track: "bg-[var(--cmp-color-error)]", achieved: "bg-teal-500" };

export default async function StrategyManagerPage() {
  const { admin } = await ppeGuard();
  const d = await loadStrategyManager(admin) as any;

  const head = <Head code="PPE-001 · Priority & Execution Framework" title="Organizational Objectives & Strategy Manager" sub="Define strategic themes, objectives and OKRs, cascade them through the hierarchy, and govern publishing — the authoritative source that feeds the platform priority cascade." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<ModuleNav active="001" /><Provision module="the Strategy Manager" /></div>;

  const k = d.kpis;
  const themes = (d.themeCards ?? []).map((t: any) => ({ id: t.id, name: t.name }));
  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <ModuleNav active="001" />
      <div className="flex justify-end"><NewObjectiveButton themes={themes} /></div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Stat label="Strategic Themes" value={k.themes} sub="active pillars" />
        <Stat label="Objectives" value={k.objectives} sub={`${k.published} published`} />
        <Stat label="Avg Progress" value={`${k.avgProgress}%`} sub="published objectives" tone={k.avgProgress >= 70 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} />
        <Stat label="Key Results" value={k.keyResults} sub="measurable" />
        <Stat label="Published Priorities" value={k.priorities} sub="in cascade" tone="text-teal-600" />
        <Stat label="Active Campaigns" value={k.campaigns} sub="initiatives" />
        <Stat label="Draft / Pending" value={`${k.draft}/${k.pending}`} sub="not yet live" tone={k.pending ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Stat label="Pending Approvals" value={k.pendingApprovals} sub="awaiting sign-off" tone={k.pendingApprovals ? "text-[var(--cmp-text-warning)]" : undefined} />
      </div>

      {/* Strategic themes */}
      <Card title="Strategic Themes" right={<span className="text-[11px] text-gray-400">platform pillars</span>}>
        {d.themeCards.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
            {d.themeCards.map((t: any) => (
              <div key={t.id} className="border border-gray-200 rounded-lg p-3" style={{ borderTopColor: t.color, borderTopWidth: 3 }}>
                <div className="flex items-center gap-1.5"><span className="text-base">{t.icon}</span><p className="text-sm font-semibold text-gray-900 leading-tight">{t.name}</p></div>
                <p className="text-[11px] text-gray-500 mt-1 line-clamp-2 min-h-[28px]">{t.description}</p>
                <div className="flex items-center justify-between text-[11px] text-gray-500 mt-2"><span>{t.objectives} objectives</span><span className="font-semibold text-gray-700">{t.progress}%</span></div>
                <Progress pct={t.progress} />
                <div className="flex gap-2 mt-2 text-[10px] text-gray-400"><span>{t.priorities} priorities</span><span>·</span><span>{t.campaigns} campaigns</span></div>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-gray-400 py-6 text-center">No strategic themes yet.</p>}
      </Card>

      {/* Objectives register + KR rollup */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Objectives & OKRs" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">{d.objectives.length} objectives</span>}>
          <div className="space-y-2">
            {d.objectives.slice(0, 10).map((o: any) => (
              <div key={o.id} className="border border-gray-100 rounded-lg p-3 hover:border-gray-200">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: o.themeColor }} />
                      <p className="text-[13px] font-medium text-gray-900 leading-tight">{o.title}</p>
                      <Pill text={o.framework} tone="violet" />
                      <Pill text={o.status} tone={STATUS_TONE[o.status]} />
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5">{o.scopeLabel} · {o.ownerName}{o.parentTitle ? ` · ↳ from “${o.parentTitle.slice(0, 40)}”` : ""}</p>
                  </div>
                  <div className="text-right shrink-0"><p className="text-sm font-bold text-gray-900 tabular-nums">{Math.round(Number(o.progress_pct))}%</p></div>
                </div>
                <div className="mt-2"><Progress pct={Number(o.progress_pct)} /></div>
                {o.krs.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {o.krs.map((kr: any) => (
                      <span key={kr.id} className="inline-flex items-center gap-1 text-[10px] text-gray-600 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${KR_TONE[kr.status] ?? "bg-gray-400"}`} />{kr.title}: <span className="font-semibold tabular-nums">{kr.current ?? "—"}{kr.unit === "%" ? "%" : ""}/{kr.target ?? "—"}</span>
                      </span>
                    ))}
                  </div>
                )}
                <ObjectiveControls objective={{ id: o.id, status: o.status, title: o.title }} />
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Key Result Health">
            <div className="flex items-center gap-3">
              <Ring pct={d.krStatus.on_track + d.krStatus.achieved ? Math.round(((d.krStatus.on_track + d.krStatus.achieved) / Math.max(1, d.krStatus.on_track + d.krStatus.at_risk + d.krStatus.off_track + d.krStatus.achieved)) * 100) : 0} label="on track" />
              <div className="space-y-1 text-[11px] flex-1">
                {[["On Track", d.krStatus.on_track, "bg-[var(--cmp-color-success)]"], ["At Risk", d.krStatus.at_risk, "bg-[var(--cmp-color-warning)]"], ["Off Track", d.krStatus.off_track, "bg-[var(--cmp-color-error)]"], ["Achieved", d.krStatus.achieved, "bg-teal-500"]].map(([l, n, c]: any) => (
                  <div key={l} className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${c}`} /><span className="text-gray-600 flex-1">{l}</span><span className="font-semibold text-gray-900">{n}</span></div>
                ))}
              </div>
            </div>
          </Card>
          <Card title="Framework Mix">
            <div className="space-y-2 text-[12px]">
              {[["OKR", d.frameworkMix.okr, "bg-violet-500"], ["Balanced Scorecard", d.frameworkMix.bsc, "bg-[var(--cmp-color-information)]"], ["Custom", d.frameworkMix.custom, "bg-gray-400"]].map(([l, n, c]: any) => (
                <div key={l} className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${c}`} /><span className="text-gray-600 flex-1">{l}</span><span className="font-semibold text-gray-900 tabular-nums">{n}</span></div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Cascade + governance */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Cascade & Alignment" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">strategy → local delivery</span>}>
          {d.cascade.length ? (
            <div className="space-y-3">
              {d.cascade.map((r: any) => (
                <div key={r.id}>
                  <div className="flex items-center gap-1.5"><Pill text={r.scope_type} tone="teal" /><p className="text-[13px] font-medium text-gray-900">{r.title}</p><span className="text-[11px] text-gray-400 tabular-nums ml-auto">{Math.round(Number(r.progress_pct))}%</span></div>
                  {r.children.length > 0 && (
                    <div className="ml-4 mt-1.5 border-l-2 border-gray-100 pl-3 space-y-1.5">
                      {r.children.map((c: any) => (
                        <div key={c.id} className="flex items-center gap-1.5"><span className="text-gray-300">↳</span><Pill text={c.scope_type} tone="blue" /><p className="text-[12px] text-gray-700">{c.title}</p><span className="text-[11px] text-gray-400 tabular-nums ml-auto">{Math.round(Number(c.progress_pct))}%</span></div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {d.orphans.length > 0 && <p className="text-[11px] text-gray-400 pt-1 border-t border-gray-100">+ {d.orphans.length} local objective(s) not yet linked to a platform parent.</p>}
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No cascade defined.</p>}
        </Card>

        <Card title="Review & Governance" right={<span className="text-[11px] text-gray-400">{d.pendingApprovals.length} pending</span>}>
          {d.pendingApprovals.length ? (
            <div className="space-y-2 mb-3">
              {d.pendingApprovals.map((a: any) => (
                <div key={a.id} className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[12px] text-gray-800 leading-tight truncate">{a.entity_title}</p><p className="text-[10px] text-gray-400 capitalize">{a.entity_type} · step {a.step}/{a.total_steps}</p></div><Pill text={a.state} tone={STATUS_TONE[a.state]} /></div>
              ))}
            </div>
          ) : <p className="text-[12px] text-gray-400 mb-3">No pending approvals.</p>}
          <p className="text-[11px] font-semibold text-gray-500 mb-1.5 border-t border-gray-100 pt-2">Recent activity</p>
          <div className="space-y-1.5">
            {d.recentAudit.slice(0, 5).map((a: any) => (
              <div key={a.id} className="flex items-start gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-teal-400 mt-1.5 shrink-0" /><p className="text-[11px] text-gray-500 leading-tight">{a.detail}</p></div>
            ))}
          </div>
        </Card>
      </div>

      <Foot>PPE-001 — the strategy layer over the priority framework (ppe_strategic_themes / ppe_objectives / ppe_key_results / ppe_priorities / ppe_campaigns / ppe_approvals / ppe_audit). All data is real from the framework stores; objectives cascade via parent_id and feed the resolution engine (see PPE-002 Distribution). Objective authoring is now live — create + the draft→pending→published→archived lifecycle (submit-for-approval materialises a governance request); priority / theme / campaign authoring and multi-step workflows are the next phase.</Foot>
    </div>
  );
}
