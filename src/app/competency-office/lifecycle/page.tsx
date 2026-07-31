import { loadCmoLifecycle } from "@/lib/competency/cmo-lifecycle";
import { cmoGuard, Head, Card, Kpi, Donut, Pill, Provision, Foot } from "../_cmo-ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

// CMO-004 Competency Lifecycle Engine — the complete lifecycle from creation to retirement.
/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUS_TONE: Record<string, string> = { draft: "slate", in_review: "amber", approved: "blue", scheduled: "violet", published: "emerald", rolled_back: "rose" };
const TONE: Record<string, string> = { amber: "#f59e0b", blue: "#3b82f6", rose: "#ef4444", violet: "#a855f7", emerald: "#22c55e", teal: "#14b8a6" };

export default async function LifecyclePage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadCmoLifecycle(admin, hid, isSuper);
  const head = <Head code="CMO-004 · Competency Office" title="Competency Lifecycle Engine" sub="Manage the complete lifecycle of competencies from creation through governance, assessment and retirement." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="the Lifecycle Engine" part="part 2" /></div>;
  const k = d.kpis;

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Total competencies" value={k.defined} sub={`${k.active} active`} />
        <Kpi label="In development" value={k.inDevelopment} sub="draft" tone="text-[var(--cmp-text-information)]" />
        <Kpi label="Assigned" value={k.assigned} sub="to people/groups" />
        <Kpi label="In progress" value={k.inProgress} sub="assessment" tone="text-[var(--cmp-text-warning)]" />
        <Kpi label="Competent" value={k.competent} sub="achieved" tone="text-[var(--cmp-text-success)]" />
        <Kpi label="Expiring soon" value={k.expiringSoon} sub="≤ 30 days" tone={k.expiringSoon ? "text-[var(--cmp-text-error)]" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Competency lifecycle" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">creation → retirement</span>}>
          <div className="flex items-center gap-0.5 overflow-x-auto pb-2">
            {d.stages.map((s: any, i: number) => (
              <div key={s.key} className="flex items-center gap-0.5 shrink-0">
                <div className={`flex flex-col items-center text-center w-[86px] ${s.key === d.currentStage ? "" : ""}`}>
                  <span className="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold tabular-nums" style={{ backgroundColor: s.tone + "22", color: s.tone, outline: s.key === d.currentStage ? `2px solid ${s.tone}` : "none", outlineOffset: 2 }}>{s.n}</span>
                  <span className="text-[10.5px] font-medium text-gray-700 mt-1.5 leading-tight">{s.label}</span>
                  <span className="text-[9px] text-gray-400 leading-tight">{s.sub}</span>
                </div>
                {i < d.stages.length - 1 && <span className="text-gray-300 text-xs">→</span>}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">Live counts across the lifecycle from <code>cmo_publications</code> (creation→publishing), <code>cmo_assignments</code> (assignment→assessment) and <code>competency_decisions</code> (competent→monitoring→improvement).</p>
        </Card>

        <Card title="Lifecycle at a glance">
          {d.glance.length ? <div className="flex items-center gap-3">
            <Donut segs={d.glance.map((s: any) => ({ n: s.n, color: s.color }))} total={d.glanceTotal} centre={d.glanceTotal} sub="in lifecycle" size={110} />
            <div className="flex-1 space-y-1 text-[11px]">{d.glance.slice(0, 6).map((s: any) => <div key={s.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-gray-600 flex-1 truncate">{s.label}</span><span className="font-semibold text-gray-900 tabular-nums">{s.n}</span></div>)}</div>
          </div> : <p className="text-sm text-gray-400 py-6 text-center">No lifecycle data yet.</p>}
          <div className="mt-3 pt-3 border-t border-gray-100 text-center"><p className="text-[10px] text-gray-400">Average time to competency</p><p className="text-lg font-bold text-gray-900">{d.avgTimeToCompetency != null ? `${d.avgTimeToCompetency} days` : "—"}</p>{d.avgTimeToCompetency == null && <p className="text-[9px] text-gray-400">needs assigned→competent timing</p>}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="My priority actions">
          {d.priorityActions.length ? <div className="space-y-1.5">{d.priorityActions.map((a: any, i: number) => (
            <Link key={i} href={a.href} className="flex items-center gap-2 text-[12px] border border-gray-100 rounded-lg px-3 py-2 hover:border-teal-300"><span className={`w-1.5 h-1.5 rounded-full shrink-0`} style={{ background: TONE[a.tone] }} /><span className="text-gray-700 flex-1">{a.label}</span><b className="tabular-nums text-gray-900">{a.n}</b></Link>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No priority actions. 🎉</p>}
        </Card>

        <Card title="Recent competencies">
          {d.recent.length ? <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Competency</span><span className="w-24">Stage</span><span className="w-20 text-right">Status</span></div>
            {d.recent.map((r: any, i: number) => (
              <div key={i} className="flex items-center px-1 py-1.5 text-[12px] border-b border-gray-50"><span className="flex-1 text-gray-800 truncate">{r.name}</span><span className="w-24 text-gray-500 text-[11px]">{r.stage}</span><span className="w-20 text-right"><Pill text={r.status} tone={STATUS_TONE[r.status] ?? "slate"} /></span></div>
            ))}
          </div> : <p className="text-sm text-gray-400 py-6 text-center">No recent competencies.</p>}
        </Card>

        <Card title="Competency gap overview" right={<Link href="/competency-office/gaps" className="text-[11px] text-teal-600 hover:underline">Gaps →</Link>}>
          {d.gaps.length ? <div className="space-y-2">{d.gaps.map((g: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[12px]"><span className="text-gray-700 flex-1 truncate">{g.competency}</span>{g.gap != null && <span className="text-gray-400 tabular-nums">gap {g.gap}</span>}{g.risk && <Pill text={g.risk} tone={/high|critical/i.test(String(g.risk)) ? "rose" : /med/i.test(String(g.risk)) ? "amber" : "emerald"} />}</div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No forecast gaps recorded.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Assessment progress">
          {d.assessmentProgress.length ? <div className="flex items-center gap-3">
            <Donut segs={d.assessmentProgress.map((s: any) => ({ n: s.n, color: s.color }))} total={d.assignTotal} centre={d.assignTotal} sub="assignments" size={110} />
            <div className="flex-1 space-y-1 text-[11px]">{d.assessmentProgress.map((s: any) => <div key={s.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-gray-600 flex-1">{s.label}</span><span className="font-semibold text-gray-900 tabular-nums">{s.n}</span></div>)}</div>
          </div> : <p className="text-sm text-gray-400 py-6 text-center">No assignment records yet.</p>}
        </Card>

        <Card title="AI lifecycle copilot" right={<span className="text-[11px] text-gray-400">rule-based · explainable</span>}>
          <div className="space-y-2">{d.copilot.map((c: any, i: number) => (
            <div key={i} className="flex items-start gap-2"><span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: TONE[c.tone] ?? "#14b8a6" }} /><div className="min-w-0"><p className="text-[12px] font-medium text-gray-800 leading-snug">{c.title}</p>{c.detail && <p className="text-[11px] text-gray-500">{c.detail}</p>}</div></div>
          ))}</div>
          <p className="text-[10px] text-gray-400 mt-2">AI recommends — humans approve. For grounded natural-language reasoning use the <Link href="/competency-office/ai-intelligence" className="text-teal-600 hover:underline">AI Intelligence copilot</Link>.</p>
        </Card>
      </div>

      <Foot>CMO-004 — the competency lifecycle over the real spine: <code>cmo_publications</code> (creation/governance/publishing), <code>cmo_assignments</code> (assignment/assessment), <code>competency_decisions</code> (competent/monitoring/improvement) and the <code>framework_competencies</code> catalogue. Stage counts, gap forecast, assessment progress and the rule-based copilot are live. Assigned→competent timing (average time-to-competency), no-code lifecycle-stage configuration and the reassessment write-engine are the next build phase.</Foot>
    </div>
  );
}
