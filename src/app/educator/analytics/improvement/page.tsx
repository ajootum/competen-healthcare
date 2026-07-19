import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadImprovementCenter } from "@/lib/improvement-center";
import ImprovementNav from "./ImprovementNav";
import { MODULES } from "./modules";

// Improvement & Action Center landing. Executive action cards, CAPA status and
// risk severity, plus the three module cards. CAPA and educational risks are
// live; the improvement-plan store isn't built yet.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";

export default async function ImprovementLanding() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadImprovementCenter(admin, hospitalId ?? "");
  const E = d.exec;

  const summary = [
    { icon: "📋", tint: "bg-purple-50 text-purple-600", label: "Active Improvement Plans", value: "—", sub: "no plan store" },
    { icon: "🔧", tint: "bg-blue-50 text-blue-600", label: "Open CAPAs", value: String(E.openCapas) },
    { icon: "⚠️", tint: "bg-red-50 text-red-600", label: "Critical Risks", value: String(E.criticalRisks) },
    { icon: "⏰", tint: "bg-orange-50 text-orange-600", label: "Overdue Actions", value: String(E.overdueActions), sub: "CAPA" },
    { icon: "🎯", tint: "bg-teal-50 text-teal-600", label: "Action Completion", value: pct(E.completionRate) },
    { icon: "🔗", tint: "bg-green-50 text-green-600", label: "Effectiveness Verified", value: "—", sub: "soon" },
    { icon: "🛡️", tint: "bg-indigo-50 text-indigo-600", label: "Risk Reduction", value: "—", sub: "soon" },
    { icon: "⭐", tint: "bg-amber-50 text-amber-600", label: "Overall Improvement", value: E.overallScore !== null ? String(E.overallScore) : "—", sub: "/100" },
  ];
  const metric: Record<string, string> = {
    plans: "no store — soon",
    capa: `${d.capa.cards.total} CAPAs · ${d.capa.cards.open} open`,
    risks: `${d.risks.cards.total} risks · ${d.risks.cards.critical} critical`,
  };

  const donut = (data: { label: string; n: number; color: string }[], center: string) => {
    const total = data.reduce((s, x) => s + x.n, 0);
    const Circ = 2 * Math.PI * 40;
    const pcts = data.map(x => total ? (x.n / total) * 100 : 0);
    const arcs = data.map((x, i) => ({ ...x, off: pcts.slice(0, i).reduce((s, p) => s + p, 0), p: pcts[i] }));
    return { total, Circ, arcs, center };
  };
  const cap = donut(d.capa.byStatus, "CAPAs");
  const rsk = donut(d.risks.bySeverity, "Risks");

  return (
    <div className="max-w-[1200px]">
      <ImprovementNav active="overview" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {summary.map(c => (
          <div key={c.label} className="bg-white border border-gray-100 rounded-2xl p-4">
            <span className={`w-9 h-9 rounded-full flex items-center justify-center text-base ${c.tint}`}>{c.icon}</span>
            <p className="text-2xl font-extrabold text-gray-900 leading-tight mt-2.5">{c.value}</p>
            <p className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</p>
            {c.sub && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{c.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5 items-start">
        {[["CAPA by Status", cap, d.capa.byStatus] as const, ["Risks by Severity", rsk, d.risks.bySeverity] as const].map(([title, g, data]) => (
          <div key={title} className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-3">{title}</h2>
            {g.total === 0 ? <p className="text-xs text-gray-400 py-6 text-center">No data yet.</p> : (
              <div className="flex items-center gap-4">
                <div className="relative w-24 shrink-0"><svg viewBox="0 0 100 100" className="w-full -rotate-90"><circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />{g.arcs.filter(a => a.p > 0).map(a => <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12" strokeDasharray={`${(a.p / 100) * g.Circ} ${g.Circ}`} strokeDashoffset={-(a.off / 100) * g.Circ} />)}</svg><div className="absolute inset-0 flex flex-col items-center justify-center"><p className="text-lg font-extrabold text-gray-900">{g.total}</p><p className="text-[8px] text-gray-400">{g.center}</p></div></div>
                <div className="flex flex-col gap-1 flex-1">{data.map(x => <div key={x.label} className="flex items-center gap-2 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: x.color }} /><span className="text-gray-500 flex-1 capitalize">{x.label}</span><span className="font-bold text-gray-800">{x.n}</span></div>)}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Module cards */}
      <h2 className="text-sm font-bold text-gray-900 mb-3">Modules</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {MODULES.map(m => (
          <Link key={m.id} href={`/educator/analytics/improvement/${m.id}`} className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-purple-200 hover:shadow-sm transition-all">
            <div className="flex items-center gap-2 mb-2"><span className={`w-9 h-9 rounded-lg flex items-center justify-center text-base ${m.tint}`}>{m.icon}</span><span className="text-[10px] font-bold text-gray-300">{m.n}</span></div>
            <p className="text-[12px] font-bold text-gray-800">{m.name}</p>
            <p className="text-[10px] text-gray-400 mt-1 leading-snug">{m.desc}</p>
            <p className="text-[11px] font-semibold text-gray-600 mt-2">{metric[m.id]}</p>
            <p className={`text-[11px] font-semibold mt-1 ${m.accent}`}>Open →</p>
          </Link>
        ))}
      </div>

      <p className="text-[10px] text-gray-400 mt-5">
        The execution layer turns findings into action. CAPA and educational risks are live — CAPA from corrective-action records, risks derived from competency
        decisions (critical failures, not-yet-competent, expired) and audit findings. A guided improvement-plan builder, effectiveness verification and a configurable
        5×5 risk register need stores not yet built and are shown as honest &ldquo;soon&rdquo; states.
      </p>
    </div>
  );
}
