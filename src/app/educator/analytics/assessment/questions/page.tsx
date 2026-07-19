import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAssessmentAnalytics } from "@/lib/assessment-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import AssessmentNav from "../AssessmentNav";

// Module 2 — Question Analytics. Item counts, difficulty mix and facility (from
// quiz attempts). Discrimination, Bloom mapping and distractor efficiency need
// per-attempt response data — shown honestly.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const DIFF_CLS: Record<string, string> = { easy: "bg-green-50 text-green-600", medium: "bg-amber-50 text-amber-600", hard: "bg-red-50 text-red-600" };

export default async function Questions() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadAssessmentAnalytics(admin, hospitalId ?? "")).questions;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Total Questions", value: String(C.total) },
    { label: "Published", value: String(C.highQuality) },
    { label: "Needs Review", value: String(C.needsReview), alert: C.needsReview > 0 },
    { label: "Retired", value: String(C.retired) },
    { label: "Avg. Discrimination", value: "—", sub: "needs attempts" },
    { label: "Avg. Facility", value: pct(C.avgFacility) },
    { label: "Distractor Eff.", value: "—", sub: "soon" },
  ];
  const distTotal = d.byDifficulty.reduce((s, x) => s + x.n, 0);
  const Circ = 2 * Math.PI * 40;
  const arcPcts = d.byDifficulty.map(x => distTotal ? (x.n / distTotal) * 100 : 0);
  const arcs = d.byDifficulty.map((x, i) => ({ ...x, off: arcPcts.slice(0, i).reduce((s, p) => s + p, 0), p: arcPcts[i] }));
  const catMax = Math.max(1, ...d.byCategory.map(x => x.n));

  return (
    <div className="max-w-[1200px]">
      <AssessmentNav active="questions" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-4 xl:grid-cols-7" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 items-start">
        {/* Item performance distribution (by difficulty) */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Difficulty Distribution</h2>
          {distTotal === 0 ? <p className="text-xs text-gray-400 py-6 text-center">No questions.</p> : (
            <div className="flex items-center gap-4">
              <div className="relative w-24 shrink-0"><svg viewBox="0 0 100 100" className="w-full -rotate-90"><circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />{arcs.filter(a => a.p > 0).map(a => <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12" strokeDasharray={`${(a.p / 100) * Circ} ${Circ}`} strokeDashoffset={-(a.off / 100) * Circ} />)}</svg><div className="absolute inset-0 flex flex-col items-center justify-center"><p className="text-lg font-extrabold text-gray-900">{distTotal}</p><p className="text-[8px] text-gray-400">questions</p></div></div>
              <div className="flex flex-col gap-1 flex-1">{d.byDifficulty.map(x => <div key={x.label} className="flex items-center gap-2 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: x.color }} /><span className="text-gray-500 flex-1">{x.label}</span><span className="font-bold text-gray-800">{x.n}</span></div>)}</div>
            </div>
          )}
        </div>

        {/* By type */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">By Question Type</h2>
          <div className="flex flex-col gap-2">{d.byType.map(x => (
            <div key={x.label} className="flex items-center justify-between"><span className="text-[11px] text-gray-600">{x.label}</span><span className="text-sm font-bold text-gray-900">{x.n}</span></div>
          ))}</div>
          <p className="text-[9px] text-gray-300 mt-3">Bloom-level distribution needs a Bloom tag on each item — not captured yet.</p>
        </div>

        {/* By category */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">By Category</h2>
          <div className="flex flex-col gap-1.5">{d.byCategory.map(x => (
            <div key={x.label} className="flex items-center gap-2"><span className="text-[10px] text-gray-500 w-24 truncate">{x.label}</span><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-blue-400 rounded-full" style={{ width: `${(x.n / catMax) * 100}%` }} /></div><span className="text-[10px] font-bold text-gray-600 w-6 text-right">{x.n}</span></div>
          ))}</div>
        </div>
      </div>

      {/* Question bank table */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-bold text-gray-900">Question Bank</h2><Link href="/educator/questions" className="text-[11px] font-semibold text-purple-600 hover:underline">Manage →</Link></div>
        {d.table.length === 0 ? <p className="text-xs text-gray-400">No questions yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
            <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Question", "Category", "Type", "Difficulty", "Facility", "Attempts", "Status"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
            <tbody>{d.table.map(q => (
              <tr key={q.id} className="border-b border-gray-50 text-[11px]">
                <td className="py-2 pr-3 text-gray-800 max-w-[280px] truncate" title={q.content}>{q.content}</td>
                <td className="py-2 pr-3 text-gray-500">{q.category}</td>
                <td className="py-2 pr-3 text-gray-500">{q.type}</td>
                <td className="py-2 pr-3"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded capitalize ${DIFF_CLS[q.difficulty.toLowerCase()] ?? "bg-gray-100 text-gray-400"}`}>{q.difficulty}</span></td>
                <td className="py-2 pr-3 text-gray-600">{pct(q.facility)}</td>
                <td className="py-2 pr-3 text-gray-400">{q.attempts}</td>
                <td className="py-2 pr-3 text-gray-500">{q.status}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      {/* AI insights */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2><span className="ml-auto text-[8px] font-bold uppercase text-gray-300">rule-derived</span></div>
        <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>
      </div>
    </div>
  );
}
