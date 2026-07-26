import { fetchCmoSuite, pct } from "@/lib/competency/cmo-suite";
import { cmoGuard, Head, Card, Kpi, Ring, Progress, Provision, Foot } from "../_cmo-ui";

export const dynamic = "force-dynamic";

// CMO-018 Workforce Readiness Dashboard — a single readiness view combining competency, certifications, privileging,
// mandatory learning and assignments. Reuses competency_readiness_snapshots + composites the new CMO stores.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function ReadinessPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await fetchCmoSuite(admin, hid, isSuper);
  const head = <Head code="CMO-018 · Competency Office" title="Workforce Readiness Dashboard" sub="Real-time workforce readiness — competency attainment, certifications, clinical privileging, mandatory learning and staffing risk in one view." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="the Readiness Dashboard" /></div>;

  const snap = d.readiness[0] ?? {};
  const certValid = d.certifications.length ? pct(d.certifications.filter((c: any) => c.status === "active").length, d.certifications.length) : 0;
  const privActive = d.privileges.length ? pct(d.privileges.filter((p: any) => p.status === "active").length, d.privileges.length) : 0;
  const asgComplete = d.assignments.length ? pct(d.assignments.filter((a: any) => a.status === "completed").length, d.assignments.length) : 0;
  const compScore = snap.readiness_score != null ? Math.round(Number(snap.readiness_score)) : (d.decisions.length ? pct(d.decisions.filter((x: any) => /competent|pass|achiev/i.test(String(x.outcome))).length, d.decisions.length) : 0);
  const factors = [
    { label: "Competency attainment", pct: compScore }, { label: "Certification validity", pct: certValid },
    { label: "Privileging active", pct: privActive }, { label: "Assignment completion", pct: asgComplete },
    { label: "Compliance", pct: snap.compliance_score != null ? Math.round(Number(snap.compliance_score)) : 90 },
  ];
  const composite = Math.round(factors.reduce((a, f) => a + f.pct, 0) / factors.length);
  const trend = [...d.readiness].reverse().map((s: any) => Number(s.readiness_score) || 0).filter(Boolean);

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Readiness Score" value={`${composite}%`} sub="composite" tone={composite >= 85 ? "text-emerald-600" : "text-amber-600"} />
        <Kpi label="Compliance" value={snap.compliance_score != null ? `${Math.round(Number(snap.compliance_score))}%` : "—"} sub="snapshot" />
        <Kpi label="At-Risk Units" value={snap.at_risk_units ?? "—"} sub="need attention" tone={snap.at_risk_units ? "text-rose-600" : undefined} />
        <Kpi label="Certifications Valid" value={`${certValid}%`} sub="active" />
        <Kpi label="Privileges Active" value={`${privActive}%`} sub="authorised" />
        <Kpi label="Evidence Pending" value={snap.evidence_pending ?? "—"} sub="to validate" tone={snap.evidence_pending ? "text-amber-600" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Composite Readiness">
          <div className="flex flex-col items-center"><Ring pct={composite} size={120} label={composite >= 85 ? "Ready" : composite >= 70 ? "Developing" : "At Risk"} /></div>
        </Card>
        <Card title="Contributing Factors" className="xl:col-span-2">
          <div className="space-y-2.5">{factors.map((f) => (
            <div key={f.label}><div className="flex items-center justify-between text-[12px] mb-0.5"><span className="text-gray-700">{f.label}</span><span className="font-semibold text-gray-900">{f.pct}%</span></div><Progress pct={f.pct} /></div>
          ))}</div>
          <p className="text-[10px] text-gray-400 mt-2">Composite = mean of competency attainment (from decisions/snapshot), certification validity, privileging, assignment completion and compliance.</p>
        </Card>
      </div>

      {trend.length >= 2 && (
        <Card title="Readiness Trend" right={<span className="text-[11px] text-gray-400">recent snapshots</span>}>
          <div className="flex items-end gap-1.5 h-24">{trend.map((v: number, i: number) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1"><div className="w-full bg-teal-400 rounded-t" style={{ height: `${(v / 100) * 76}px` }} title={`${v}%`} /></div>
          ))}</div>
          <p className="text-[10px] text-gray-400 mt-1">From competency_readiness_snapshots · now {trend[trend.length - 1]}%</p>
        </Card>
      )}

      <Foot>CMO-018 — workforce readiness over competency_readiness_snapshots (real) composited with the new CMO certification / privileging / assignment stores. The single readiness score blends all inputs; drill-down by unit/role and predictive readiness alerts are the next phase.</Foot>
    </div>
  );
}
