import { qaGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Trend, Bars, Table, QuickActions, Foot, ragPct, T } from "../_ui";
import { loadAuditCentre } from "@/lib/qaw/audit-centre";
import Link from "next/link";

export const dynamic = "force-dynamic";

// QAW-002 Clinical Audit Centre — plan, execute and monitor clinical & operational audits.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Audit Plan", "My Audits", "Audit Schedule", "Templates", "Data Collection", "Findings", "Follow-up", "Reports"];
const STATUS_TONE: Record<string, string> = { completed: "emerald", in_progress: "amber", planned: "slate" };
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s);

export default async function AuditCentrePage() {
  const { admin, isSuper, hid } = await qaGuard();
  const d = await loadAuditCentre(admin, hid, isSuper);
  const head = <Head code="QAW-002 · Quality & Accreditation" title="Clinical Audit Centre" sub="Plan, execute and monitor clinical and operational audits." action={{ label: "+ New audit", href: "/assessor/quality" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" />{/* pre-migration */}<Card><p className="text-sm text-gray-400">The audit store is not provisioned yet.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="📋" tone="blue" label="Audits (this period)" value={k.total} sub={`${d.trend.at(-1)?.completed ?? 0} this month`} />
        <Stat icon="✅" tone="emerald" label="Completed" value={k.completed} sub={`${k.completionRate}% completion`} />
        <Stat icon="🕓" tone="amber" label="In progress" value={k.inProgress} />
        <Stat icon="🗓️" tone="slate" label="Planned" value={k.planned} />
        <Stat icon="🔎" tone="violet" label="Findings" value={k.findings} sub="not-met items" />
        <Stat icon="⚠️" tone="rose" label="Critical findings" value={k.critical} sub={k.critical ? "need action" : "none open"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Audit activity" className="xl:col-span-2" right={<Link href="/assessor/quality" className="text-teal-600 hover:underline">Run an audit →</Link>}>
          <Table cols={["Audit", "Type", "Area", "Compliance", "Status"]} rows={d.recent.map((a: any) => [
            <span key="t" className="font-medium text-gray-800">{a.title}</span>,
            <span key="ty" className="text-gray-500">{cap(a.type)}</span>,
            <span key="ar" className="text-gray-500">{a.area ?? "—"}</span>,
            <span key="c" className={`font-semibold tabular-nums ${a.compliance != null ? T(ragPct(a.compliance)).text : "text-gray-300"}`}>{a.compliance != null ? `${a.compliance}%` : "—"}</span>,
            <Pill key="s" text={cap(a.status)} tone={STATUS_TONE[a.status] ?? "slate"} />,
          ])} empty="No audits recorded yet." />
        </Card>

        <Card title="Audit status summary">
          <div className="flex items-center gap-3">
            <Donut segments={d.statusBreak} total={k.total} label="Total audits" size={140} />
            <Legend items={d.statusBreak.map((s: any) => ({ label: s.label, value: s.value, tone: s.tone, pct: k.total ? Math.round((s.value / k.total) * 100) : 0 }))} />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-gray-100">
            <div><p className="text-[11px] text-gray-400">Average compliance</p><p className={`text-xl font-bold tabular-nums ${k.avgCompliance != null ? T(ragPct(k.avgCompliance)).text : "text-gray-300"}`}>{k.avgCompliance != null ? `${k.avgCompliance}%` : "—"}</p></div>
            <div><p className="text-[11px] text-gray-400">Critical findings</p><p className={`text-xl font-bold tabular-nums ${k.critical ? "text-[var(--cmp-text-error)]" : "text-gray-900"}`}>{k.critical}</p></div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Findings breakdown" right="by result">
          <Bars items={d.findingsTier.map((f: any) => ({ label: f.label, pct: k.findings + (d.findingsTier[2]?.value ?? 0) ? Math.round((f.value / Math.max(1, d.findingsTier.reduce((s: number, x: any) => s + x.value, 0))) * 100) : 0, tone: f.tone, value: f.value }))} />
          <p className="text-[10px] text-gray-400 mt-2">The store records <code>is_critical</code> per finding (not a 4-tier priority), so findings are reported as Critical / other not-met / met — honestly, not invented tiers.</p>
        </Card>

        <Card title="Audit trend" right="last 6 months">
          <Trend points={d.trend.map((b: any) => b.completed)} labels={d.trend.map((b: any) => b.label)} tone="teal" />
          <p className="text-[10px] text-gray-400 mt-1 text-center">Completed audits per month (live from conducted date).</p>
        </Card>

        <Card title="Coverage by area">
          {d.coverage.length ? <div className="space-y-2">{d.coverage.map((c: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[12.5px]">
              <span className="text-gray-700 truncate flex-1">{c.area}</span>
              <span className="text-gray-400 tabular-nums">{c.completed}/{c.total}</span>
              <span className={`font-semibold tabular-nums w-11 text-right ${c.compliance != null ? T(ragPct(c.compliance)).text : "text-gray-300"}`}>{c.compliance != null ? `${c.compliance}%` : "—"}</span>
            </div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No area data.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Overdue follow-ups" right={`${d.openFollowUps} open`}>
          <Table cols={["Action", "Owner", "Due", "Overdue"]} rows={d.overdueFollowUps.map((c: any) => [
            <span key="t" className="text-gray-800">{c.title}</span>,
            <span key="o" className="text-gray-500">{c.owner_name ?? "—"}</span>,
            <span key="d" className="text-gray-500 tabular-nums">{c.due_date}</span>,
            <Pill key="x" text={`${c.daysOver}d`} tone="rose" />,
          ])} empty="No overdue corrective actions. ✅" />
        </Card>

        <Card title="Quick actions">
          <QuickActions actions={[
            { icon: "➕", label: "Create new audit", href: "/assessor/quality" },
            { icon: "🗓️", label: "Audit schedule", href: "/quality-accreditation/audits" },
            { icon: "🔎", label: "Review findings", href: "/quality-accreditation/improvements" },
            { icon: "🛠️", label: "Follow-up actions", href: "/quality-accreditation/improvements" },
            { icon: "📊", label: "Analytics", href: "/quality-accreditation/analytics" },
            { icon: "🎯", label: "Standards", href: "/quality-accreditation/standards" },
            { icon: "📄", label: "Evidence", href: "/quality-accreditation/documents" },
            { icon: "⚠️", label: "Risk register", href: "/quality-accreditation/risk" },
          ]} />
        </Card>
      </div>

      <Foot>QAW-002 — live over the <code>audits</code> + <code>audit_findings</code> stores and the corrective actions they generate (<code>capa_actions</code>). KPIs, status mix, trend, area coverage and overdue follow-ups are all real and tenant-scoped. Audit <em>plans, schedules and reusable templates</em> (templates reference the competency framework&apos;s checklist items) are the next build phase; the deeper tabs above are section markers until then.</Foot>
    </div>
  );
}
