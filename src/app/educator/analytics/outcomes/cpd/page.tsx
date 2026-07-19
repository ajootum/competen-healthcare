import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadLearnerOutcomes } from "@/lib/learner-outcomes";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import OutcomesNav from "../OutcomesNav";

// Module 5 — CPD Progress. CPD hours/credits/plans/categories need a CPD
// activity store with category tagging; none is logged, so most metrics are
// shown honestly. Recommended CPD links to real published courses.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const CAREER = ["Novice", "Competent", "Proficient", "Expert", "Advanced Practice", "Leadership"];

export default async function Cpd() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadLearnerOutcomes(admin, hospitalId ?? "")).cpd;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "CPD Hours", value: C.hours !== null ? String(C.hours) : "—", sub: C.hours === null ? "none logged" : "" },
    { label: "CPD Credits", value: "—", sub: "no store" },
    { label: "Active Plans", value: "—", sub: "no store" },
    { label: "Compliance Rate", value: pct(C.compliance), sub: C.note || "" },
  ];

  return (
    <div className="max-w-[1200px]">
      <OutcomesNav active="cpd" />
      <div className="mb-2"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-4" /></div>
      <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-5">ℹ️ {C.note || "No CPD activity has been logged yet."} CPD hours, credits, plans and category tracking need a CPD activity store — shown honestly rather than simulated. Recommended CPD below links to real published courses.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 items-start">
        {/* CPD by category (soon) */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">CPD by Category</h2>
          <div className="flex flex-col gap-1.5">{d.categories.map(x => (
            <div key={x.label} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-1.5"><span className="text-[11px] text-gray-400">{x.label}</span><span className="text-[8px] font-bold uppercase text-gray-300">soon</span></div>
          ))}</div>
        </div>

        {/* Career progression */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Career Progression</h2>
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {CAREER.map((s, i) => (
              <span key={s} className="flex items-center gap-1 shrink-0">
                <span className="text-[9px] rounded px-2 py-1 bg-gray-50 text-gray-400">{s}</span>
                {i < CAREER.length - 1 && <span className="text-gray-300 text-[9px]">→</span>}
              </span>
            ))}
          </div>
          <p className="text-[9px] text-gray-300 mt-3">Career-stage tracking needs progression records linked to CPD and competency milestones — on the roadmap.</p>
        </div>
      </div>

      {/* Recommended CPD */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-bold text-gray-900">Recommended CPD</h2><Link href="/educator/courses" className="text-[11px] font-semibold text-purple-600 hover:underline">All courses →</Link></div>
        {d.recommended.length === 0 ? <p className="text-xs text-gray-400">No published courses to recommend yet.</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">{d.recommended.map((c, i) => (
            <Link key={i} href={c.href} className="border border-gray-100 rounded-xl p-3 hover:border-purple-200 transition-colors">
              <p className="text-[8px] font-bold uppercase text-purple-400">{c.category}</p>
              <p className="text-[12px] font-semibold text-gray-800 leading-tight mt-1 line-clamp-2">{c.title}</p>
              {c.points !== null && <p className="text-[10px] text-gray-400 mt-1">{c.points} CPD points</p>}
              <p className="text-[10px] font-semibold text-purple-600 mt-2">Enrol →</p>
            </Link>
          ))}</div>
        )}
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
        <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>
      </div>
    </div>
  );
}
