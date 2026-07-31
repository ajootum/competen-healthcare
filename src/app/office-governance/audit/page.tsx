import { ogsGuard, Head, Stat, Card, Pill, Donut, Legend, Trend, Ring, Table, Foot, ragPct } from "../_ui";
import { loadOgsAudit } from "@/lib/ogs/audit";

export const dynamic = "force-dynamic";

// OGS-008 Office Audit, Records & Compliance — the immutable governance audit trail + obligations compliance,
// unified into one records-and-compliance surface. Live over audit_log / gov_obligations / domain_events /
// quality_score_snapshots; the record-management layer (repository, retention, legal hold, e-signatures) is next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
const LIFECYCLE: [string, string, string][] = [
  ["📝", "Create", "Record captured"],
  ["🏷️", "Classify", "Category & retention"],
  ["🔍", "Review", "Accuracy checked"],
  ["✅", "Approve", "Governance sign-off"],
  ["🗄️", "Store", "Secured repository"],
  ["📅", "Retain", "Retention schedule"],
  ["📦", "Archive", "Long-term hold"],
];
const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

export default async function OgsAuditPage() {
  const { admin, isSuper, hid } = await ogsGuard();
  const d = await loadOgsAudit(admin, hid, isSuper);
  const head = <Head code="OGS-008 · Office Governance System" title="Office Audit, Records & Compliance" sub="Manage governance records, audit trails, compliance and regulatory evidence in one place." />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Card><p className="text-sm text-gray-400">The audit trail (<code>audit_log</code>) is not provisioned yet.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      {d.empty && <div className="bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded-xl p-3 text-[12px] text-blue-800">No audit records captured yet — records, categories and the activity feed populate as governance actions are written to <code>audit_log</code>. Compliance and frameworks below draw on <code>gov_obligations</code>.</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="🗂️" tone="teal" label="Total records" value={k.totalRecords} sub="audit trail" />
        <Stat icon="🧾" tone="blue" label="Audit-trail events" value={k.events90} sub="last 90 days" />
        <Stat icon="🛡️" tone={k.complianceRate != null ? ragPct(k.complianceRate) : "slate"} label="Compliance rate" value={k.complianceRate != null ? `${k.complianceRate}%` : "—"} sub="of assessed" />
        <Stat icon="✅" tone="emerald" label="Compliant records" value={k.compliantCount} sub="obligations" />
        <Stat icon="📡" tone="indigo" label="Domain events" value={k.domainEvents} sub="immutable" />
        <Stat icon="📚" tone="violet" label="Compliance frameworks" value={k.frameworkCount} sub="compliance domains" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Records by category" right="by entity type">
          {d.categories.length ? <div className="flex items-center gap-2">
            <Donut segments={d.categories} total={d.catTotal} label="Records" size={130} />
            <Legend items={d.categories.map((c: any) => ({ label: c.label, value: c.value, tone: c.tone, pct: d.catTotal ? Math.round((c.value / d.catTotal) * 100) : 0 }))} />
          </div> : <p className="text-sm text-gray-400 py-8 text-center">No audit records yet.</p>}
        </Card>

        <Card title="Compliance overview" right="audit compliance score" className="xl:col-span-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
            <div className="sm:col-span-2">
              {d.complianceTrend.length >= 2
                ? <Trend points={d.complianceTrend.map((t: any) => t.value)} labels={d.complianceTrend.map((t: any) => t.label)} tone="teal" suffix="%" />
                : <p className="text-sm text-gray-400 py-8 text-center">Not enough snapshot history for a trend yet — the 6-month compliance-score line populates from <code>quality_score_snapshots</code>.</p>}
            </div>
            <div className="flex flex-col items-center gap-1 sm:border-l sm:border-gray-100 sm:pl-4">
              {k.complianceRate != null ? <Ring pct={k.complianceRate} size={96} /> : <span className="text-3xl font-bold text-gray-300">—</span>}
              <span className="text-[11px] font-medium text-gray-600">Obligation compliance</span>
              <span className="text-[10px] text-gray-400 tabular-nums">{k.compliantCount} of {k.assessedCount} assessed</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Audit trail activity" right="most recent" className="xl:col-span-2">
          <Table cols={["Time", "Actor", "Action", "Type", "Entity"]} rows={d.recentActivity.map((a: any) => [
            a.when ? new Date(a.when).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—",
            a.actor ?? "system",
            a.action || "—",
            a.entityType ? <Pill text={a.entityType} tone="slate" /> : "—",
            a.entityName ?? "—",
          ])} empty="No audit records yet." />
        </Card>

        <Card title="Evidence & compliance frameworks" right="by domain">
          {d.frameworks.length ? <div className="space-y-2">{d.frameworks.map((f: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[12.5px]">
              <span className="text-gray-700 flex-1 truncate">{pretty(f.label)}</span>
              <span className="text-gray-400 tabular-nums shrink-0">{f.compliant}/{f.total}</span>
              <Pill text={`${f.pct}%`} tone={ragPct(f.pct)} />
            </div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No governance obligations recorded yet.</p>}
          <p className="text-[10px] text-gray-400 mt-3">Compliance % = obligations marked compliant ÷ total in each governance domain (<code>gov_obligations</code>).</p>
        </Card>
      </div>

      <Card title="Record lifecycle" right="reference model">
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {LIFECYCLE.map(([icon, label, sub], i) => (
            <div key={i} className="flex items-center gap-1 shrink-0">
              <div className="flex flex-col items-center text-center w-24">
                <span className="w-9 h-9 rounded-full bg-teal-50 flex items-center justify-center text-base">{icon}</span>
                <span className="text-[11px] font-medium text-gray-800 mt-1">{label}</span>
                <span className="text-[9px] text-gray-400 leading-tight">{sub}</span>
              </div>
              {i < LIFECYCLE.length - 1 && <span className="text-gray-300">→</span>}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-2">A static reference model. Governance-records lifecycle automation — classification, retention schedules, legal hold and digital signatures — is the next-phase OGS-008 record-management layer.</p>
      </Card>

      <Foot>OGS-008 — live over <code>audit_log</code> (the immutable governance trail: total records, 90-day event volume, category mix and the activity feed), <code>domain_events</code> (immutable domain-event count), <code>gov_obligations</code> (compliance rate, compliant records and per-domain compliance) and <code>quality_score_snapshots</code> (the 6-month compliance-score trend) — all tenant-scoped. A dedicated governance-records repository, retention schedules, legal hold and digital signatures are the next-phase OGS-008 record-management layer; only the audit trail and obligations are real today.</Foot>
    </div>
  );
}
