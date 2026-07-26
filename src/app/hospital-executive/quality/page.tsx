import { hexGuard, Head, Tabs, Stat, Card, Donut, Legend, Trend, Bars, Foot, T } from "../_ui";
import { loadExecQuality } from "@/lib/hex/quality";
import Link from "next/link";

export const dynamic = "force-dynamic";

// HEX-007 Quality & Clinical Governance (executive lens).
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Safety", "Clinical Governance", "Compliance", "Audits", "Improvement", "Analytics", "Benchmarking", "Reports"];

export default async function ExecQualityPage() {
  const { admin, isSuper, hid } = await hexGuard();
  const d = await loadExecQuality(admin, hid, isSuper);
  const head = <Head code="HEX-007 · Hospital Executive" title="Quality & Clinical Governance" sub="Excellence in care. Safety always. Continuous improvement." action={{ label: "Quality workspace →", href: "/quality-accreditation" }} />;
  const k = d.kpis;
  const q = (v: any, suffix = "%") => (v != null ? `${Math.round(Number(v))}${suffix}` : "—");

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Stat icon="🏅" tone={k.overallQuality != null && Number(k.overallQuality) >= 85 ? "emerald" : "amber"} label="Overall quality score" value={q(k.overallQuality, "")} sub="composite" />
        <Stat icon="🛡️" tone="emerald" label="Patient safety score" value={q(k.safetyScore)} />
        <Stat icon="⚠️" tone="amber" label="Harm events (month)" value={k.harm} />
        <Stat icon="🚨" tone={k.serious ? "rose" : "emerald"} label="Serious incidents" value={k.serious} sub="this month" />
        <Stat icon="🛠️" tone="violet" label="Open CAPAs" value={k.openCapa} />
        <Stat icon="📋" tone="teal" label="Audit compliance" value={q(k.auditCompliance)} />
        <Stat icon="🎖️" tone="blue" label="Accreditation readiness" value={q(k.accreditation)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Quality domains performance" className="xl:col-span-1" right="% meeting target">
          {d.domains.length ? <Bars items={d.domains.map((x: any) => ({ label: x.label, pct: x.pct, value: `${x.pct}%` }))} /> : <p className="text-sm text-gray-400 py-6 text-center">No indicator data yet.</p>}
        </Card>

        <Card title="Top quality alerts">
          <div className="space-y-2">
            {d.alerts.map((a: any, i: number) => (
              <div key={i} className="flex items-start gap-2 border border-gray-100 rounded-lg p-2.5">
                <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${T(a.tone).dot}`} />
                <div className="min-w-0 flex-1"><p className="text-[12.5px] font-medium text-gray-800 leading-snug">{a.title}</p><p className="text-[11px] text-gray-500">{a.detail}</p></div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Compliance & accreditation">
          {d.accreditation.length ? <Bars items={d.accreditation.map((f: any) => ({ label: f.label, pct: f.pct, tone: f.tone, value: `${f.pct}%` }))} /> : <p className="text-sm text-gray-400 py-6 text-center">No framework assessments yet.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Quality trend" className="xl:col-span-2" right="last 6 months">
          {d.trend.length >= 2 ? <><Trend points={d.trend.map((t: any) => t.value)} labels={d.trend.map((t: any) => t.label)} tone="teal" suffix="" target={85} /><p className="text-[10px] text-gray-400 text-center mt-1">Composite quality score per month (daily snapshots) · dashed = 85% target.</p></> : <p className="text-sm text-gray-400 py-8 text-center">Not enough snapshot history yet.</p>}
        </Card>

        <Card title="Improvement portfolio">
          <div className="flex items-center gap-3">
            <Donut segments={d.improvement.donut} total={d.improvement.total} label="Projects" size={130} />
            <Legend items={[...d.improvement.donut.map((s: any) => ({ label: s.label, value: s.value, tone: s.tone })), ...(d.indicators ? [{ label: "Indicators met", value: d.indicators.met, tone: "emerald" }, { label: "Below target", value: d.indicators.below, tone: "rose" }] : [])]} />
          </div>
          <p className="text-[10px] text-gray-400 mt-2"><Link href="/quality-accreditation/improvements" className="text-teal-600 hover:underline">Improvement & CAPA →</Link></p>
        </Card>
      </div>

      <Foot>HEX-007 — executive lens composing the Quality &amp; Accreditation workspace: <code>loadQualityDashboard</code> (audits/findings/CAPA/improvement), <code>gov_standard_assessments</code> (accreditation by framework), <code>indicator_measurements</code> (domain performance), the daily <code>quality_score_snapshots</code> (quality/safety trend) and this-month <code>op_incidents</code> (harm/serious). All live and tenant-scoped; every panel reconciles with the underlying <Link href="/quality-accreditation" className="text-teal-600 hover:underline">Quality workspace</Link>.</Foot>
    </div>
  );
}
