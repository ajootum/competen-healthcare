import { qaGuard, Head, Stat, Card, Pill, Donut, Legend, Trend, Bars, Table, QuickActions, Foot, T, ragPct } from "./_ui";
import { loadQualityDashboard } from "@/lib/quality-accreditation-data";
import { loadStandards } from "@/lib/qaw/standards";
import { loadRiskCentre } from "@/lib/qaw/risk-centre";
import { officeForWorkspace } from "@/lib/ogs/office";
import { GovernanceBanner } from "@/components/GovernanceBanner";
import Link from "next/link";
import UnavailableNotice from "@/components/UnavailableNotice";

export const dynamic = "force-dynamic";

// Quality & Accreditation Workspace — command-centre overview aggregating the 14 QAW modules over
// real tenant-scoped data. Every KPI links into the module that owns it.
/* eslint-disable @typescript-eslint/no-explicit-any */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS_TONE: Record<string, string> = { completed: "emerald", in_progress: "amber", planned: "slate" };

export default async function QualityDashboard() {
  const { admin, user, isSuper, hid, fullName } = await qaGuard();
  const [core, standards, risk, office] = await Promise.all([
    loadQualityDashboard(admin, hid, isSuper),
    loadStandards(admin, hid, isSuper),
    loadRiskCentre(admin, hid, isSuper),
    officeForWorkspace(admin, "quality", hid, isSuper, user.id),
  ]);

  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? "00000000-0000-0000-0000-000000000000"));
  const { data: auditRows } = await scope(admin.from("audits").select("title, audit_type, area, status, compliance_pct, conducted_at").order("conducted_at", { ascending: false }).limit(6));
  const recentAudits = (auditRows ?? []) as any[];

  // Compliance & quality trend from daily snapshots.
  let trend: { label: string; value: number }[] = [];
  try {
    const { data: snaps } = await scope(admin.from("quality_score_snapshots").select("snapshot_date, compliance_score").order("snapshot_date", { ascending: false }).limit(180));
    const byMonth = new Map<string, number>();
    (snaps ?? []).forEach((s: any) => { const k = String(s.snapshot_date).slice(0, 7); if (!byMonth.has(k) && s.compliance_score != null) byMonth.set(k, Math.round(Number(s.compliance_score))); });
    trend = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([k, v]) => ({ label: MONTHS[Number(k.slice(5, 7)) - 1], value: v }));
  } catch { /* optional */ }

  // ⚠ A DONUT CANNOT DRAW "UNKNOWN". When the corrective-action table could not be read these figures are
  // null, and rendering them as 0 would draw an empty ring captioned "0 open actions" — the most confident
  // possible statement about data nobody has. The chart is therefore replaced below, not fed zeros.
  const capaUnknown = core.capa.open == null || core.capa.overdue == null;
  const capaOpen = core.capa.open ?? 0, overdue = core.capa.overdue ?? 0, onTrack = Math.max(0, capaOpen - overdue);
  const planDonut = [
    { label: "On track", value: onTrack, tone: "emerald" },
    { label: "Overdue", value: overdue, tone: "rose" },
  ];
  const stdMet = standards.provisioned ? standards.kpis.overall : null;
  const highRisks = risk.provisioned ? risk.kpis.extreme + risk.kpis.high : 0;

  return (
    <div className="space-y-4">
      <Head title="Quality & Accreditation" sub={`Clinical quality, accreditation readiness, audits and improvement · ${fullName}`} action={{ label: "Open AI copilot →", href: "/quality-accreditation/ai" }} />

      {/* OGS R001 — this workspace operates as a governed Office */}
      <GovernanceBanner office={office} />

      <UnavailableNotice sources={core.unavailable} what="quality figures" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon="📋" tone={core.complianceScore != null ? ragPct(core.complianceScore) : "slate"} label="Compliance score" value={core.complianceScore != null ? `${core.complianceScore}%` : "—"} sub="mean audit compliance" />
        <Stat icon="🎯" tone={stdMet != null ? ragPct(stdMet) : "slate"} label="Standards met" value={stdMet != null ? `${stdMet}%` : "—"} sub="of assessed" />
        {/* An unread findings or CAPA table shows the em dash these tiles already use for a missing figure. */}
        <Stat icon="⚠️" tone="rose" label="Open critical findings" value={core.findings.critical ?? "—"} sub={core.findings.open == null ? "could not be read" : `${core.findings.open} open total`} />
        <Stat icon="🛠️" tone={overdue ? "rose" : "amber"} label="Open improvement actions" value={core.capa.open ?? "—"} sub={core.capa.open == null ? "could not be read" : `${overdue} overdue`} />
        <Stat icon="📋" tone="blue" label="Audits" value={core.audits.total} sub={`${core.audits.completed} completed`} />
        <Stat icon="📈" tone="teal" label="Improvement projects" value={core.improvements.active} sub={`${core.improvements.total} total`} />
        <Stat icon="📏" tone="indigo" label="Active indicators" value={core.indicators} sub={`${core.standards} standards`} />
        <Stat icon="🔴" tone={highRisks ? "rose" : "emerald"} label="High risks" value={highRisks} sub="register high/extreme" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Audit activity" className="xl:col-span-2" right={<Link href="/quality-accreditation/audits" className="text-teal-600 hover:underline">View all →</Link>}>
          <Table cols={["Audit", "Type", "Area", "Compliance", "Status"]} rows={recentAudits.map((a: any) => [
            <span key="t" className="font-medium text-gray-800">{a.title}</span>,
            <span key="ty" className="text-gray-500 capitalize">{(a.audit_type ?? "").replace(/_/g, " ")}</span>,
            <span key="ar" className="text-gray-500">{a.area ?? "—"}</span>,
            <span key="c" className={`font-semibold tabular-nums ${a.compliance_pct != null ? T(ragPct(Number(a.compliance_pct))).text : "text-gray-300"}`}>{a.compliance_pct != null ? `${Math.round(Number(a.compliance_pct))}%` : "—"}</span>,
            <Pill key="s" text={(a.status ?? "").replace(/_/g, " ")} tone={STATUS_TONE[a.status] ?? "slate"} />,
          ])} empty="No audits recorded yet." />
        </Card>

        <Card title="Improvement plan status">
          {capaUnknown ? (
            <p className="rounded-lg border border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)] px-3 py-4 text-sm text-rose-800">
              <strong>The corrective-action register could not be read.</strong> No chart is drawn here, because an empty ring labelled “0 open actions” would be a confident claim about data nobody has.
            </p>
          ) : (
          <div className="flex items-center gap-3">
            <Donut segments={planDonut} total={capaOpen} label="Open actions" size={130} />
            <Legend items={[...planDonut.map((s: any) => ({ label: s.label, value: s.value, tone: s.tone })), { label: "High priority", value: core.capa.critical ?? 0, tone: "amber" }, { label: "Active projects", value: core.improvements.active, tone: "blue" }]} />
          </div>
          )}
          <p className="text-[11px] text-gray-400 mt-2"><Link href="/quality-accreditation/improvements" className="text-teal-600 hover:underline">Manage improvement plans →</Link></p>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Compliance trend" className="xl:col-span-2" right="last 6 months">
          {trend.length >= 2 ? <><Trend points={trend.map((t: any) => t.value)} labels={trend.map((t: any) => t.label)} tone="teal" suffix="%" target={85} /><p className="text-[10px] text-gray-400 text-center mt-1">Compliance score per month (daily snapshots) · dashed = 85% target.</p></> : <p className="text-sm text-gray-400 py-8 text-center">Not enough snapshot history yet for a trend.</p>}
        </Card>

        <Card title="Standards compliance by framework">
          {standards.provisioned && standards.byFramework.length ? <Bars items={standards.byFramework.map((f: any) => ({ label: f.label, pct: f.pct, tone: f.tone, value: `${f.pct}%` }))} /> : <p className="text-sm text-gray-400 py-6 text-center">No framework assessments yet.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Top risk categories" right={<Link href="/quality-accreditation/risk" className="text-teal-600 hover:underline">Risk register →</Link>}>
          {risk.provisioned && risk.byCategory.length ? <Bars items={risk.byCategory.slice(0, 6).map((c: any) => ({ label: c.label, pct: risk.kpis.total ? Math.round((c.value / risk.kpis.total) * 100) : 0, tone: c.tone, value: c.value }))} /> : <p className="text-sm text-gray-400 py-6 text-center">No risks registered.</p>}
        </Card>

        <Card title="AI Quality Insight">
          <div className="bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-100 rounded-lg p-3">
            <p className="text-[13px] text-gray-800 leading-relaxed">
              {core.findings.critical ? `${core.findings.critical} critical audit finding${core.findings.critical > 1 ? "s" : ""} and ` : ""}
              {overdue ? `${overdue} overdue action${overdue > 1 ? "s" : ""} ` : "no overdue actions "}
              need attention. {highRisks ? `${highRisks} high/extreme risk${highRisks > 1 ? "s are" : " is"} open on the register.` : "The risk register is stable."}
            </p>
            <Link href="/quality-accreditation/ai" className="mt-2 inline-block text-[12px] font-medium text-violet-700 hover:underline">Ask the live quality copilot →</Link>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Snapshot is rule-based; the AI centre runs a real LLM grounded in this data.</p>
        </Card>

        <Card title="Jump to a module">
          <QuickActions actions={[
            { icon: "🎯", label: "Standards", href: "/quality-accreditation/standards" },
            { icon: "📋", label: "Audits", href: "/quality-accreditation/audits" },
            { icon: "✅", label: "Compliance", href: "/quality-accreditation/compliance" },
            { icon: "📏", label: "Indicators", href: "/quality-accreditation/indicators" },
            { icon: "🗂️", label: "Readiness", href: "/quality-accreditation/readiness" },
            { icon: "🚑", label: "Safety", href: "/quality-accreditation/safety" },
            { icon: "🏛️", label: "Governance", href: "/quality-accreditation/governance" },
            { icon: "🧾", label: "Audit trail", href: "/quality-accreditation/audit-trail" },
          ]} />
        </Card>
      </div>

      <Foot>Quality & Accreditation command centre — every figure is live and tenant-scoped, aggregated across the 14 QAW modules (audits, findings, CAPA, improvement projects, standards assessments, indicators and the risk register); the compliance trend reads the daily <code>quality_score_snapshots</code>. Each KPI and panel links into the module that owns it.</Foot>
    </div>
  );
}
