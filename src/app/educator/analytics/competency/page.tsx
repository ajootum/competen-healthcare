import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCompetencyAnalytics } from "@/lib/competency-analytics";
import CompetencyNav from "./CompetencyNav";
import { MODULES } from "./modules";

// Competency Analytics landing (spec §Recommended Landing Page). Summary cards,
// key intelligence widgets and the seven module cards — every figure live.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";

export default async function CompetencyLanding() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = await loadCompetencyAnalytics(admin, hospitalId ?? "");

  const summary = [
    { icon: "🗂️", tint: "bg-purple-50 text-purple-600", label: "Coverage", value: pct(d.coverage.cards.assessmentRate), sub: `${d.coverage.cards.fully}/${d.coverage.cards.total} fully` },
    { icon: "🎯", tint: "bg-blue-50 text-blue-600", label: "Achievement", value: pct(d.achievement.cards.overall), sub: `${d.achievement.cards.achieved} achieved` },
    { icon: "🧩", tint: "bg-amber-50 text-amber-600", label: "Critical Gaps", value: String(d.gaps.cards.critical), sub: `${d.gaps.cards.total} total` },
    { icon: "🛠️", tint: "bg-indigo-50 text-indigo-600", label: "Skill Mastery", value: pct(d.skills.cards.independentRate), sub: `${d.skills.cards.total} skills` },
    { icon: "🔁", tint: "bg-rose-50 text-rose-600", label: "Reassessment Due", value: String(d.achievement.cards.reassessDue), sub: "expired competencies" },
    { icon: "🚀", tint: "bg-teal-50 text-teal-600", label: "Workforce Readiness", value: pct(d.domains.cards.readiness), sub: "avg domain achievement" },
  ];
  const atRisk = d.achievement.byLearner.filter(l => l.status === "At Risk");
  const distMax = Math.max(1, ...d.skills.distribution.map(x => x.n));
  const metric: Record<string, string> = {
    coverage: `${d.coverage.cards.fully}/${d.coverage.cards.total} fully covered`,
    achievement: `${pct(d.achievement.cards.overall)} achieved`,
    heatmaps: `${d.heatmap.cards.criticalWeak} weak · ${d.heatmap.cards.highPerforming} strong`,
    gaps: `${d.gaps.cards.total} gaps · ${d.gaps.cards.critical} critical`,
    domains: d.domains.cards.highest ? `Top: ${d.domains.cards.highest.name}` : `${d.domains.scorecards.length} domains`,
    skills: `${d.skills.cards.total} skills · ${d.skills.cards.logged} logged`,
    trends: d.trends.cards.achievement ? `Achievement ${d.trends.cards.achievement.dir === "up" ? "▲" : "▼"} ${d.trends.cards.achievement.pct}%` : "6-month history",
  };
  const insights = [...d.gaps.recs, ...d.achievement.insights, ...d.domains.insights].slice(0, 4);

  return (
    <div className="max-w-[1200px]">
      <CompetencyNav active="overview" />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        {summary.map(c => (
          <div key={c.label} className="bg-white border border-gray-100 rounded-2xl p-4">
            <span className={`w-9 h-9 rounded-full flex items-center justify-center text-base ${c.tint}`}>{c.icon}</span>
            <p className="text-2xl font-extrabold text-gray-900 leading-tight mt-2.5">{c.value}</p>
            <p className="text-[11px] font-semibold text-gray-500">{c.label}</p>
            <p className="text-[10px] text-gray-400 mt-0.5 truncate">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5 items-start">
        {/* Highest & lowest domains */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Domain Performance</h2>
          {d.domains.cards.highest ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-green-50/60 border border-green-100 px-3 py-2"><span className="text-[11px] text-gray-600 truncate">↑ {d.domains.cards.highest.name}</span><span className="text-sm font-bold text-green-700">{d.domains.cards.highest.pct}%</span></div>
              {d.domains.cards.lowest && <div className="flex items-center justify-between rounded-lg bg-red-50/60 border border-red-100 px-3 py-2"><span className="text-[11px] text-gray-600 truncate">↓ {d.domains.cards.lowest.name}</span><span className="text-sm font-bold text-red-600">{d.domains.cards.lowest.pct}%</span></div>}
              <p className="text-[10px] text-gray-400">Avg domain score {pct(d.domains.cards.avgScore)} · {d.domains.scorecards.length} domains assessed</p>
            </div>
          ) : <p className="text-xs text-gray-400">No domain scores recorded yet.</p>}
          <Link href="/educator/analytics/competency/domains" className="block mt-3 text-[11px] font-semibold text-purple-600 hover:underline">View domains →</Link>
        </div>

        {/* Critical gaps */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-bold text-gray-900">Critical Competency Gaps</h2><Link href="/educator/analytics/competency/gaps" className="text-[11px] font-semibold text-purple-600 hover:underline">All →</Link></div>
          {d.gaps.register.length === 0 ? <p className="text-xs text-gray-400">No competency gaps detected. ✅</p> : (
            <div className="flex flex-col gap-1.5">
              {d.gaps.register.slice(0, 4).map(g => (
                <div key={g.id} className="flex items-center gap-2 text-[11px]"><span className="flex-1 truncate text-gray-700">{g.name}</span><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${g.risk === "High" ? "bg-red-50 text-red-600" : g.risk === "Medium" ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-500"}`}>{g.risk}</span><span className="text-gray-400 w-10 text-right">gap {g.gap}</span></div>
              ))}
            </div>
          )}
        </div>

        {/* Skill mastery distribution */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Skill Mastery Distribution</h2>
          {d.skills.cards.logged === 0 ? <p className="text-xs text-gray-400">No skills logged yet.</p> : (
            <div className="flex items-end justify-around gap-2 h-24">
              {d.skills.distribution.map(x => (
                <div key={x.label} className="flex flex-col items-center gap-1 flex-1">
                  <span className="text-[10px] font-bold text-gray-700">{x.n}</span>
                  <div className="w-full bg-indigo-400 rounded-t" style={{ height: `${(x.n / distMax) * 70}px` }} />
                  <span className="text-[8px] text-gray-400 text-center leading-tight">{x.label}</span>
                </div>
              ))}
            </div>
          )}
          <Link href="/educator/analytics/competency/skills" className="block mt-2 text-[11px] font-semibold text-purple-600 hover:underline">View skills →</Link>
        </div>
      </div>

      {/* AI insights + at-risk */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5 items-start">
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Competency Insights</h2><span className="ml-auto text-[8px] font-bold uppercase text-gray-300">rule-derived</span></div>
          {insights.length === 0 ? <p className="text-xs text-gray-400">No issues detected. ✅</p> : <ul className="space-y-1.5">{insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-bold text-gray-900">At-Risk Learners</h2><Link href="/educator/at-risk" className="text-[11px] font-semibold text-purple-600 hover:underline">View →</Link></div>
          {atRisk.length === 0 ? <p className="text-xs text-gray-400">No learners flagged at risk. 🎉</p> : (
            <div className="flex flex-col gap-2">
              {atRisk.slice(0, 5).map(l => (
                <div key={l.id} className="flex items-center gap-2 text-[11px]"><span className="w-6 h-6 rounded-full bg-red-50 text-red-600 flex items-center justify-center text-[9px] font-bold">{l.name.split(" ").map(w => w[0]).slice(0, 2).join("")}</span><span className="flex-1 truncate text-gray-700">{l.name}</span><span className="text-gray-400">{l.pctAchieved}% achieved</span></div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Module cards */}
      <h2 className="text-sm font-bold text-gray-900 mb-3">Modules</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {MODULES.map(m => (
          <Link key={m.id} href={`/educator/analytics/competency/${m.id}`} className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-purple-200 hover:shadow-sm transition-all">
            <div className="flex items-center gap-2 mb-2"><span className={`w-9 h-9 rounded-lg flex items-center justify-center text-base ${m.tint}`}>{m.icon}</span><span className="text-[10px] font-bold text-gray-300">{m.n}</span></div>
            <p className="text-[12px] font-bold text-gray-800">{m.name}</p>
            <p className="text-[10px] text-gray-400 mt-1 leading-snug line-clamp-2">{m.desc}</p>
            <p className="text-[11px] font-semibold text-gray-600 mt-2">{metric[m.id]}</p>
            <p className={`text-[11px] font-semibold mt-1 ${m.accent}`}>Open →</p>
          </Link>
        ))}
      </div>

      <p className="text-[10px] text-gray-400 mt-5">
        Framework structure (competencies, domains, CPUs, skills) and all recorded scores, decisions and logbook entries are live. Learning-outcome/course mapping,
        OSCE results, gap-closure time and change-point detection need stores not yet built — shown as honest empty or &ldquo;soon&rdquo; states inside each module.
      </p>
    </div>
  );
}
