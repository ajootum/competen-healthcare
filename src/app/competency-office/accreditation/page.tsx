import { fetchCmoSuite, pct, STATUS_TONE } from "@/lib/competency/cmo-suite";
import { cmoGuard, Head, Card, Kpi, Donut, Progress, Pill, Provision, Foot } from "../_cmo-ui";

export const dynamic = "force-dynamic";

// CMO-016 External Accreditation Mapping Centre — map competency frameworks to JCI/SafeCare/MOH/etc. standards.
/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUS_COLORS: Record<string, string> = { compliant: "#22c55e", partial: "#f59e0b", gap: "#ef4444", not_mapped: "#94a3b8" };

export default async function AccreditationPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await fetchCmoSuite(admin, hid, isSuper);
  const head = <Head code="CMO-016 · Competency Office" title="External Accreditation Mapping Centre" sub="Map competency frameworks to external accreditation, regulatory and licensing standards — continuous compliance and traceability across tenants." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="Accreditation Mapping" part="part 2" /></div>;

  const accr = d.accreditations;
  const byStatus = ["compliant", "partial", "gap", "not_mapped"].map(s => ({ status: s, n: accr.filter((a: any) => a.compliance_status === s).length })).filter(x => x.n > 0);
  const byStandard = Object.entries(accr.reduce((acc: Record<string, { n: number; cov: number }>, a: any) => { const g = acc[a.standard] ?? { n: 0, cov: 0 }; g.n++; g.cov += Number(a.coverage_pct || 0); acc[a.standard] = g; return acc; }, {})).map(([standard, g]: any) => ({ standard, n: g.n, coverage: Math.round(g.cov / g.n) }));
  const gaps = accr.filter((a: any) => ["gap", "not_mapped"].includes(a.compliance_status));
  const avgCoverage = accr.length ? Math.round(accr.reduce((a: number, x: any) => a + Number(x.coverage_pct || 0), 0) / accr.length) : 0;

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Mappings" value={accr.length} sub="requirements" />
        <Kpi label="Compliant" value={accr.filter((a: any) => a.compliance_status === "compliant").length} sub={`${accr.length ? pct(accr.filter((a: any) => a.compliance_status === "compliant").length, accr.length) : 0}%`} tone="text-[var(--cmp-text-success)]" />
        <Kpi label="Partial" value={accr.filter((a: any) => a.compliance_status === "partial").length} sub="in progress" tone="text-[var(--cmp-text-warning)]" />
        <Kpi label="Gaps" value={gaps.length} sub="need action" tone={gaps.length ? "text-[var(--cmp-text-error)]" : undefined} />
        <Kpi label="Avg Coverage" value={`${avgCoverage}%`} sub="across standards" />
        <Kpi label="Standards" value={byStandard.length} sub="frameworks" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Compliance">
          <div className="flex items-center gap-3">
            <Donut segs={byStatus.map(s => ({ n: s.n, color: STATUS_COLORS[s.status] }))} total={accr.length} centre={accr.length} sub="mappings" size={100} />
            <div className="flex-1 space-y-1 text-[11px]">{byStatus.map(s => <div key={s.status} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS[s.status] }} /><span className="text-gray-600 flex-1 capitalize">{s.status.replace(/_/g, " ")}</span><span className="font-semibold text-gray-900">{s.n}</span></div>)}</div>
          </div>
        </Card>

        <Card title="Coverage by Standard" className="xl:col-span-2">
          <div className="space-y-2.5">{byStandard.map((s: any) => (
            <div key={s.standard}><div className="flex items-center justify-between text-[12px] mb-0.5"><span className="text-gray-700">{s.standard} <span className="text-gray-400 text-[10px]">({s.n} requirements)</span></span><span className="font-semibold text-gray-900">{s.coverage}%</span></div><Progress pct={s.coverage} tone={s.coverage >= 90 ? "bg-[var(--cmp-color-success)]" : s.coverage >= 70 ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-error)]"} /></div>
          ))}</div>
        </Card>
      </div>

      <Card title="Compliance Gaps" right={<span className="text-[11px] text-gray-400">{gaps.length} to close</span>}>
        {gaps.length ? <div className="space-y-1">
          <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="w-20">Standard</span><span className="flex-1">Requirement</span><span className="w-40">Mapped Competency</span><span className="w-16 text-right">Coverage</span><span className="w-20 text-right">Status</span></div>
          {gaps.map((a: any) => (
            <div key={a.id} className="flex items-center px-1 py-1 text-[12px] border-b border-gray-50"><span className="w-20 text-gray-700">{a.standard}</span><span className="flex-1 text-gray-800 truncate">{a.requirement}</span><span className="w-40 text-gray-500 truncate text-[11px]">{a.mapped_competency ?? "—"}</span><span className="w-16 text-right tabular-nums text-[var(--cmp-text-error)] font-semibold">{Math.round(Number(a.coverage_pct || 0))}%</span><span className="w-20 text-right"><Pill text={a.compliance_status} tone={STATUS_TONE[a.compliance_status]} /></span></div>
          ))}
        </div> : <p className="text-sm text-gray-400 py-4 text-center">All requirements mapped &amp; compliant. ✅</p>}
      </Card>

      <Foot>CMO-016 — accreditation mapping over cmo_accreditations (JCI / SafeCare / MOH / ANCC). Coverage, compliance status and gaps are real; the crosswalk manager, version-impact analysis and on-demand evidence-export packs are the next phase.</Foot>
    </div>
  );
}
