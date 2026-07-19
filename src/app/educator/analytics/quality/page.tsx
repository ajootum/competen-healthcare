import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadProgramQuality } from "@/lib/program-quality";
import QualityNav from "./QualityNav";
import { MODULES } from "./modules";

// Program Quality landing (spec §Landing Page). Eight executive summary cards,
// quality trend, quality-by-domain and the eight module cards — live composite.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";

export default async function QualityLanding() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadProgramQuality(admin, hospitalId ?? "");
  const E = d.exec;

  const summary = [
    { icon: "🏅", tint: "bg-purple-50 text-purple-600", label: "Program Quality Index", value: pct(E.qualityIndex) },
    { icon: "📋", tint: "bg-blue-50 text-blue-600", label: "Accreditation Readiness", value: pct(E.accreditation) },
    { icon: "🛡️", tint: "bg-teal-50 text-teal-600", label: "Competency Attainment", value: pct(E.competencyAch) },
    { icon: "🎓", tint: "bg-green-50 text-green-600", label: "Learner Success", value: pct(E.learnerSuccess) },
    { icon: "👨‍🏫", tint: "bg-orange-50 text-orange-600", label: "Faculty Effectiveness", value: "—", sub: "no survey store" },
    { icon: "✅", tint: "bg-indigo-50 text-indigo-600", label: "Compliance Rate", value: pct(E.compliance) },
    { icon: "📈", tint: "bg-rose-50 text-rose-600", label: "Improvement Score", value: pct(E.improvement) },
    { icon: "🏆", tint: "bg-amber-50 text-amber-600", label: "Benchmark Ranking", value: "—", sub: E.benchmark },
  ];
  const trMax = 100;
  const metric: Record<string, string> = {
    program: `Index ${pct(d.program.cards.qualityIndex)} · ${d.program.cards.activeLearners} learners`,
    faculty: `${d.faculty.cards.count} faculty`,
    curriculum: `${pct(d.curriculum.cards.coverage)} coverage · ${pct(d.curriculum.cards.quality)} quality`,
    assessment: `${pct(d.assessment.cards.quality)} quality · ${pct(d.assessment.cards.passRate)} pass`,
    compliance: `${pct(d.compliance.cards.accreditation)} · ${d.compliance.capa.open} open CAPA`,
    benchmarking: "no external data",
    reviews: `${d.annualReviews.cards.actionsClosed} closed · ${d.annualReviews.cards.actionsOpen} open`,
    reports: `${d.reports.exports.length} live exports`,
  };
  const insights = [...d.program.insights, ...d.curriculum.insights, ...d.compliance.insights].slice(0, 4);

  return (
    <div className="max-w-[1200px]">
      <QualityNav active="overview" />

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
        {/* Quality trend */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Programme Quality Trend <span className="font-normal text-gray-400 text-xs">(6 mo)</span></h2>
          {d.program.trend.every(t => t.value === null) ? <p className="text-xs text-gray-400 py-8 text-center">No monthly history yet.</p> : (
            <svg viewBox="0 0 320 100" className="w-full">
              {[0, 50, 100].map(y => <line key={y} x1="22" x2="314" y1={82 - y * 0.7} y2={82 - y * 0.7} stroke="#f3f4f6" strokeWidth="1" />)}
              {(() => { const pts = d.program.trend.map((t, i) => ({ x: 40 + i * 48, y: t.value !== null ? 82 - (t.value / trMax) * 70 : null })); const line = pts.filter(p => p.y !== null) as { x: number; y: number }[]; return <>{line.length > 1 && <polyline fill="none" stroke="#9333ea" strokeWidth="1.5" points={line.map(p => `${p.x},${p.y}`).join(" ")} />}{line.map(p => <circle key={p.x} cx={p.x} cy={p.y} r="2.5" fill="#9333ea" />)}{d.program.trend.map((t, i) => <text key={i} x={40 + i * 48} y="96" fontSize="7" fill="#9ca3af" textAnchor="middle">{t.label}</text>)}</>; })()}
            </svg>
          )}
        </div>

        {/* Quality by domain */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Quality Score by Domain</h2>
          <div className="flex flex-col gap-1.5">{d.program.byDomain.map(b => (
            <div key={b.label} className="flex items-center gap-2 text-[10px]">
              <span className="text-gray-500 w-32 truncate">{b.label}</span>
              {b.backed && b.pct !== null ? <><div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${b.pct >= 80 ? "bg-green-500" : b.pct >= 60 ? "bg-blue-500" : b.pct >= 40 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${b.pct}%` }} /></div><span className="font-bold text-gray-700 w-8 text-right">{b.pct}%</span></> : <span className="flex-1 text-right text-[8px] font-bold uppercase text-gray-300">soon</span>}
            </div>
          ))}</div>
        </div>
      </div>

      {/* AI insights */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Executive Insights</h2><span className="ml-auto text-[8px] font-bold uppercase text-gray-300">rule-derived</span></div>
        {insights.length === 0 ? <p className="text-xs text-gray-400">No programme quality concerns detected. ✅</p> : <ul className="grid sm:grid-cols-2 gap-1.5">{insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
      </div>

      {/* Module cards */}
      <h2 className="text-sm font-bold text-gray-900 mb-3">Modules</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {MODULES.map(m => (
          <Link key={m.id} href={`/educator/analytics/quality/${m.id}`} className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-purple-200 hover:shadow-sm transition-all">
            <div className="flex items-center gap-2 mb-2"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${m.tint}`}>{m.icon}</span><span className="text-[10px] font-bold text-gray-300">{m.n}</span></div>
            <p className="text-[12px] font-bold text-gray-800 leading-tight">{m.name}</p>
            <p className="text-[10px] text-gray-400 mt-1 leading-snug line-clamp-2">{m.desc}</p>
            <p className="text-[10px] font-semibold text-gray-600 mt-1.5">{metric[m.id]}</p>
            <p className={`text-[11px] font-semibold mt-1 ${m.accent}`}>Open →</p>
          </Link>
        ))}
      </div>

      <p className="text-[10px] text-gray-400 mt-5">
        Program Quality is an executive composite over the whole Analytics &amp; Quality stack — attainment, coverage, pass rate and audit compliance are live.
        Faculty-satisfaction surveys, employer feedback, cross-organisation benchmarking, formal annual-review cycles and the saved report builder have no store
        and are shown as honest &ldquo;soon&rdquo; states; corrective actions (CAPA) and live CSV exports are real.
      </p>
    </div>
  );
}
