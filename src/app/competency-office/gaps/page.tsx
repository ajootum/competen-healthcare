import { fetchCmoSuite, pct } from "@/lib/competency/cmo-suite";
import { cmoGuard, Head, Card, Kpi, Bars, Pill, Provision, Foot } from "../_cmo-ui";

export const dynamic = "force-dynamic";

// CMO-008 Competency Gap Management — identify, prioritise, track and close competency gaps. Derives active gaps from
// incomplete/overdue assignments + non-passing decisions + AI gap intelligence.
/* eslint-disable @typescript-eslint/no-explicit-any */
const passing = (o: any) => /competent|pass|achiev|met|proficient/i.test(String(o));

export default async function GapsPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await fetchCmoSuite(admin, hid, isSuper);
  const head = <Head code="CMO-008 · Competency Office" title="Competency Gap Management" sub="Identify, prioritise, track and close competency gaps across individuals, teams, units and the enterprise." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="Gap Management" /></div>;

  const openAsg = d.assignments.filter((a: any) => ["assigned", "in_progress", "overdue"].includes(a.status));
  const overdue = d.assignments.filter((a: any) => a.status === "overdue");
  const gapRecs = d.aiRecs.filter((r: any) => ["gap", "risk"].includes(r.category));
  const decGap = d.decisions.filter((x: any) => x.outcome && !passing(x.outcome)).length;
  const decTotal = d.decisions.length;
  // Active gaps by competency (from open assignments).
  const byComp = Object.entries(openAsg.reduce((acc: Record<string, number>, a: any) => { acc[a.competency] = (acc[a.competency] ?? 0) + 1; return acc; }, {})).map(([label, n]) => ({ label, n: n as number })).sort((a, b) => b.n - a.n).slice(0, 8);
  const closureRate = d.assignments.length ? pct(d.assignments.filter((a: any) => a.status === "completed").length, d.assignments.length) : 0;

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Open Gaps" value={openAsg.length} sub="assignments open" tone={openAsg.length ? "text-amber-600" : undefined} />
        <Kpi label="Critical / Overdue" value={overdue.length} sub="past due" tone={overdue.length ? "text-rose-600" : undefined} />
        <Kpi label="Non-Passing Decisions" value={decGap} sub={decTotal ? `of ${decTotal}` : "assessment gaps"} tone={decGap ? "text-rose-600" : undefined} />
        <Kpi label="AI Gap Insights" value={gapRecs.length} sub="flagged" tone="text-teal-600" />
        <Kpi label="Closure Rate" value={`${closureRate}%`} sub="assignments" tone={closureRate >= 70 ? "text-emerald-600" : "text-amber-600"} />
        <Kpi label="Competencies Affected" value={byComp.length} sub="with open gaps" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Top Gap Competencies" className="xl:col-span-1" right={<span className="text-[11px] text-gray-400">open assignments</span>}>
          {byComp.length ? <Bars rows={byComp} colors={byComp.map(() => "#f43f5e")} /> : <p className="text-sm text-gray-400 py-4 text-center">No open competency gaps. ✅</p>}
        </Card>

        <Card title="AI Gap Intelligence" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">{gapRecs.length}</span>}>
          {gapRecs.length ? <div className="space-y-2">{gapRecs.map((r: any) => (
            <div key={r.id} className="flex items-start gap-2 border border-gray-100 rounded-lg p-2.5"><span className="text-rose-500 mt-0.5">{r.impact === "high" ? "🔴" : r.impact === "medium" ? "🟠" : "🔵"}</span><div className="min-w-0 flex-1"><p className="text-[12px] font-medium text-gray-900">{r.title}</p><p className="text-[11px] text-gray-500">{r.detail}</p></div><Pill text={`${r.confidence}%`} tone="rose" /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No AI gap insights.</p>}
        </Card>
      </div>

      <Card title="Gap Closure — Overdue Assignments" right={<span className="text-[11px] text-gray-400">{overdue.length} to close</span>}>
        {overdue.length ? <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">{overdue.slice(0, 9).map((a: any) => (
          <div key={a.id} className="border border-rose-100 bg-rose-50/40 rounded-lg p-2.5"><p className="text-[12px] font-medium text-gray-900 truncate">{a.competency}</p><p className="text-[11px] text-gray-500">{a.target_label} · overdue</p></div>
        ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No overdue gap-closure actions. ✅</p>}
      </Card>

      <Foot>CMO-008 — gap management derived from cmo_assignments (open/overdue = active gaps), competency_decisions (non-passing outcomes) and AI gap intelligence. The gap-prioritisation engine, root-cause analysis and closure-plan tracking build on this signal (next phase).</Foot>
    </div>
  );
}
