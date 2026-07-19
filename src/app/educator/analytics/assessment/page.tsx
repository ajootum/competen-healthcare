import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAssessmentAnalytics } from "@/lib/assessment-analytics";
import AssessmentNav from "./AssessmentNav";
import { MODULES } from "./modules";

// Assessment Analytics landing (spec §Recommended Landing Page). Summary cards,
// performance trend, question-quality distribution, AI insights and the five
// module cards — every figure live.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";

export default async function AssessmentLanding() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadAssessmentAnalytics(admin, hospitalId ?? "");

  const summary = [
    { icon: "⭐", tint: "bg-purple-50 text-purple-600", label: "Quality Index", value: pct(d.performance.cards.qualityIndex), sub: "assessment quality" },
    { icon: "✅", tint: "bg-green-50 text-green-600", label: "Pass Rate", value: pct(d.performance.cards.passRate), sub: `${d.performance.cards.total} assessments` },
    { icon: "🎯", tint: "bg-teal-50 text-teal-600", label: "Reliability", value: "—", sub: "insufficient data" },
    { icon: "🧭", tint: "bg-indigo-50 text-indigo-600", label: "Blueprint Alignment", value: pct(d.blueprint.cards.alignment), sub: `${d.blueprint.cards.missing} gaps` },
    { icon: "❓", tint: "bg-blue-50 text-blue-600", label: "Question Quality", value: pct(d.questions.cards.total ? Math.round((d.questions.cards.highQuality / d.questions.cards.total) * 100) : null), sub: `${d.questions.cards.total} questions` },
    { icon: "⚖️", tint: "bg-rose-50 text-rose-600", label: "Difficulty Balance", value: d.difficulty.cards.avgIndex !== null ? d.difficulty.cards.avgIndex.toFixed(2) : "—", sub: "avg facility index" },
  ];
  const trMax = 100;
  const metric: Record<string, string> = {
    performance: `${pct(d.performance.cards.passRate)} pass · ${pct(d.performance.cards.avg)} avg`,
    questions: `${d.questions.cards.total} items · ${pct(d.questions.cards.avgFacility)} facility`,
    reliability: "needs item matrices",
    blueprint: `${pct(d.blueprint.cards.competencyCoverage)} coverage · ${d.blueprint.cards.missing} gaps`,
    difficulty: `${d.difficulty.cards.easy}E · ${d.difficulty.cards.moderate}M · ${d.difficulty.cards.difficult}H`,
  };
  const insights = [...d.performance.insights, ...d.questions.insights, ...d.blueprint.insights].slice(0, 4);

  return (
    <div className="max-w-[1200px]">
      <AssessmentNav active="overview" />

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
        {/* Performance trend */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-gray-900 mb-1">Assessment Performance Trend <span className="font-normal text-gray-400 text-xs">(6 mo)</span></h2>
          <div className="flex items-center gap-3 mb-2 text-[9px]"><span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-purple-500" />Avg Score</span><span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-green-500" />Pass Rate</span></div>
          {d.performance.trend.every(t => t.avg === null && t.pass === null) ? <p className="text-xs text-gray-400 py-8 text-center">No assessment history yet.</p> : (
            <svg viewBox="0 0 320 100" className="w-full">
              {[0, 50, 100].map(y => <line key={y} x1="22" x2="314" y1={82 - y * 0.7} y2={82 - y * 0.7} stroke="#f3f4f6" strokeWidth="1" />)}
              {[0, 50, 100].map(y => <text key={y} x="18" y={85 - y * 0.7} fontSize="7" fill="#c4c4cc" textAnchor="end">{y}</text>)}
              {([["avg", "#9333ea"], ["pass", "#10b981"]] as const).map(([key, col]) => { const pts = d.performance.trend.map((t, i) => ({ x: 40 + i * 48, y: t[key] !== null ? 82 - (t[key] as number) / trMax * 70 : null })); const line = pts.filter(p => p.y !== null) as { x: number; y: number }[]; return <g key={key}>{line.length > 1 && <polyline fill="none" stroke={col} strokeWidth="1.5" points={line.map(p => `${p.x},${p.y}`).join(" ")} />}{line.map(p => <circle key={p.x} cx={p.x} cy={p.y} r="2.5" fill={col} />)}</g>; })}
              {d.performance.trend.map((t, i) => <text key={i} x={40 + i * 48} y="96" fontSize="7" fill="#9ca3af" textAnchor="middle">{t.label}</text>)}
            </svg>
          )}
        </div>

        {/* Question quality distribution */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Question Difficulty Mix</h2>
          <div className="flex items-end justify-around gap-2 h-28">
            {d.questions.byDifficulty.map(x => (
              <div key={x.label} className="flex flex-col items-center gap-1 flex-1">
                <span className="text-[10px] font-bold text-gray-700">{x.n}</span>
                <div className="w-full rounded-t" style={{ height: `${(x.n / Math.max(1, ...d.questions.byDifficulty.map(y => y.n))) * 80}px`, background: x.color }} />
                <span className="text-[8px] text-gray-400">{x.label}</span>
              </div>
            ))}
          </div>
          <Link href="/educator/analytics/assessment/questions" className="block mt-2 text-[11px] font-semibold text-purple-600 hover:underline">Question analytics →</Link>
        </div>
      </div>

      {/* AI insights */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Assessment Insights</h2><span className="ml-auto text-[8px] font-bold uppercase text-gray-300">rule-derived</span></div>
        {insights.length === 0 ? <p className="text-xs text-gray-400">No assessment issues detected. ✅</p> : <ul className="grid sm:grid-cols-2 gap-1.5">{insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
      </div>

      {/* Module cards */}
      <h2 className="text-sm font-bold text-gray-900 mb-3">Modules</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {MODULES.map(m => (
          <Link key={m.id} href={`/educator/analytics/assessment/${m.id}`} className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-purple-200 hover:shadow-sm transition-all">
            <div className="flex items-center gap-2 mb-2"><span className={`w-9 h-9 rounded-lg flex items-center justify-center text-base ${m.tint}`}>{m.icon}</span><span className="text-[10px] font-bold text-gray-300">{m.n}</span></div>
            <p className="text-[12px] font-bold text-gray-800">{m.name}</p>
            <p className="text-[10px] text-gray-400 mt-1 leading-snug line-clamp-2">{m.desc}</p>
            <p className="text-[11px] font-semibold text-gray-600 mt-2">{metric[m.id]}</p>
            <p className={`text-[11px] font-semibold mt-1 ${m.accent}`}>Open →</p>
          </Link>
        ))}
      </div>

      <p className="text-[10px] text-gray-400 mt-5">
        Recorded assessments, the question bank and quiz attempts are live. Psychometrics that need per-attempt response matrices — item discrimination,
        Bloom mapping, distractor efficiency, Cronbach&apos;s α / KR-20 and inter-rater agreement — aren&apos;t computable at this data volume and are shown as honest
        &ldquo;soon&rdquo; / insufficient-data states rather than fabricated coefficients.
      </p>
    </div>
  );
}
