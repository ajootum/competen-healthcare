import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCurriculumAnalytics } from "@/lib/curriculum-analytics";
import CurriculumNav from "./CurriculumNav";
import { MODULES } from "./modules";

// Curriculum Analytics landing (spec §Recommended Landing Page). Summary cards,
// key widgets and the six module cards — every figure live.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";

export default async function CurriculumLanding() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadCurriculumAnalytics(admin, hospitalId ?? "");

  const summary = [
    { icon: "🎓", tint: "bg-purple-50 text-purple-600", label: "Curriculum Effectiveness", value: pct(d.effectiveness.cards.effectiveness), sub: `${d.effectiveness.cards.activeCurricula} active` },
    { icon: "🧭", tint: "bg-blue-50 text-blue-600", label: "Blueprint Integrity", value: pct(d.blueprint.cards.completion), sub: `${d.blueprint.cards.missingLinks} missing links` },
    { icon: "🎯", tint: "bg-teal-50 text-teal-600", label: "Outcome Attainment", value: pct(d.outcomes.cards.avgAttainment), sub: `${d.outcomes.cards.achieved} achieved` },
    { icon: "💠", tint: "bg-indigo-50 text-indigo-600", label: "CPU Health", value: String(d.cpus.cards.highPerforming), sub: `of ${d.cpus.cards.total} high-performing` },
    { icon: "🎬", tint: "bg-rose-50 text-rose-600", label: "Content", value: String(d.content.cards.documents + d.content.cards.simulations + d.content.cards.courses), sub: "learning items" },
    { icon: "🧩", tint: "bg-amber-50 text-amber-600", label: "Critical Gaps", value: String(d.gaps.cards.critical), sub: `${d.gaps.cards.total} total` },
  ];
  const effMax = Math.max(1, ...d.effectiveness.trend.map(t => t.value ?? 0));
  const metric: Record<string, string> = {
    effectiveness: `${d.effectiveness.cards.activeCurricula} curricula · ${pct(d.effectiveness.cards.qualityIndex)} quality`,
    blueprint: `${pct(d.blueprint.cards.cpuMapping)} CPU-mapped · ${d.blueprint.cards.missingLinks} missing`,
    outcomes: `${d.outcomes.cards.achieved} achieved · ${d.outcomes.cards.partial} partial`,
    cpus: `${d.cpus.cards.total} CPUs · ${d.cpus.cards.needsReview} need review`,
    content: `${d.content.cards.documents} docs · ${d.content.cards.simulations} sims`,
    gaps: `${d.gaps.cards.total} gaps · ${d.gaps.cards.critical} critical`,
  };
  const insights = [...d.effectiveness.insights, ...d.blueprint.insights, ...d.gaps.insights].slice(0, 4);

  return (
    <div className="max-w-[1200px]">
      <CurriculumNav active="overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        {summary.map(c => (
          <div key={c.label} className="bg-white border border-gray-100 rounded-2xl p-4">
            <span className={`w-9 h-9 rounded-full flex items-center justify-center text-base ${c.tint}`}>{c.icon}</span>
            <p className="text-2xl font-extrabold text-gray-900 leading-tight mt-2.5">{c.value}</p>
            <p className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</p>
            <p className="text-[10px] text-gray-400 mt-0.5 truncate">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5 items-start">
        {/* Effectiveness trend */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Effectiveness Trend</h2>
          {d.effectiveness.trend.every(t => t.value === null) ? <p className="text-xs text-gray-400 py-6 text-center">No monthly history yet.</p> : (
            <svg viewBox="0 0 220 90" className="w-full">
              {[0, 50, 100].map(y => <line key={y} x1="20" x2="214" y1={72 - y * 0.6} y2={72 - y * 0.6} stroke="#f3f4f6" strokeWidth="1" />)}
              {(() => { const pts = d.effectiveness.trend.map((t, i) => ({ x: 34 + i * 34, y: t.value !== null ? 72 - (t.value / Math.max(100, effMax)) * 60 : null })); const line = pts.filter(p => p.y !== null) as { x: number; y: number }[]; return <>{line.length > 1 && <polyline fill="none" stroke="#9333ea" strokeWidth="1.5" points={line.map(p => `${p.x},${p.y}`).join(" ")} />}{line.map(p => <circle key={p.x} cx={p.x} cy={p.y} r="2.5" fill="#9333ea" />)}{d.effectiveness.trend.map((t, i) => <text key={i} x={34 + i * 34} y="84" fontSize="7" fill="#9ca3af" textAnchor="middle">{t.label}</text>)}</>; })()}
            </svg>
          )}
        </div>

        {/* Curriculum table */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-bold text-gray-900">Curriculum Performance</h2><Link href="/educator/analytics/curriculum/effectiveness" className="text-[11px] font-semibold text-purple-600 hover:underline">All →</Link></div>
          {d.effectiveness.table.length === 0 ? <p className="text-xs text-gray-400">No curricula with competencies yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
              <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Curriculum", "Program", "Completion", "Attainment", "Quality"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
              <tbody>{d.effectiveness.table.slice(0, 6).map(c => (
                <tr key={c.id} className="border-b border-gray-50 text-[11px]"><td className="py-2 pr-3 font-semibold text-gray-800 max-w-[180px] truncate" title={c.name}>{c.name}</td><td className="py-2 pr-3 text-gray-500 capitalize">{c.program}</td><td className="py-2 pr-3 text-gray-600">{pct(c.completion)}</td><td className="py-2 pr-3 text-gray-600">{pct(c.attainment)}</td><td className="py-2 pr-3 font-bold text-gray-800">{pct(c.quality)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </div>

      {/* AI insights */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Curriculum Insights</h2><span className="ml-auto text-[8px] font-bold uppercase text-gray-300">rule-derived</span></div>
        {insights.length === 0 ? <p className="text-xs text-gray-400">No curriculum issues detected. ✅</p> : <ul className="grid sm:grid-cols-2 gap-1.5">{insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
      </div>

      {/* Module cards */}
      <h2 className="text-sm font-bold text-gray-900 mb-3">Modules</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {MODULES.map(m => (
          <Link key={m.id} href={`/educator/analytics/curriculum/${m.id}`} className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-purple-200 hover:shadow-sm transition-all">
            <div className="flex items-center gap-2 mb-2"><span className={`w-9 h-9 rounded-lg flex items-center justify-center text-base ${m.tint}`}>{m.icon}</span><span className="text-[10px] font-bold text-gray-300">{m.n}</span></div>
            <p className="text-[12px] font-bold text-gray-800">{m.name}</p>
            <p className="text-[10px] text-gray-400 mt-1 leading-snug line-clamp-2">{m.desc}</p>
            <p className="text-[11px] font-semibold text-gray-600 mt-2">{metric[m.id]}</p>
            <p className={`text-[11px] font-semibold mt-1 ${m.accent}`}>Open →</p>
          </Link>
        ))}
      </div>

      <p className="text-[10px] text-gray-400 mt-5">
        Curricula are your competency frameworks (the curricula table is empty); domains stand in as learning-outcome proxies (no dedicated outcomes store).
        All structure, coverage, scores and content counts are live; learner/faculty satisfaction, content engagement telemetry, version history and accreditation
        mapping need stores not yet built — shown as honest empty or &ldquo;soon&rdquo; states.
      </p>
    </div>
  );
}
