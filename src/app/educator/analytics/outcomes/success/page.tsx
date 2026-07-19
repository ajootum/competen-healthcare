import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadLearnerOutcomes } from "@/lib/learner-outcomes";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import OutcomesNav from "../OutcomesNav";

// Module 1 — Learning Success. Completion, GPA, distribution, by-programme and
// the enrolment→graduation journey. Retention/graduation/satisfaction need a
// cohort/survey store — shown honestly.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const QUICK = [["Review Learner", "/educator/students"], ["Create Intervention", "/educator/interventions"], ["Assign Mentor", "/educator/seniors"], ["Learner Report", "/educator/progress"]];

export default async function Success() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadLearnerOutcomes(admin, hospitalId ?? "")).success;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Success Rate", value: pct(C.successRate) },
    { label: "Completion Rate", value: pct(C.completion) },
    { label: "Graduation Rate", value: "—", sub: "no cohort store" },
    { label: "Retention Rate", value: "—", sub: "soon" },
    { label: "Avg. GPA/Score", value: pct(C.avgGpa) },
    { label: "Satisfaction", value: "—", sub: "no survey store" },
    { label: "Success Index", value: pct(C.index) },
    { label: "At Risk", value: String(d.distribution[4]?.n ?? 0), alert: (d.distribution[4]?.n ?? 0) > 0 },
  ];
  const distTotal = d.distribution.reduce((s, x) => s + x.n, 0);
  const Circ = 2 * Math.PI * 40;
  const arcPcts = d.distribution.map(x => distTotal ? (x.n / distTotal) * 100 : 0);
  const arcs = d.distribution.map((x, i) => ({ ...x, off: arcPcts.slice(0, i).reduce((s, p) => s + p, 0), p: arcPcts[i] }));
  const progMax = Math.max(1, ...d.byProgram.map(x => x.success ?? 0));
  const jMax = d.journey[0]?.n ?? 1;

  return (
    <div className="max-w-[1200px]">
      <OutcomesNav active="success" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-4 xl:grid-cols-8" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 items-start">
        {/* Distribution donut */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Success Distribution</h2>
          {distTotal === 0 ? <p className="text-xs text-gray-400 py-6 text-center">No learner data yet.</p> : (
            <div className="flex items-center gap-4">
              <div className="relative w-24 shrink-0"><svg viewBox="0 0 100 100" className="w-full -rotate-90"><circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />{arcs.filter(a => a.p > 0).map(a => <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12" strokeDasharray={`${(a.p / 100) * Circ} ${Circ}`} strokeDashoffset={-(a.off / 100) * Circ} />)}</svg><div className="absolute inset-0 flex flex-col items-center justify-center"><p className="text-lg font-extrabold text-gray-900">{distTotal}</p><p className="text-[8px] text-gray-400">learners</p></div></div>
              <div className="flex flex-col gap-1 flex-1">{d.distribution.map(x => <div key={x.label} className="flex items-center gap-2 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: x.color }} /><span className="text-gray-500 flex-1 truncate">{x.label}</span><span className="font-bold text-gray-800">{x.n}</span></div>)}</div>
            </div>
          )}
        </div>

        {/* By program */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Success by Programme</h2>
          {d.byProgram.length === 0 ? <p className="text-xs text-gray-400">No programme data.</p> : (
            <div className="flex flex-col gap-1.5">{d.byProgram.map(p => (
              <div key={p.name} className="flex items-center gap-2"><span className="text-[10px] text-gray-500 w-24 truncate">{p.name}</span><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-purple-500 rounded-full" style={{ width: `${((p.success ?? 0) / progMax) * 100}%` }} /></div><span className="text-[10px] font-bold text-gray-600 w-9 text-right">{pct(p.success)}</span></div>
            ))}</div>
          )}
        </div>

        {/* Journey */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Learner Journey</h2>
          <div className="flex flex-col gap-1">{d.journey.map((s, i) => (
            <div key={s.label} className="flex items-center gap-2"><div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden"><div className="h-full rounded flex items-center px-2 text-[9px] font-bold text-white" style={{ width: `${jMax ? Math.max(16, (s.n / jMax) * 100) : 0}%`, background: `hsl(${262 - i * 10} 65% ${56 + i * 4}%)` }}>{s.n}</div></div><span className="text-[9px] text-gray-500 w-20 shrink-0">{s.label}</span></div>
          ))}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
          {d.insights.length === 0 ? <p className="text-xs text-gray-400">No success concerns detected. ✅</p> : <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-1.5">{QUICK.map(([l, h]) => <Link key={l} href={h} className="text-[11px] font-semibold text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 hover:border-purple-200 transition-colors">{l} →</Link>)}</div>
        </div>
      </div>
    </div>
  );
}
