import { requireEducatorAccess } from "@/lib/educator-access";
import { loadLearningAnalytics } from "@/lib/learning-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import LearningNav from "../LearningNav";

// Module 2 — Cohort Analytics (Learning Analytics Workspace §Module 2).
// Compares cohorts (this hospital's departments) instead of individuals.

export const dynamic = "force-dynamic";

const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const COHORT_COLORS = ["#9333ea", "#10b981", "#f59e0b", "#3b82f6", "#ef4444", "#14b8a6"];
const RISK_CLS: Record<string, string> = { High: "bg-red-50 text-red-600", Medium: "bg-amber-50 text-amber-600", Low: "bg-blue-50 text-blue-600" };

export default async function CohortAnalytics() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadLearningAnalytics(admin, hospitalId ?? "")).cohorts;
  const C = d.cards;

  const tiles: Tile[] = [
    { label: "Cohorts", value: String(C.count), sub: "departments" },
    { label: "Highest Performing", value: C.highest ? `${C.highest.pct}%` : "—", sub: C.highest?.name ?? "—" },
    { label: "Lowest Performing", value: C.lowest ? `${C.lowest.pct}%` : "—", sub: C.lowest?.name ?? "—", alert: !!C.lowest },
    { label: "Avg. Completion", value: pct(C.avgCompletion) },
    { label: "Avg. Competency", value: pct(C.avgCompetency) },
  ];

  // Radar geometry
  const N = d.radar.length; const cx = 110, cy = 105, R = 78;
  const axis = (i: number) => { const a = (-90 + (i * 360) / Math.max(1, N)) * Math.PI / 180; return { ax: Math.cos(a), ay: Math.sin(a) }; };
  const cohortPolys = d.cohortNames.map((_, ci) => d.radar.map((r, i) => {
    const { ax, ay } = axis(i); const rad = (r.values[ci] ?? 0) / 100 * R;
    return `${cx + ax * rad},${cy + ay * rad}`;
  }).join(" "));

  return (
    <div className="max-w-[1200px]">
      <LearningNav active="cohorts" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-5" /></div>

      {C.count === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center text-sm text-gray-400">
          No cohorts yet — assign learners to departments to compare cohorts.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 items-start">
            {/* Performance comparison */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-3">Performance Comparison</h2>
              <div className="flex items-center gap-3 mb-3 text-[9px]">
                <span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-purple-500" />Competency</span>
                <span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-green-500" />Completion</span>
              </div>
              <div className="flex flex-col gap-3">
                {d.table.map(c => (
                  <div key={c.id}>
                    <p className="text-[11px] font-semibold text-gray-700 mb-1">{c.name} <span className="font-normal text-gray-400">· {c.learners} learners</span></p>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2"><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-purple-500 rounded-full" style={{ width: `${c.competency ?? 0}%` }} /></div><span className="text-[10px] font-bold text-gray-600 w-9 text-right">{pct(c.competency)}</span></div>
                      <div className="flex items-center gap-2"><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-green-500 rounded-full" style={{ width: `${c.completion ?? 0}%` }} /></div><span className="text-[10px] font-bold text-gray-600 w-9 text-right">{pct(c.completion)}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Radar */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-2">Cohort Radar <span className="font-normal text-gray-400 text-xs">(competency by domain)</span></h2>
              {N === 0 ? (
                <p className="text-xs text-gray-400 py-8 text-center">No competency scores to chart yet.</p>
              ) : (
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <svg viewBox="0 0 220 210" className="w-full max-w-[240px]">
                    {[0.33, 0.66, 1].map(f => <circle key={f} cx={cx} cy={cy} r={R * f} fill="none" stroke="#f3f4f6" strokeWidth="1" />)}
                    {d.radar.map((r, i) => { const { ax, ay } = axis(i); return <g key={r.domain}>
                      <line x1={cx} y1={cy} x2={cx + ax * R} y2={cy + ay * R} stroke="#f3f4f6" strokeWidth="1" />
                      <text x={cx + ax * (R + 12)} y={cy + ay * (R + 12)} fontSize="7" fill="#9ca3af" textAnchor="middle" dominantBaseline="middle">{r.domain.slice(0, 10)}</text>
                    </g>; })}
                    {cohortPolys.map((pts, ci) => (
                      <polygon key={ci} points={pts} fill={COHORT_COLORS[ci % COHORT_COLORS.length]} fillOpacity="0.12" stroke={COHORT_COLORS[ci % COHORT_COLORS.length]} strokeWidth="1.5" />
                    ))}
                  </svg>
                  <div className="flex flex-row sm:flex-col gap-2 flex-wrap">
                    {d.cohortNames.map((name, ci) => (
                      <span key={name} className="flex items-center gap-1.5 text-[10px] text-gray-600"><span className="w-2.5 h-2.5 rounded" style={{ background: COHORT_COLORS[ci % COHORT_COLORS.length] }} />{name}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Cohort table */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-4">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Cohort Performance Table</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">
                    {["Cohort", "Learners", "Completion", "Competency", "Pass Rate", "Attendance", "Simulation", "Risk"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {d.table.map(c => (
                    <tr key={c.id} className="border-b border-gray-50 text-[11px]">
                      <td className="py-2 pr-3 font-semibold text-gray-800">{c.name}</td>
                      <td className="py-2 pr-3 text-gray-600">{c.learners}</td>
                      <td className="py-2 pr-3 text-gray-600">{pct(c.completion)}</td>
                      <td className="py-2 pr-3 text-gray-600">{pct(c.competency)}</td>
                      <td className="py-2 pr-3 text-gray-600">{pct(c.passRate)}</td>
                      <td className="py-2 pr-3 text-gray-300">—</td>
                      <td className="py-2 pr-3 text-gray-600">{c.simulation ?? "—"}</td>
                      <td className="py-2 pr-3"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${RISK_CLS[c.risk]}`}>{c.risk}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[9px] text-gray-300 mt-2">Attendance needs a scheduling/attendance store — not tracked. Simulation counts hospital-level simulation assessments.</p>
          </div>

          {/* AI insights */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Cohort Insights</h2><span className="ml-auto text-[8px] font-bold uppercase text-gray-300">rule-derived</span></div>
            {d.insights.length === 0 ? (
              <p className="text-xs text-gray-400">Not enough cohort data to compare yet.</p>
            ) : (
              <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>
            )}
            <p className="text-[9px] text-gray-300 mt-2">Benchmarking against previous intakes needs cohort-versioned history — on the roadmap.</p>
          </div>
        </>
      )}
    </div>
  );
}
