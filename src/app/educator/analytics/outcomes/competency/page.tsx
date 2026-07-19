import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadLearnerOutcomes } from "@/lib/learner-outcomes";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import OutcomesNav from "../OutcomesNav";

// Module 2 — Competency Achievement (outcomes view). Required-vs-achieved,
// by-domain attainment and the assigned→passport journey.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";

export default async function Competency() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadLearnerOutcomes(admin, hospitalId ?? "")).competency;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Achieved", value: String(C.achieved) },
    { label: "Outstanding", value: String(C.outstanding), alert: C.outstanding > 0 },
    { label: "In Progress", value: String(C.inProgress) },
    { label: "Expiring", value: String(C.expiring), alert: C.expiring > 0 },
    { label: "Avg. Level", value: C.avgLevel !== null ? `${C.avgLevel}/6` : "—" },
    { label: "Achievement Index", value: pct(C.index) },
  ];
  const jMax = d.journey[0]?.n ?? 1;

  return (
    <div className="max-w-[1200px]">
      <OutcomesNav active="competency" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 items-start">
        {/* By domain */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Achievement by Domain</h2>
          {d.byDomain.length === 0 ? <p className="text-xs text-gray-400">No competency scores yet.</p> : (
            <div className="flex flex-col gap-1.5">{d.byDomain.map(x => (
              <div key={x.domain} className="flex items-center gap-2"><span className="text-[10px] text-gray-500 w-32 truncate" title={x.domain}>{x.domain.replace(/^Domain \d+: /, "")}</span><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${x.pct >= 70 ? "bg-green-500" : x.pct >= 40 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${x.pct}%` }} /></div><span className="text-[10px] font-bold text-gray-600 w-9 text-right">{x.pct}%</span></div>
            ))}</div>
          )}
        </div>

        {/* Journey */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Competency Journey</h2>
          <div className="flex flex-col gap-1">{d.journey.map((s, i) => (
            <div key={s.label} className="flex items-center gap-2"><div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden"><div className="h-full rounded flex items-center px-2 text-[9px] font-bold text-white" style={{ width: `${jMax ? Math.max(16, (s.n / jMax) * 100) : 0}%`, background: `hsl(${210 - i * 8} 65% ${56 + i * 4}%)` }}>{s.n}</div></div><span className="text-[9px] text-gray-500 w-20 shrink-0">{s.label}</span></div>
          ))}</div>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
        {d.insights.length === 0 ? <p className="text-xs text-gray-400 mb-3">All required competencies on track. ✅</p> : <ul className="space-y-1.5 mb-3">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
        <div className="flex flex-wrap gap-1.5">
          <Link href="/educator/analytics/competency" className="text-[11px] font-semibold text-purple-600 hover:underline">Full competency analytics →</Link>
          <span className="text-gray-300">·</span>
          <Link href="/educator/approvals" className="text-[11px] font-semibold text-purple-600 hover:underline">Passport approvals →</Link>
        </div>
      </div>
    </div>
  );
}
