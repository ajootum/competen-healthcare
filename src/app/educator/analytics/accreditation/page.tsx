import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAccreditationStandards } from "@/lib/accreditation-standards";
import AccreditationNav from "./AccreditationNav";
import { MODULES } from "./modules";

// Accreditation & Standards landing. Executive compliance cards, a status
// donut and the seven module cards. Live signals come from audits, CAPA and
// evidence; the standards-catalogue, report, mapping and document stores don't
// exist yet and are shown honestly.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";

export default async function AccreditationLanding() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadAccreditationStandards(admin, hospitalId ?? "");
  const E = d.exec;

  const summary = [
    { icon: "🛡️", tint: "bg-purple-50 text-purple-600", label: "Overall Compliance", value: pct(E.overallCompliance), sub: "recorded audits" },
    { icon: "📋", tint: "bg-green-50 text-green-600", label: "Accreditation Readiness", value: pct(E.accreditationReadiness) },
    { icon: "🗄️", tint: "bg-blue-50 text-blue-600", label: "Evidence Items", value: String(E.evidenceCount) },
    { icon: "✅", tint: "bg-teal-50 text-teal-600", label: "Audit Readiness", value: pct(E.auditReadiness) },
    { icon: "🚩", tint: "bg-red-50 text-red-600", label: "Findings", value: String(E.criticalFindings), sub: "non-compliant + critical" },
    { icon: "📄", tint: "bg-indigo-50 text-indigo-600", label: "Docs Due Review", value: "—", sub: "no document store" },
    { icon: "📈", tint: "bg-amber-50 text-amber-600", label: "Improvement Closure", value: pct(E.closureRate) },
  ];
  const distTotal = d.standards.distribution.reduce((s, x) => s + x.n, 0);
  const Circ = 2 * Math.PI * 40;
  const arcPcts = d.standards.distribution.map(x => distTotal ? (x.n / distTotal) * 100 : 0);
  const arcs = d.standards.distribution.map((x, i) => ({ ...x, off: arcPcts.slice(0, i).reduce((s, p) => s + p, 0), p: arcPcts[i] }));
  const metric: Record<string, string> = {
    standards: `${d.standards.cards.compliant} compliant · ${d.standards.cards.nonCompliant} non`,
    reports: "no store — soon",
    evidence: `${d.evidence.cards.total} evidence items`,
    mapping: "no store — soon",
    audit: `${pct(d.audit.cards.readinessScore)} · ${d.audit.cards.openFindings} findings`,
    documents: "no store — soon",
    improvement: `${d.improvement.cards.open} open · ${pct(d.improvement.cards.closureRate)} closed`,
  };

  return (
    <div className="max-w-[1200px]">
      <AccreditationNav active="overview" />

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">
        {summary.map(c => (
          <div key={c.label} className="bg-white border border-gray-100 rounded-2xl p-4">
            <span className={`w-9 h-9 rounded-full flex items-center justify-center text-base ${c.tint}`}>{c.icon}</span>
            <p className="text-2xl font-extrabold text-gray-900 leading-tight mt-2.5">{c.value}</p>
            <p className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</p>
            {c.sub && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{c.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5 items-start">
        {/* Compliance distribution */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Compliance Status</h2>
          {distTotal === 0 ? <p className="text-xs text-gray-400 py-6 text-center">No audits recorded yet.</p> : (
            <div className="flex items-center gap-4">
              <div className="relative w-24 shrink-0"><svg viewBox="0 0 100 100" className="w-full -rotate-90"><circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />{arcs.filter(a => a.p > 0).map(a => <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12" strokeDasharray={`${(a.p / 100) * Circ} ${Circ}`} strokeDashoffset={-(a.off / 100) * Circ} />)}</svg><div className="absolute inset-0 flex flex-col items-center justify-center"><p className="text-lg font-extrabold text-gray-900">{distTotal}</p><p className="text-[8px] text-gray-400">elements</p></div></div>
              <div className="flex flex-col gap-1 flex-1">{d.standards.distribution.map(x => <div key={x.label} className="flex items-center gap-2 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: x.color }} /><span className="text-gray-500 flex-1">{x.label}</span><span className="font-bold text-gray-800">{x.n}</span></div>)}</div>
            </div>
          )}
        </div>

        {/* Compliance by area */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Compliance by Area</h2>
          {d.standards.byArea.length === 0 ? <p className="text-xs text-gray-400">No audit areas recorded yet.</p> : (
            <div className="flex flex-col gap-1.5">{d.standards.byArea.map(a => (
              <div key={a.area} className="flex items-center gap-2"><span className="text-[10px] text-gray-500 w-36 truncate">{a.area}</span><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${a.pct >= 80 ? "bg-green-500" : a.pct >= 60 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${a.pct}%` }} /></div><span className="text-[10px] font-bold text-gray-600 w-9 text-right">{a.pct}%</span></div>
            ))}</div>
          )}
        </div>
      </div>

      {/* Module cards */}
      <h2 className="text-sm font-bold text-gray-900 mb-3">Modules</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {MODULES.map(m => (
          <Link key={m.id} href={`/educator/analytics/accreditation/${m.id}`} className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-purple-200 hover:shadow-sm transition-all">
            <div className="flex items-center gap-2 mb-2"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${m.tint}`}>{m.icon}</span><span className="text-[10px] font-bold text-gray-300">{m.n}</span></div>
            <p className="text-[12px] font-bold text-gray-800 leading-tight">{m.name}</p>
            <p className="text-[10px] text-gray-400 mt-1 leading-snug line-clamp-2">{m.desc}</p>
            <p className="text-[10px] font-semibold text-gray-600 mt-1.5">{metric[m.id]}</p>
            <p className={`text-[11px] font-semibold mt-1 ${m.accent}`}>Open →</p>
          </Link>
        ))}
      </div>

      <p className="text-[10px] text-gray-400 mt-5">
        Standards compliance, audit readiness and improvement tracking are live from recorded audits (measurable elements), evidence uploads and corrective actions (CAPA).
        A dedicated standards catalogue, accreditation-report builder, regulatory-mapping engine and quality-document store don&apos;t exist yet — those modules are shown as
        honest &ldquo;soon&rdquo; shells rather than with fabricated compliance figures.
      </p>
    </div>
  );
}
