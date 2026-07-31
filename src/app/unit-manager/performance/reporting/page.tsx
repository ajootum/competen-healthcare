import { loadPaReporting } from "@/lib/analytics/performance-modules";
import { paGuard, Head, Tabs, Card, Kpi, Donut, Pill, Progress, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-PA-008 Executive Reporting & Performance Governance Centre — reporting compliance, the report calendar,
// distribution, governance actions and audit readiness over pa_reports + improvement projects. Gate admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUS_TONE: Record<string, string> = { completed: "emerald", published: "emerald", in_progress: "blue", pending: "amber", not_started: "slate", draft: "slate", on_track: "emerald", at_risk: "amber", overdue: "rose", on_hold: "slate" };
const fmtDate = (t: string | null) => { if (!t) return "—"; try { return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); } catch { return "—"; } };

export default async function ReportingPage() {
  const { admin, isSuper, hid } = await paGuard();
  const d = await loadPaReporting(admin, hid, isSuper) as any;
  const head = <Head code="UMW-PA-008 · Performance Analytics" title="Executive Reporting & Performance Governance Centre" sub="Govern performance, drive accountability and deliver results — executive reporting, review workflow, action tracking and audit readiness." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="008" /><Provision module="Reporting & Governance" /></div>;
  if (!d.hasData) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="008" /><div className="bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded-xl p-6 text-sm text-blue-800">Seed the performance stores first.</div></div>;

  const r = d.ribbon;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="008" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi label="Reporting Compliance" value={`${r.reportingCompliance}%`} sub="reports complete" status={r.reportingCompliance >= 90 ? "green" : "amber"} />
        <Kpi label="Governance Health" value={`${Math.max(0, r.governanceHealth)}/100`} sub="composite" status={r.governanceHealth >= 85 ? "green" : "amber"} />
        <Kpi label="Outstanding Actions" value={r.outstandingActions} sub={`${r.overdue} overdue`} status={r.overdue ? "red" : r.outstandingActions ? "amber" : "green"} />
        <Kpi label="Review Completion" value={`${r.reviewCompletion}%`} sub="actions closed" status={r.reviewCompletion >= 70 ? "green" : "amber"} />
        <Kpi label="Audit Readiness" value={`${r.auditReadiness}%`} sub="ready" status="green" />
        <Kpi label="Board Readiness" value={`${r.boardReadiness}%`} sub="pack ready" status="green" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Report Calendar & Deadlines" className="xl:col-span-2">
          <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Report</span><span className="w-20">Frequency</span><span className="w-16">Due</span><span className="w-14 text-center">Recip.</span><span className="w-24 text-right">Status</span></div>
            {d.reports.map((rep: any) => (
              <div key={rep.name} className="flex items-center px-1 py-1.5 text-[12px] border border-gray-100 rounded-lg"><span className="flex-1 text-gray-800 truncate">{rep.name}</span><span className="w-20 text-gray-500 text-[11px] capitalize">{rep.frequency}</span><span className="w-16 text-gray-500">{fmtDate(rep.due)}</span><span className="w-14 text-center text-gray-500 tabular-nums">{rep.recipients}</span><span className="w-24 text-right"><Pill text={rep.status} tone={STATUS_TONE[rep.status]} /></span></div>
            ))}
          </div>
        </Card>

        <Card title="Distribution Status">
          <div className="flex items-center gap-3">
            <Donut segs={[{ n: d.distribution.delivered, color: "#10b981" }, { n: d.distribution.pending, color: "#f59e0b" }, { n: Math.max(0, d.distribution.total - d.distribution.delivered - d.distribution.pending), color: "#e5e7eb" }]} total={d.distribution.total} centre={`${d.distribution.total ? Math.round((d.distribution.delivered / d.distribution.total) * 100) : 0}%`} sub="delivered" size={104} />
            <div className="flex-1 space-y-1 text-[11px]">
              {[["Delivered", d.distribution.delivered, "#10b981"], ["Pending", d.distribution.pending, "#f59e0b"], ["Not started", Math.max(0, d.distribution.total - d.distribution.delivered - d.distribution.pending), "#94a3b8"]].map(([l, n, c]: any) => <div key={l} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><span className="text-gray-600 flex-1">{l}</span><span className="font-semibold text-gray-900">{n}</span></div>)}
            </div>
          </div>
        </Card>
      </div>

      <Card title="Governance Actions & Decisions" right={<span className="text-[11px] text-gray-400">{d.actions.length} actions</span>}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
          {d.actions.map((a: any) => (
            <div key={a.name} className="flex items-center gap-2"><div className="min-w-0 flex-1"><p className="text-[12px] text-gray-800 leading-tight truncate">{a.name}</p><div className="mt-1"><Progress pct={a.progress} tone={STATUS_TONE[a.status] === "rose" ? "bg-[var(--cmp-color-error)]" : undefined} /></div></div><span className="text-[11px] text-gray-400 w-12 text-right">{fmtDate(a.due)}</span><Pill text={a.status} tone={STATUS_TONE[a.status]} /></div>
          ))}
        </div>
      </Card>

      <Foot>UMW-PA-008 — reporting &amp; governance over pa_reports (calendar, distribution, format) + improvement projects as governance actions. Reporting compliance, distribution and action tracking are real from the stores; the Draft→Review→Approval→Publish workflow engine, evidence repository and digital sign-off are the next phase.</Foot>
    </div>
  );
}
