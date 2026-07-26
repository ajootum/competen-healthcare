import { qaGuard, Head, Tabs, Stat, Card, Donut, Legend, Trend, Bars, Table, Foot } from "../_ui";
import { loadAuditTrail } from "@/lib/qaw/audit-trail";

export const dynamic = "force-dynamic";

// QAW-014 Quality Audit Trail, Assurance & Regulatory Reporting.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Audit Trail", "Assurance Dashboard", "Regulatory Reports", "Evidence & Documents", "Report Scheduler", "Compliance Assurance", "AI Assurance", "Settings"];

export default async function AuditTrailPage() {
  const { admin, isSuper, hid } = await qaGuard();
  const d = await loadAuditTrail(admin, hid, isSuper);
  const head = <Head code="QAW-014 · Quality & Accreditation" title="Quality Audit Trail, Assurance & Regulatory Reporting" sub="Ensure transparency, accountability and compliance with complete auditability and regulatory reporting." action={{ label: "Export audit log", href: "/quality-accreditation/audit-trail" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">The audit trail (<code>audit_log</code>) is not provisioned yet.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="🧾" tone="blue" label="Total audit events" value={k.totalEvents.toLocaleString()} sub="immutable log" />
        <Stat icon="🛡️" tone="emerald" label="Assurance score" value={k.assurance != null ? `${k.assurance}%` : "—"} sub="composite" />
        <Stat icon="⛔" tone="rose" label="Compliance issues" value={k.complianceIssues} sub="non-compliant" />
        <Stat icon="🛠️" tone="amber" label="Open action items" value={k.openActions} />
        <Stat icon="📡" tone="violet" label="Domain events" value={k.domainEvents.toLocaleString()} sub="event stream" />
        <Stat icon="🗂️" tone="teal" label="Modules covered" value={d.byModule.length} sub="in recent window" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Audit trail events" className="xl:col-span-2" right="recent activity">
          {d.trend.length >= 2 ? <><Trend points={d.trend.map((t: any) => t.value)} labels={d.trend.map((t: any) => t.label)} tone="blue" height={140} /><p className="text-[10px] text-gray-400 text-center mt-1">Audit events per day across the recent window (live from the immutable log).</p></> : <p className="text-sm text-gray-400 py-8 text-center">Not enough events yet for a trend.</p>}
        </Card>

        <Card title="Events by module">
          <div className="flex items-center gap-2">
            <Donut segments={d.byModule} total={d.byModule.reduce((s: number, m: any) => s + m.value, 0)} label="Events" size={130} />
            <Legend items={d.byModule.slice(0, 7).map((m: any) => ({ label: m.label, value: m.value, tone: m.tone }))} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Recent audit events" className="xl:col-span-2">
          <Table cols={["Time", "User", "Action", "Module", "Record"]} rows={d.recent.map((e: any) => [
            <span key="t" className="text-gray-400 tabular-nums whitespace-nowrap">{e.when ? new Date(e.when).toLocaleString() : "—"}</span>,
            <span key="u" className="text-gray-700">{e.actor ?? "system"}</span>,
            <span key="a" className="text-gray-600">{(e.action ?? "").replace(/_/g, " ")}</span>,
            <span key="m" className="text-gray-500 capitalize">{e.module}</span>,
            <span key="r" className="text-gray-400 truncate block max-w-[160px]">{e.entity ?? "—"}</span>,
          ])} empty="No audit events recorded yet." />
        </Card>

        <Card title="Events by action">
          <div className="flex items-center gap-2">
            <Donut segments={d.byAction} total={k.recentWindow} label="Recent" size={120} />
            <Legend items={d.byAction.map((a: any) => ({ label: a.label, value: a.value, tone: a.tone }))} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Compliance assurance summary">
          {d.assuranceParts.length ? <><Bars items={d.assuranceParts.map((p: any) => ({ label: p.label, pct: p.pct, tone: p.tone, value: `${p.pct}%` }))} /><p className="text-[10px] text-gray-400 mt-2">Assurance score is a transparent composite of the latest daily quality snapshot — no hidden model.</p></> : <p className="text-sm text-gray-400 py-6 text-center">No snapshot yet for an assurance composite.</p>}
        </Card>

        <Card title="Regulatory reporting">
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <span className="text-2xl mb-1">📤</span>
            <p className="text-[12px] text-gray-500">Regulatory submission management is the next phase.</p>
            <p className="text-[10px] text-gray-400 mt-1">The immutable audit trail and assurance composite are live; a submissions store (report → approve → submit → archive, with digital signatures) lights this up.</p>
          </div>
        </Card>

        <Card title="Evidence chain of custody">
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <span className="text-2xl mb-1">🔗</span>
            <p className="text-[12px] text-gray-500">Chain-of-custody & legal hold are the next phase.</p>
            <p className="text-[10px] text-gray-400 mt-1">Every action is already captured immutably in <code>audit_log</code> + <code>domain_events</code>; a custody ledger (created → collected → validated → approved → archived) formalises evidence integrity.</p>
          </div>
        </Card>
      </div>

      <Foot>QAW-014 — live over <code>audit_log</code> (the immutable enterprise trail) + <code>domain_events</code>. Event volume, per-module and per-action profiles, the daily trend and the recent-event feed are all real and tenant-scoped; the assurance score is a transparent composite of the latest <code>quality_score_snapshots</code>. Regulatory submissions, formal assurance reviews, evidence chain-of-custody and digital signatures are the next build phases.</Foot>
    </div>
  );
}
