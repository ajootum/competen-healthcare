import { fetchCmoSuite, pct } from "@/lib/competency/cmo-suite";
import { cmoGuard, Head, Card, Kpi, Donut, Bars, Provision, Foot } from "../_cmo-ui";

export const dynamic = "force-dynamic";

// CMO-013 Competency Review Board — governance over competency decisions (appeals, escalations, sign-off). Lens over
// the competency_decisions spine (the authoritative decision outcomes).
/* eslint-disable @typescript-eslint/no-explicit-any */
const OUTCOME_COLOR = ["#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#a855f7", "#94a3b8"];
const passing = (o: any) => /competent|pass|achiev|met|proficient|approv/i.test(String(o));
const escalate = (o: any) => /refer|escalat|appeal|review|not/i.test(String(o));

export default async function ReviewBoardPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await fetchCmoSuite(admin, hid, isSuper);
  const head = <Head code="CMO-013 · Competency Office" title="Competency Review Board" sub="Structured governance for reviewing, approving, escalating and documenting competency decisions across the enterprise." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="the Review Board" /></div>;

  const decisions = d.decisions;
  const byOutcome = Object.entries(decisions.reduce((acc: Record<string, number>, x: any) => { const o = x.outcome ?? "pending"; acc[o] = (acc[o] ?? 0) + 1; return acc; }, {})).map(([label, n]) => ({ label: String(label).replace(/_/g, " "), n: n as number, raw: label })).sort((a, b) => b.n - a.n);
  const total = decisions.length;
  const escalations = decisions.filter((x: any) => escalate(x.outcome)).length;
  const approved = decisions.filter((x: any) => passing(x.outcome)).length;
  // Governance actions from the review lens: AI recs + overdue assignments needing board attention.
  const boardActions = d.aiRecs.filter((r: any) => ["privileging", "risk", "gap"].includes(r.category)).slice(0, 6);

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Decisions" value={total} sub="on record" />
        <Kpi label="Approved / Competent" value={approved} sub={total ? `${pct(approved, total)}%` : "—"} tone="text-emerald-600" />
        <Kpi label="Escalations / Referrals" value={escalations} sub="board review" tone={escalations ? "text-amber-600" : undefined} />
        <Kpi label="Outcome Types" value={byOutcome.length} sub="categories" />
        <Kpi label="Board Actions" value={boardActions.length} sub="follow-up" />
        <Kpi label="Frameworks in Cycle" value={d.frameworks.length} sub="under review" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Decision Outcomes">
          {total ? <div className="flex items-center gap-3">
            <Donut segs={byOutcome.map((o, i) => ({ n: o.n, color: OUTCOME_COLOR[i % OUTCOME_COLOR.length] }))} total={total} centre={total} sub="decisions" size={100} />
            <div className="flex-1 space-y-1 text-[11px]">{byOutcome.slice(0, 6).map((o, i) => <div key={o.raw} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: OUTCOME_COLOR[i % OUTCOME_COLOR.length] }} /><span className="text-gray-600 flex-1 capitalize truncate">{o.label}</span><span className="font-semibold text-gray-900">{o.n}</span></div>)}</div>
          </div> : <p className="text-sm text-gray-400 py-6 text-center">No decisions recorded yet.</p>}
        </Card>

        <Card title="Outcome Breakdown" className="xl:col-span-2">
          {byOutcome.length ? <Bars rows={byOutcome.map(o => ({ label: o.label, n: o.n, extra: `${o.n} (${pct(o.n, total)}%)` }))} /> : <p className="text-sm text-gray-400 py-6 text-center">No decision data.</p>}
        </Card>
      </div>

      <Card title="Board Follow-Up Actions" right={<span className="text-[11px] text-gray-400">from AI governance intelligence</span>}>
        {boardActions.length ? <div className="space-y-2">{boardActions.map((r: any) => (
          <div key={r.id} className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-teal-400 mt-1.5 shrink-0" /><div className="min-w-0 flex-1"><p className="text-[12px] text-gray-800 leading-tight">{r.title}</p><p className="text-[10px] text-gray-400">{r.detail}</p></div></div>
        ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No board actions pending.</p>}
      </Card>

      <Foot>CMO-013 — review-board governance over the competency_decisions spine (the authoritative decision outcomes) + AI governance intelligence for follow-up. Outcome distribution and escalations are real; the meeting/agenda manager, case triage, voting engine and immutable minutes are the next phase.</Foot>
    </div>
  );
}
