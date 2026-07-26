import { qaGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Trend, Bars, Table, Foot } from "../_ui";
import { loadReadiness } from "@/lib/qaw/readiness";

export const dynamic = "force-dynamic";

// QAW-009 Accreditation Readiness & Survey Management.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Readiness Dashboard", "Survey Calendar", "Mock Surveys", "Tracers", "Evidence Rooms", "Interview Prep", "Action Tracker", "Survey Execution"];
const ST_LABEL: Record<string, string> = { not_met: "Major gap", partially_met: "Minor gap" };

export default async function ReadinessPage() {
  const { admin, isSuper, hid } = await qaGuard();
  const d = await loadReadiness(admin, hid, isSuper);
  const head = <Head code="QAW-009 · Quality & Accreditation" title="Accreditation Readiness & Survey Management" sub="Plan, prepare and manage accreditation surveys from readiness assessment to successful accreditation." action={{ label: "+ New survey", href: "/enterprise-governance" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">Assessment history (<code>gov_standard_assessments</code>) is not provisioned yet.</p></Card></div>;
  const k = d.kpis, ap = d.actionPlan;

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="🎯" tone="teal" label="Overall readiness" value={k.readiness != null ? `${k.readiness}%` : "—"} sub="of assessed" />
        <Stat icon="📋" tone="blue" label="Standards assessed" value={`${k.assessed}${k.totalStandards ? ` / ${k.totalStandards}` : ""}`} sub="in catalogue" />
        <Stat icon="⛔" tone="rose" label="High-priority gaps" value={k.highGaps} sub="not met" />
        <Stat icon="🧪" tone="violet" label="Mock surveys done" value={k.mockCompleted} />
        <Stat icon="🛠️" tone="amber" label="Actions open" value={k.actionsInProgress} sub="remediation" />
        <Stat icon="📅" tone="indigo" label="Days to next survey" value={k.daysToNext != null ? k.daysToNext : "—"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Readiness by framework">
          {d.byDomain.length ? <Bars items={d.byDomain.map((x: any) => ({ label: x.label, pct: x.pct, value: `${x.pct}%` }))} /> : <p className="text-sm text-gray-400 py-6 text-center">No assessments yet.</p>}
        </Card>

        <Card title="Readiness trend" right="last 6 months">
          {d.trend.length >= 2 ? <><Trend points={d.trend.map((t: any) => t.value)} labels={d.trend.map((t: any) => t.label)} tone="teal" suffix="%" target={90} /><p className="text-[10px] text-gray-400 text-center mt-1">% assessments met · dashed = 90% survey target.</p></> : <p className="text-sm text-gray-400 py-8 text-center">Not enough history yet.</p>}
        </Card>

        <Card title="Survey readiness by standard">
          <div className="flex items-center gap-2">
            <Donut segments={d.statusDonut} total={k.assessed + (d.statusDonut[3]?.value ?? 0)} label="Standards" size={130} />
            <Legend items={d.statusDonut.map((s: any) => ({ label: s.label, value: s.value, tone: s.tone }))} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Top gaps by criticality">
          <Table cols={["Ref", "Standard", "Framework", "Status"]} rows={d.topGaps.map((g: any) => [
            <span key="r" className="text-[10px] font-mono text-teal-700 bg-teal-50 border border-teal-100 rounded px-1.5 py-0.5">{g.ref}</span>,
            <span key="t" className="text-gray-800">{g.title ?? "—"}</span>,
            <span key="f" className="text-gray-500">{g.framework}</span>,
            <Pill key="s" text={ST_LABEL[g.status] ?? g.status} tone={g.status === "not_met" ? "rose" : "amber"} />,
          ])} empty="No open gaps. ✅" />
        </Card>

        <Card title="Upcoming surveys">
          <Table cols={["Survey", "Type", "Framework", "Scheduled", "Status"]} rows={d.upcomingSurveys.map((s: any) => [
            <span key="t" className="font-medium text-gray-800">{s.title}</span>,
            <span key="ty" className="text-gray-500 capitalize">{(s.type ?? "").replace(/_/g, " ")}</span>,
            <span key="f" className="text-gray-500">{s.framework}</span>,
            <span key="w" className="text-gray-500 tabular-nums">{s.when}</span>,
            <Pill key="s" text={s.status} tone={s.status === "planned" ? "slate" : "amber"} />,
          ])} empty="No upcoming surveys scheduled." />
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Recent survey & tracer activities" className="xl:col-span-2">
          <Table cols={["Activity", "Type", "Outcome", "Scheduled", "Status"]} rows={d.recentSurveys.map((s: any) => [
            <span key="t" className="text-gray-800">{s.title}</span>,
            <span key="ty" className="text-gray-500 capitalize">{(s.type ?? "").replace(/_/g, " ")}</span>,
            <span key="o" className="text-gray-500 capitalize">{(s.outcome ?? "—").replace(/_/g, " ")}</span>,
            <span key="w" className="text-gray-400 tabular-nums">{s.when ?? "—"}</span>,
            <Pill key="s" text={s.status} tone={s.status === "completed" ? "emerald" : s.status === "cancelled" ? "slate" : "amber"} />,
          ])} empty="No surveys recorded yet." />
        </Card>

        <Card title="Action-plan progress">
          <div className="text-center mb-2"><p className="text-3xl font-bold tabular-nums text-gray-900">{ap.total}</p><p className="text-[11px] text-gray-400">remediation actions</p></div>
          <Bars items={[
            { label: "Completed", pct: ap.total ? Math.round((ap.completed / ap.total) * 100) : 0, tone: "emerald", value: ap.completed },
            { label: "In progress", pct: ap.total ? Math.round((ap.inProgress / ap.total) * 100) : 0, tone: "amber", value: ap.inProgress },
            { label: "Overdue", pct: ap.total ? Math.round((ap.overdue / ap.total) * 100) : 0, tone: "rose", value: ap.overdue },
            { label: "Not started", pct: ap.total ? Math.round((ap.notStarted / ap.total) * 100) : 0, tone: "slate", value: ap.notStarted },
          ]} />
        </Card>
      </div>

      <Card title="Tracers, evidence rooms & interview prep">
        <div className="flex flex-col items-center justify-center py-5 text-center">
          <span className="text-2xl mb-1">🗂️</span>
          <p className="text-[12px] text-gray-500">Tracer management, evidence rooms and interview preparation are the next build phase.</p>
          <p className="text-[10px] text-gray-400 mt-1 max-w-xl">Readiness scoring, framework breakdown, gap list, surveys and the remediation action-plan above are fully live; tracer packs, evidence-room assembly and mock-interview prep each need their own store.</p>
        </div>
      </Card>

      <Foot>QAW-009 — live over <code>gov_surveys</code> + <code>gov_standard_assessments</code> (latest-per-standard) + the <code>capa_actions</code> remediation plan. Readiness score, framework breakdown, trend, gaps, survey calendar and action-plan progress are real and tenant-scoped. Tracers, evidence rooms and interview prep are the next build phases.</Foot>
    </div>
  );
}
