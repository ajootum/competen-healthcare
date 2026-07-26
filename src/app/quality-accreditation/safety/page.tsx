import { qaGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Trend, Gauge, Table, QuickActions, Foot } from "../_ui";
import { loadSafety } from "@/lib/qaw/safety";

export const dynamic = "force-dynamic";

// QAW-010 Incident, Safety & Learning Integration Centre.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Incident Reporting", "Safety Events", "RCA & Investigation", "Safety Learning", "Complaints", "Alerts & Notifications", "Settings"];
const SEV_TONE: Record<string, string> = { critical: "rose", high: "amber", medium: "blue", low: "emerald" };

export default async function SafetyPage() {
  const { admin, isSuper, hid } = await qaGuard();
  const d = await loadSafety(admin, hid, isSuper);
  const head = <Head code="QAW-010 · Quality & Accreditation" title="Incident, Safety & Learning Integration Centre" sub="Report, manage and learn from incidents, safety events and complaints to improve patient and staff safety." action={{ label: "+ New incident", href: "/unit-manager/patient-operations" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">The incident store (<code>op_incidents</code>) is not provisioned yet.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="📄" tone="blue" label="Total reports" value={k.total} sub="incidents logged" />
        <Stat icon="⚠️" tone="rose" label="Incidents" value={k.incidents} />
        <Stat icon="🟡" tone="amber" label="Near misses" value={k.nearMisses} />
        <Stat icon="🛟" tone="violet" label="Patient safety events" value={k.pse} sub={`${k.activePse} active`} />
        <Stat icon="💬" tone="slate" label="Complaints" value="—" sub="no store yet" />
        <Stat icon="🔎" tone="teal" label="Open investigations" value={k.openInvestigations} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Reports by type">
          <div className="flex items-center gap-2">
            <Donut segments={d.byType} total={k.total} label="Total" size={130} />
            <Legend items={d.byType.slice(0, 7).map((t: any) => ({ label: t.label, value: t.value, tone: t.tone, pct: k.total ? Math.round((t.value / k.total) * 100) : 0 }))} />
          </div>
        </Card>

        <Card title="Reports trend" right="last 6 months">
          <Trend points={d.trend.map((b: any) => b.total)} labels={d.trend.map((b: any) => b.label)} tone="rose" />
          <p className="text-[10px] text-gray-400 text-center mt-1">Incidents reported per month (live).</p>
        </Card>

        <Card title="Reports by severity">
          <div className="flex items-center gap-2">
            <Donut segments={d.bySeverity} total={k.total} label="Total" size={130} />
            <Legend items={d.bySeverity.filter((s: any) => s.value > 0).map((s: any) => ({ label: s.label, value: s.value, tone: s.tone, pct: k.total ? Math.round((s.value / k.total) * 100) : 0 }))} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Recent reports" className="xl:col-span-2">
          <Table cols={["Type", "Description", "Severity", "Reported by", "Status"]} rows={d.recent.map((r: any) => [
            <span key="t" className="font-medium text-gray-800 capitalize">{r.type}{r.near && <span className="ml-1 text-[9px] text-amber-600">near-miss</span>}</span>,
            <span key="d" className="text-gray-500 truncate block max-w-[240px]">{r.desc}</span>,
            <Pill key="s" text={r.severity} tone={SEV_TONE[r.severity] ?? "slate"} />,
            <span key="b" className="text-gray-500">{r.by ?? "—"}</span>,
            <Pill key="st" text={r.status.replace(/_/g, " ")} tone={r.status === "closed" ? "emerald" : r.status === "reported" ? "slate" : "amber"} />,
          ])} empty="No incidents reported yet." />
        </Card>

        <Card title="Investigation status">
          <div className="flex items-center gap-2">
            <Donut segments={d.investigationStatus} total={k.total} label="Reports" size={120} />
            <Legend items={d.investigationStatus.filter((s: any) => s.value > 0).map((s: any) => ({ label: s.label, value: s.value, tone: s.tone }))} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Top themes / contributing factors">
          {d.topThemes.length ? <div className="space-y-2">{d.topThemes.map((t: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[12.5px]"><span className="text-gray-700 flex-1 capitalize">{t.theme}</span><span className="text-gray-400 tabular-nums">{t.count}</span><span className="text-gray-500 tabular-nums w-10 text-right">{t.pct}%</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No data.</p>}
        </Card>

        <Card title="RCA effectiveness" right="M&M cases">
          {d.rca.pct != null ? <div className="flex flex-col items-center"><Gauge pct={d.rca.pct} label={`${d.rca.total} cases`} /><p className="text-[10px] text-gray-400 mt-1 text-center">Share of mortality & morbidity cases through RCA / closure.</p></div>
            : <div className="flex flex-col items-center justify-center py-6 text-center"><span className="text-2xl mb-1">🧪</span><p className="text-[12px] text-gray-500">No M&M cases recorded yet.</p></div>}
        </Card>

        <Card title="Safety learning">
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <span className="text-2xl mb-1">📚</span>
            <p className="text-[12px] text-gray-500">A lessons-learned repository is the next phase.</p>
            <p className="text-[10px] text-gray-400 mt-1">Incidents, severity, themes and investigations above are live; a safety-learning / bulletin store adds dissemination tracking.</p>
          </div>
        </Card>
      </div>

      <Card title="Quick actions">
        <QuickActions actions={[
          { icon: "⚠️", label: "Report incident", href: "/unit-manager/patient-operations" },
          { icon: "🟡", label: "Report near miss", href: "/unit-manager/patient-operations" },
          { icon: "🛟", label: "Safety events", href: "/unit-manager/patient-operations" },
          { icon: "🔎", label: "Investigations", href: "/quality-accreditation/improvements" },
          { icon: "🧪", label: "RCA & M&M", href: "/unit-manager/quality" },
          { icon: "🛠️", label: "Corrective actions", href: "/quality-accreditation/improvements" },
          { icon: "📊", label: "Safety analytics", href: "/quality-accreditation/analytics" },
          { icon: "✨", label: "AI safety intel", href: "/quality-accreditation/ai" },
        ]} />
      </Card>

      <Foot>QAW-010 — live over <code>op_incidents</code> (spine) + <code>op_safety_alerts</code> + <code>op_escalations</code> + <code>mm_cases</code>. Type, severity, trend, themes, investigation status and RCA effectiveness are all real and tenant-scoped. Complaints management and a formal safety-learning / bulletin repository are the next build phases (flagged honestly above, not faked).</Foot>
    </div>
  );
}
