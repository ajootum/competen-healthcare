import { qaGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Trend, Bars, Table, Foot } from "../_ui";
import { loadStandards } from "@/lib/qaw/standards";

export const dynamic = "force-dynamic";

// QAW-001 Accreditation Standards Centre — frameworks, standards, requirements, compliance assessments.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Framework Library", "Standards Explorer", "Assessments", "Evidence", "Gaps", "Cross-Framework Mapping", "Scoring & Readiness", "Settings"];
const ST_LABEL: Record<string, string> = { met: "Met", partially_met: "Partial", not_met: "Not met", not_assessed: "Not assessed" };

export default async function StandardsPage() {
  const { admin, isSuper, hid } = await qaGuard();
  const d = await loadStandards(admin, hid, isSuper);
  const head = <Head code="QAW-001 · Quality & Accreditation" title="Accreditation Standards Centre" sub="Manage accreditation frameworks, standards, requirements and compliance assessments." action={{ label: "+ New assessment", href: "/admin/accreditation" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">Frameworks are not provisioned yet.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="🎯" tone="teal" label="Overall compliance" value={k.overall != null ? `${k.overall}%` : "—"} sub="of assessed" />
        <Stat icon="📚" tone="blue" label="Frameworks" value={k.frameworks} sub="active" />
        <Stat icon="✅" tone="emerald" label="Standards met" value={k.met} sub={`of ${k.assessed} assessed`} />
        <Stat icon="🟠" tone="amber" label="Partially met" value={k.partial} />
        <Stat icon="⛔" tone="rose" label="Not met" value={k.notMet} />
        <Stat icon="🗂️" tone="violet" label="Catalogued standards" value={k.totalStandards} sub="in library" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Frameworks & standards library" className="xl:col-span-2">
          <Table cols={["Framework", "Type", "Standards", "Assessed", "Compliance"]} rows={d.library.map((f: any) => [
            <span key="n" className="font-medium text-gray-800">{f.name}</span>,
            <span key="t" className="text-gray-500 capitalize">{(f.type ?? "").replace(/_/g, " ")}</span>,
            <span key="s" className="tabular-nums text-gray-600">{f.standards}</span>,
            <span key="a" className="tabular-nums text-gray-500">{f.assessed}</span>,
            f.compliance != null
              ? <span key="c" className="inline-flex items-center gap-2"><span className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden inline-block align-middle"><span className={`h-full block rounded-full ${f.compliance >= 85 ? "bg-[var(--cmp-color-success)]" : f.compliance >= 60 ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-error)]"}`} style={{ width: `${f.compliance}%` }} /></span><b className="tabular-nums text-gray-700">{f.compliance}%</b></span>
              : <span key="c" className="text-gray-300">—</span>,
          ])} empty="No frameworks registered." />
        </Card>

        <Card title="Standards by status">
          <div className="flex items-center gap-2">
            <Donut segments={d.statusDonut} total={k.assessed + k.notAssessed} label="Standards" size={130} />
            <Legend items={d.statusDonut.map((s: any) => ({ label: s.label, value: s.value, tone: s.tone }))} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Compliance by framework">
          {d.byFramework.length ? <Bars items={d.byFramework.map((f: any) => ({ label: f.label, pct: f.pct, tone: f.tone, value: `${f.pct}%` }))} /> : <p className="text-sm text-gray-400 py-6 text-center">No assessments recorded yet.</p>}
        </Card>

        <Card title="Compliance trend" right="last 6 months">
          {d.trend.length >= 2 ? <><Trend points={d.trend.map((t: any) => t.value)} labels={d.trend.map((t: any) => t.label)} tone="teal" suffix="%" target={90} /><p className="text-[10px] text-gray-400 text-center mt-1">% of assessments met, by month · dashed = 90% survey target.</p></> : <p className="text-sm text-gray-400 py-8 text-center">Not enough assessment history yet.</p>}
        </Card>

        <Card title="Top gaps" right="by risk priority">
          {d.topGaps.length ? <div className="space-y-2">{d.topGaps.map((g: any, i: number) => (
            <div key={i} className="flex items-start gap-2 text-[12px]">
              {g.ref && <span className="text-[10px] font-mono text-teal-700 bg-teal-50 border border-teal-100 rounded px-1.5 py-0.5 shrink-0">{g.ref}</span>}
              <div className="min-w-0 flex-1"><p className="text-gray-800 truncate">{g.title ?? g.gap ?? "Standard gap"}</p><p className="text-[10px] text-gray-400">{g.framework}</p></div>
              <Pill text={ST_LABEL[g.status]} tone={g.status === "not_met" ? "rose" : "amber"} />
            </div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No open gaps. ✅</p>}
        </Card>
      </div>

      <Card title="Recent assessments">
        <Table cols={["Ref", "Standard", "Framework", "Assessed by", "When", "Status"]} rows={d.recent.map((a: any) => [
          <span key="r" className="text-[10px] font-mono text-teal-700 bg-teal-50 border border-teal-100 rounded px-1.5 py-0.5">{a.ref}</span>,
          <span key="t" className="text-gray-800">{a.title ?? "—"}</span>,
          <span key="f" className="text-gray-500">{a.framework}</span>,
          <span key="b" className="text-gray-500">{a.by ?? "—"}</span>,
          <span key="w" className="text-gray-400 tabular-nums">{a.when ? String(a.when).slice(0, 10) : "—"}</span>,
          <Pill key="s" text={ST_LABEL[a.status]} tone={d.statusTone[a.status] ?? "slate"} />,
        ])} empty="No assessments recorded yet." />
      </Card>

      <Foot>QAW-001 — live over <code>quality_frameworks</code> + <code>quality_standards</code> (the catalogue) and <code>gov_standard_assessments</code> (the INSERT-only assessment history, read latest-per-standard so compliance reflects the current position while the full trail is preserved). Applicability rules, RACI ownership, cross-framework crosswalks and evidence-requirement linkage are the next build phases.</Foot>
    </div>
  );
}
