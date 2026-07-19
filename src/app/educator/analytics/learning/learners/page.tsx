import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadLearningAnalytics } from "@/lib/learning-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import LearningNav from "../LearningNav";

// Module 1 — Learner Analytics (Learning Analytics Workspace §Module 1).
// Individual learner intelligence dashboard. Every figure live; time-spent and
// login streams have no store, shown as honest "—".

export const dynamic = "force-dynamic";

const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const fmtAgo = (iso: string | null) => {
  if (!iso) return "—";
  const mins = Math.max(1, Math.round((new Date().getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60); if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
};
const RISK_CLS: Record<string, string> = { High: "bg-red-50 text-red-600", Medium: "bg-amber-50 text-amber-600", Low: "bg-blue-50 text-blue-600", None: "bg-gray-100 text-gray-400" };

const QUICK = [
  { icon: "💬", label: "Send Encouragement", href: "/educator/communication" },
  { icon: "🎯", label: "Assign Remediation", href: "/educator/interventions" },
  { icon: "🗓️", label: "Schedule Meeting", href: "/educator/meetings" },
  { icon: "🧪", label: "Recommend Simulation", href: "/educator/simulation" },
  { icon: "📝", label: "Recommend Assessment", href: "/educator/assessments" },
];

export default async function LearnerAnalytics() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadLearningAnalytics(admin, hospitalId ?? "")).learners;
  const C = d.cards;

  const tiles: Tile[] = [
    { label: "Total Learners", value: String(C.total) },
    { label: "Active Learners", value: String(C.active), sub: "30d" },
    { label: "New Learners", value: String(C.recent), sub: "30d" },
    { label: "Inactive", value: String(C.inactive), alert: C.inactive > 0 },
    { label: "Completion Rate", value: pct(C.completionRate) },
    { label: "Avg. Learning Time", value: "—", sub: "not tracked" },
  ];

  const tlMax = Math.max(1, ...d.timeline.flatMap(w => [w.assessments, w.completions, w.quizzes]));

  return (
    <div className="max-w-[1200px]">
      <LearningNav active="learners" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 items-start">
        {/* Activity timeline */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-gray-900 mb-1">Learner Activity Timeline <span className="font-normal text-gray-400 text-xs">(weekly · 8 wks)</span></h2>
          <div className="flex items-center gap-3 mb-2 text-[9px]">
            {[["Assessments", "#9333ea"], ["Completions", "#10b981"], ["Quizzes", "#f59e0b"]].map(([l, c]) => (
              <span key={l} className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full" style={{ background: c }} />{l}</span>
            ))}
          </div>
          {d.timeline.every(w => w.assessments + w.completions + w.quizzes === 0) ? (
            <p className="text-xs text-gray-400 py-8 text-center">No learner activity in the last 8 weeks.</p>
          ) : (
            <svg viewBox="0 0 320 110" className="w-full">
              {[0, 0.5, 1].map(f => <line key={f} x1="10" x2="314" y1={92 - f * 80} y2={92 - f * 80} stroke="#f3f4f6" strokeWidth="1" />)}
              {([["assessments", "#9333ea"], ["completions", "#10b981"], ["quizzes", "#f59e0b"]] as const).map(([key, col]) => {
                const pts = d.timeline.map((w, i) => ({ x: 20 + i * 40, y: 92 - (w[key] / tlMax) * 80 }));
                return <g key={key}>
                  <polyline fill="none" stroke={col} strokeWidth="1.5" points={pts.map(p => `${p.x},${p.y}`).join(" ")} />
                  {pts.map(p => <circle key={p.x} cx={p.x} cy={p.y} r="2" fill={col} />)}
                </g>;
              })}
              {d.timeline.map((w, i) => <text key={i} x={20 + i * 40} y="104" fontSize="7" fill="#9ca3af" textAnchor="middle">{w.label}</text>)}
            </svg>
          )}
        </div>

        {/* Learning velocity */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Learning Velocity <span className="font-normal text-gray-400 text-xs">(avg/wk)</span></h2>
          <div className="flex flex-col gap-2.5">
            {[
              { l: "Competencies / week", v: String(d.velocity.competenciesPerWeek) },
              { l: "Completions / week", v: String(d.velocity.completionsPerWeek) },
              { l: "Quiz attempts / week", v: String(d.velocity.quizzesPerWeek) },
              { l: "Hours / week", v: "—", soon: true },
            ].map(r => (
              <div key={r.l} className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">{r.l}</span>
                <span className={`text-sm font-bold ${r.soon ? "text-gray-300" : "text-gray-900"}`}>{r.v}</span>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-gray-300 mt-3">Hours/week needs time-on-task tracking — not captured yet.</p>
        </div>
      </div>

      {/* Individual learner table */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-900">Individual Learner Overview</h2>
          <Link href="/educator/students" className="text-[11px] font-semibold text-purple-600 hover:underline">View directory →</Link>
        </div>
        {d.table.length === 0 ? (
          <p className="text-xs text-gray-400">No learners in your hospital yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  {["Learner", "Program", "Current Competency", "Progress", "Avg Score", "Last Active", "Risk", "Engagement", "AI Recommendation"].map(h => <th key={h} className="py-2 pr-3 font-bold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {d.table.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 text-[11px]">
                    <td className="py-2 pr-3 font-semibold text-gray-800 whitespace-nowrap">{r.name}</td>
                    <td className="py-2 pr-3 text-gray-500">{r.program}</td>
                    <td className="py-2 pr-3 text-gray-500 max-w-[160px] truncate" title={r.currentCompetency}>{r.currentCompetency}</td>
                    <td className="py-2 pr-3 text-gray-700">{pct(r.progress)}</td>
                    <td className="py-2 pr-3 text-gray-700">{pct(r.avgScore)}</td>
                    <td className="py-2 pr-3 text-gray-400">{fmtAgo(r.lastActive)}</td>
                    <td className="py-2 pr-3"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${RISK_CLS[r.risk]}`}>{r.risk}</span></td>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-1.5">
                        <span className="w-10 h-1.5 bg-gray-100 rounded-full overflow-hidden inline-block"><span className={`block h-full rounded-full ${r.engagement >= 66 ? "bg-green-500" : r.engagement >= 33 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${r.engagement}%` }} /></span>
                        <span className="text-gray-500">{r.engagement}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-gray-600">{r.aiRec}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[9px] text-gray-300 mt-2">Engagement = activity events (last 30d) indexed 0–100 vs the busiest learner. AI recommendation is rule-derived from live risk &amp; scores.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 items-start">
        {/* Engagement heatmap */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-gray-900 mb-2">Engagement Heatmap <span className="font-normal text-gray-400 text-xs">(by day &amp; time)</span></h2>
          {d.heatmap.max <= 1 && d.heatmap.cells.flat().every(c => c === 0) ? (
            <p className="text-xs text-gray-400 py-6 text-center">No activity events recorded yet.</p>
          ) : (
            <div className="grid gap-1" style={{ gridTemplateColumns: `52px repeat(${d.heatmap.cols.length}, 1fr)` }}>
              <span />
              {d.heatmap.cols.map(c => <span key={c} className="text-[8px] text-gray-400 text-center">{c}</span>)}
              {d.heatmap.rows.map((row, ri) => (
                <div key={row} className="contents">
                  <span className="text-[8px] text-gray-400 pr-1 text-right self-center">{row}</span>
                  {d.heatmap.cols.map((_, ci) => {
                    const n = d.heatmap.cells[ci][ri];
                    return <span key={ci} className="h-5 rounded flex items-center justify-center text-[7px] font-bold text-green-900"
                      style={{ background: `rgba(16,185,129,${Math.max(0.06, n / d.heatmap.max)})` }} title={`${d.heatmap.cols[ci]} ${row}: ${n} events`}>{n || ""}</span>;
                  })}
                </div>
              ))}
            </div>
          )}
          <p className="text-[9px] text-gray-300 mt-2">Best learning periods = darkest cells. Built from real assessment, enrolment &amp; quiz timestamps.</p>
        </div>

        {/* AI learner profile */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center gap-1.5 mb-2">
            <span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Learner Profile</h2>
            <span className="ml-auto text-[8px] font-bold uppercase text-gray-300">rule-derived</span>
          </div>
          {!d.profile ? (
            <p className="text-xs text-gray-400">No learner has enough recorded assessments to profile yet.</p>
          ) : (
            <div className="text-[11px] space-y-2">
              <p className="font-semibold text-gray-800">{d.profile.name} <span className="text-[9px] font-normal text-gray-400">(most assessed)</span></p>
              <div><p className="text-[9px] font-bold uppercase text-gray-400">Strengths</p><p className="text-green-700">{d.profile.strengths.join(", ")}</p></div>
              <div><p className="text-[9px] font-bold uppercase text-gray-400">Areas to improve</p><p className="text-amber-700">{d.profile.areas.join(", ")}</p></div>
              <div className="flex gap-4">
                <span><span className="text-gray-400">Consistency:</span> {d.profile.consistency}</span>
                <span><span className="text-gray-400">Dropout risk:</span> {d.profile.dropout}</span>
              </div>
              <p className="text-[9px] text-gray-300 pt-1 border-t border-gray-50">Burnout prediction &amp; preferred learning style need behavioural telemetry — not captured yet.</p>
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Quick Actions</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {QUICK.map(q => (
            <Link key={q.label} href={q.href} className="flex flex-col items-center gap-1 rounded-xl border border-gray-100 hover:border-purple-200 hover:bg-purple-50/40 py-3 transition-colors">
              <span className="text-lg">{q.icon}</span>
              <span className="text-[10px] font-semibold text-gray-600 text-center leading-tight px-1">{q.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
