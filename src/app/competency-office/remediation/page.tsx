import { cmoGuard, Head, Card, Kpi, Pill, Donut, Bars, Foot } from "../_cmo-ui";
import { loadRemediationCentre } from "@/lib/competency/remediation-centre";
import Link from "next/link";

export const dynamic = "force-dynamic";

// COMP-021 Competency Remediation & Development Pathway — a Remediation Command Centre consolidating the real
// gap signals (competency_decisions in a non-passing/expired outcome) against the remediation in flight
// (interventions — the governed plan object) and the coaching backing it. Read model over existing stores —
// NO migration, no fabricated data. Gap↔plan coverage is an honest heuristic (flagged in the Foot).
/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUS_TONE: Record<string, string> = { planned: "slate", in_progress: "blue", review: "amber", completed: "emerald", closed: "teal" };
const OUTCOME_TONE: Record<string, string> = { successful: "emerald", partially_successful: "amber", unsuccessful: "rose" };
const PATH_HEX = ["#f43f5e", "#f59e0b", "#94a3b8", "#3b82f6", "#6366f1", "#8b5cf6", "#10b981", "#14b8a6", "#0ea5e9"];
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—");

export default async function RemediationPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadRemediationCentre(admin, hid, isSuper);
  const head = <Head code="COMP-021 · Competency Office" title="Competency Remediation & Development Pathway" sub="A Remediation Command Centre — every open competency gap signal set against the remediation in flight, the reassessments due, and the pathway from detection to a restored competency record." />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Card><p className="text-sm text-gray-400">The remediation store (<code>interventions</code>) is not provisioned yet — apply migration 036 (learner support) to enable the remediation command centre.</p></Card></div>;
  const k = d.kpis;
  const totalIv = d.statusDonut.reduce((a: number, s: any) => a + s.n, 0);

  return (
    <div className="space-y-4">
      {head}
      {d.empty && <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-[12px] text-blue-800">No gap signals or remediation plans captured yet — as competency decisions flag gaps and educators open interventions, this centre tracks the pathway from detection to a restored competency record.</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Open gap signals" value={k.openGaps} sub="requires-remediation / not-yet / expired" tone={k.openGaps ? "text-rose-600" : "text-gray-900"} />
        <Kpi label="Active remediation" value={k.activeRemediation} sub="plans in flight" tone="text-teal-600" />
        <Kpi label="Unaddressed (est.)" value={k.unaddressed} sub="gaps beyond active plans" tone={k.unaddressed ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Reassessment due" value={k.reassessDue} sub={k.overdueReassess ? `${k.overdueReassess} overdue` : "next 14 days"} tone={k.overdueReassess ? "text-rose-600" : k.reassessDue ? "text-amber-600" : "text-gray-900"} />
        <Kpi label="Success rate" value={k.successRate === null ? "—" : `${k.successRate}%`} sub={`${k.successful}/${k.completedTotal} completed`} tone={k.successRate === null ? "text-gray-900" : k.successRate >= 70 ? "text-emerald-600" : "text-amber-600"} />
        <Kpi label="Avg days open" value={k.avgDaysOpen} sub="active plans" tone={k.avgDaysOpen > 60 ? "text-amber-600" : "text-gray-900"} />
      </div>

      {/* The 9-step remediation & development pathway */}
      <Card title="Remediation & development pathway" right={<span className="text-[11px] text-gray-400">detect → analyse → plan → assign → practise → reassess → close → update → monitor</span>}>
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {d.pathway.map((s: any, i: number) => (
            <div key={s.step} className="flex items-center gap-1 shrink-0">
              <div className="flex flex-col items-center text-center w-[96px]">
                <span className="w-11 h-11 rounded-full flex items-center justify-center text-base font-bold tabular-nums text-white" style={{ background: PATH_HEX[i] }}>{s.n}</span>
                <span className="text-[10.5px] text-gray-600 mt-1 leading-tight">{s.label}</span>
              </div>
              {i < d.pathway.length - 1 && <span className="text-gray-300">→</span>}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-1">Current occupancy of each stage, derived live from gap-signal outcomes (<code>competency_decisions</code>) and intervention statuses (<code>interventions</code>). Steps 3–7 map to plan statuses planned → in-progress → review → completed; step 8 counts successful closures; step 9 counts scheduled coaching sessions.</p>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Reassessment-due worklist" className="xl:col-span-2" right={<Link href="/educator/interventions" className="text-[11px] text-teal-600 hover:underline">Interventions →</Link>}>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100"><th className="pb-2 pr-3 font-medium">Learner</th><th className="pb-2 pr-3 font-medium">Competency</th><th className="pb-2 pr-3 font-medium">Status</th><th className="pb-2 font-medium text-right">Review due</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {d.reassessRows.map((r: any, i: number) => (
                  <tr key={i} className="text-gray-700">
                    <td className="py-2 pr-3 font-medium text-gray-800 truncate max-w-[140px]">{r.person}</td>
                    <td className="py-2 pr-3 text-gray-600 truncate max-w-[180px]">{r.competency}</td>
                    <td className="py-2 pr-3"><Pill text={r.status} tone={STATUS_TONE[r.status] ?? "slate"} /></td>
                    <td className="py-2 text-right whitespace-nowrap">{r.overdue && <span className="mr-1"><Pill text="overdue" tone="rose" /></span>}<span className="tabular-nums text-gray-500">{fmt(r.review_date)}</span></td>
                  </tr>
                ))}
                {!d.reassessRows.length && <tr><td colSpan={4} className="py-6 text-center text-gray-400">No reassessments due in the next 14 days.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Active interventions with a <code>review_date</code> on or before today + 14 days — overdue plans first. Reassessment closes the loop back to a formal competency decision.</p>
        </Card>

        <Card title="Remediation by status">
          {totalIv ? (
            <div className="flex flex-col items-center gap-3">
              <Donut segs={d.statusDonut} total={totalIv} centre={totalIv} sub="plans" size={140} />
              <div className="w-full space-y-1">
                {d.statusDonut.map((s: any) => (
                  <div key={s.label} className="flex items-center gap-2 text-[11px]"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} /><span className="text-gray-600 flex-1 truncate">{s.label}</span><span className="tabular-nums text-gray-800 font-semibold">{s.n}</span></div>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No remediation plans yet.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Open gap signals" right={<Link href="/competency-office/gaps" className="text-[11px] text-teal-600 hover:underline">Gap management →</Link>}>
          {d.gapByOutcome.length ? (
            <>
              <Bars rows={d.gapByOutcome.map((g: any) => ({ label: g.label, n: g.n }))} colors={d.gapByOutcome.map((g: any) => g.color)} />
              <p className="text-[10px] text-gray-400 mt-3">Est. <span className="font-semibold text-rose-600">{k.unaddressed}</span> gap signal{k.unaddressed === 1 ? "" : "s"} beyond active plans{d.unattributedGaps > 0 ? ` · ${d.unattributedGaps} not yet attributed to a named competency` : ""}.</p>
            </>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No open gap signals — every competency decision is passing. 🎉</p>}
        </Card>

        <Card title="Active remediation by competency">
          {d.byCompetency.length ? <Bars rows={d.byCompetency} /> : <p className="text-sm text-gray-400 py-8 text-center">No active remediation plans.</p>}
        </Card>

        <Card title="Coaching & support">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-[12.5px]"><span className="text-gray-600">Scheduled coaching sessions</span><span className="tabular-nums font-semibold text-gray-900">{d.coaching.scheduled}</span></div>
            <div className="flex items-center justify-between text-[12.5px]"><span className="text-gray-600">Completed sessions</span><span className="tabular-nums font-semibold text-gray-900">{d.coaching.completed}</span></div>
            <div className="flex items-center justify-between text-[12.5px]"><span className="text-gray-600">Partially-successful closures</span><span className="tabular-nums font-semibold text-amber-600">{d.coaching.partiallySuccessful}</span></div>
          </div>
          <p className="text-[10px] text-gray-400 mt-3"><code>support_sessions</code> — the coaching / mentorship backing remediation (steps 5 &amp; 9). Zero where not yet provisioned.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Priority actions" right={<span className="text-[11px] text-gray-400">rule-based</span>}>
          {d.priorities.length ? (
            <div className="space-y-2">
              {d.priorities.map((r: any, i: number) => (
                <div key={i} className="flex items-start gap-2"><span className="text-sm mt-0.5">{r.priority === "high" ? "🔴" : "🟠"}</span><div className="min-w-0"><p className="text-[12px] font-medium text-gray-800">{r.competency}</p><p className="text-[11px] text-gray-500 leading-snug">{r.text}</p></div></div>
              ))}
            </div>
          ) : d.unattributedGaps > 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">{d.unattributedGaps} open gap signal{d.unattributedGaps === 1 ? "" : "s"} not yet attributed to a named competency — attribute decisions to a competency to target remediation.</p>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No named-competency gaps outrunning remediation — coverage is keeping pace. 🎉</p>}
        </Card>

        <Card title="Recent remediation" right="live">
          {d.streamRows.length ? (
            <div className="space-y-1">
              {d.streamRows.map((e: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-[12px] border-b border-gray-50 py-1">
                  <Pill text={e.status} tone={STATUS_TONE[e.status] ?? "slate"} />
                  <span className="text-gray-700 flex-1 truncate">{e.competency}</span>
                  <span className="text-gray-400 text-[11px] truncate w-28">{e.person}</span>
                  {e.outcome && <Pill text={e.outcome} tone={OUTCOME_TONE[e.outcome] ?? "slate"} />}
                  <span className="text-gray-400 text-[10px] tabular-nums w-14 text-right">{fmt(e.when)}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No remediation plans opened yet.</p>}
        </Card>
      </div>

      <Foot>COMP-021 — live over <code>interventions</code> (the governed remediation-plan object: objective, activity, review date, status, outcome) set against <code>competency_decisions</code> in a non-passing / expired outcome (the gap signal) and <code>support_sessions</code> (coaching). Plan status, reassessment dates, success rate and coaching counts are real; the gap↔plan coverage — &ldquo;unaddressed&rdquo; and the priority actions — is an honest heuristic, since decisions and interventions share no key (matched by count delta + competency name). An explicit IDP object binding gap → plan → reassessment → closure, and the automated gap-source feeds (expiry, incident, audit, appraisal), are the next-phase deepening — they would need a <code>remediation_plans</code> migration.</Foot>
    </div>
  );
}
