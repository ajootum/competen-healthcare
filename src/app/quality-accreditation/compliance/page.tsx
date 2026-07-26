import { qaGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Trend, Bars, Table, QuickActions, Foot } from "../_ui";
import { loadCompliance } from "@/lib/qaw/compliance-monitoring";

export const dynamic = "force-dynamic";

// QAW-005 Compliance Monitoring Centre — continuous compliance against regulatory / accreditation /
// contractual / internal requirements, grounded in the Obligations Register (gov_obligations).
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Requirements Library", "Compliance Checks", "Policies & Procedures", "Obligations Register", "Regulatory Updates", "Reports & Analytics"];
const RISK_TONE: Record<string, string> = { critical: "rose", high: "rose", medium: "amber", low: "emerald" };

export default async function CompliancePage() {
  const { admin, isSuper, hid } = await qaGuard();
  const d = await loadCompliance(admin, hid, isSuper);
  const head = <Head code="QAW-005 · Quality & Accreditation" title="Compliance Monitoring Centre" sub="Monitor regulatory compliance, policies and internal standards across the organization." action={{ label: "+ New obligation", href: "/enterprise-governance" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">The Obligations Register (<code>gov_obligations</code>) is not provisioned yet.</p></Card></div>;
  const k = d.kpis;
  const pctOf = (n: number) => (k.total ? Math.round((n / k.total) * 100) : 0);

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="📋" tone="teal" label="Overall compliance" value={k.score != null ? `${k.score}%` : "—"} sub="of assessed" />
        <Stat icon="📚" tone="blue" label="Requirements" value={k.total} sub="tracked" />
        <Stat icon="✅" tone="emerald" label="Compliant" value={k.compliant} sub={`${pctOf(k.compliant)}%`} />
        <Stat icon="⚠️" tone="amber" label="At risk / partial" value={k.atRisk} sub={`${pctOf(k.atRisk)}%`} />
        <Stat icon="⛔" tone="rose" label="Non-compliant" value={k.nonCompliant} sub={`${pctOf(k.nonCompliant)}%`} />
        <Stat icon="⏰" tone="violet" label="Overdue reviews" value={k.overdue} sub="past expiry" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Compliance by domain">
          <div className="flex items-center gap-2">
            <Donut segments={d.byDomain} total={k.total} label="Requirements" size={130} />
            <Legend items={d.byDomain.slice(0, 7).map((x: any) => ({ label: x.label, value: `${x.pct}%`, tone: x.tone }))} />
          </div>
        </Card>

        <Card title="Compliance trend" right="last 6 months">
          {d.trend.length >= 2 ? <><Trend points={d.trend.map((t: any) => t.value)} labels={d.trend.map((t: any) => t.label)} tone="emerald" suffix="%" target={85} /><p className="text-[10px] text-gray-400 text-center mt-1">Compliance score per month (daily snapshots) · dashed = 85% target.</p></> : <p className="text-sm text-gray-400 py-8 text-center">Not enough snapshot history yet.</p>}
        </Card>

        <Card title="Compliance by status">
          <Bars items={d.statusBreak.filter((s: any) => s.value > 0).map((s: any) => ({ label: s.label, pct: pctOf(s.value), tone: s.tone, value: `${s.value} (${pctOf(s.value)}%)` }))} />
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Top non-compliant requirements">
          <Table cols={["Requirement", "Domain", "Authority", "Risk", "Status"]} rows={d.topNonCompliant.map((o: any) => [
            <span key="t" className="font-medium text-gray-800">{o.title}</span>,
            <span key="d" className="text-gray-500 capitalize">{o.domain}</span>,
            <span key="a" className="text-gray-400">{o.authority ?? "—"}</span>,
            <Pill key="r" text={o.risk ?? "—"} tone={RISK_TONE[o.risk] ?? "slate"} />,
            <Pill key="s" text={o.status.replace(/_/g, " ")} tone={o.status === "non_compliant" ? "rose" : "amber"} />,
          ])} empty="Everything compliant. ✅" />
        </Card>

        <Card title="Upcoming reviews & renewals">
          <Table cols={["Requirement", "Domain", "Due", "Cycle"]} rows={d.upcoming.map((o: any) => [
            <span key="t" className="text-gray-800">{o.title}</span>,
            <span key="d" className="text-gray-500 capitalize">{o.domain}</span>,
            <span key="due" className="text-gray-500 tabular-nums">{o.due}</span>,
            <span key="f" className="text-gray-400 capitalize">{o.freq}</span>,
          ])} empty="No upcoming renewals." />
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Obligations register" className="xl:col-span-2" right="recent">
          <Table cols={["Obligation", "Domain", "Owner", "Status"]} rows={d.recent.map((o: any) => [
            <span key="t" className="text-gray-800">{o.title}</span>,
            <span key="d" className="text-gray-500 capitalize">{o.domain}</span>,
            <span key="o" className="text-gray-500">{o.owner ?? "—"}</span>,
            <Pill key="s" text={o.status.replace(/_/g, " ")} tone={o.statusTone} />,
          ])} empty="No obligations recorded." />
        </Card>

        <Card title="Regulatory updates">
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <span className="text-2xl mb-1">📡</span>
            <p className="text-[12px] text-gray-500">Regulatory-update tracking is the next phase.</p>
            <p className="text-[10px] text-gray-400 mt-1">A feed of issued/updated regulations (with effective dates and mapped obligations) lights this panel up; the register above is fully live today.</p>
          </div>
        </Card>
      </div>

      <Card title="Quick actions">
        <QuickActions actions={[
          { icon: "➕", label: "New obligation", href: "/enterprise-governance" },
          { icon: "📄", label: "Upload evidence", href: "/quality-accreditation/documents" },
          { icon: "🎯", label: "Standards", href: "/quality-accreditation/standards" },
          { icon: "⚠️", label: "Linked risks", href: "/quality-accreditation/risk" },
          { icon: "📊", label: "Analytics", href: "/quality-accreditation/analytics" },
          { icon: "🧾", label: "Audit trail", href: "/quality-accreditation/audit-trail" },
          { icon: "🏛️", label: "Governance", href: "/quality-accreditation/governance" },
          { icon: "✨", label: "AI compliance", href: "/quality-accreditation/ai" },
        ]} />
      </Card>

      <Foot>QAW-005 — live over <code>gov_obligations</code> (the Obligations Register). Overall score, domain and status breakdowns, top non-compliant items and upcoming renewals are real and tenant-scoped; the trend reads the daily <code>quality_score_snapshots</code>. Scheduled compliance-check runs and a regulatory-update feed are the next build phase.</Foot>
    </div>
  );
}
