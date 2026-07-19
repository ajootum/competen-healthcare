import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadLearnerOutcomes } from "@/lib/learner-outcomes";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import OutcomesNav from "../OutcomesNav";

// Module 3 — Clinical Readiness. Readiness score, domain profile, readiness
// levels and clinical exposure. Procedures/hours/rotations have no store.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const LEVEL_CLS: Record<string, string> = { Ready: "bg-green-50 text-green-600", "Nearly Ready": "bg-blue-50 text-blue-600", "Needs Practice": "bg-amber-50 text-amber-600", "Not Ready": "bg-red-50 text-red-600" };

export default async function Clinical() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadLearnerOutcomes(admin, hospitalId ?? "")).clinical;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Readiness Score", value: pct(C.readinessScore) },
    { label: "Skills Validated", value: String(C.skillsValidated) },
    { label: "Independent Skills", value: String(C.independentSkills) },
    { label: "WPA Completed", value: String(C.wpaCompleted) },
    { label: "Supervisor Approval", value: pct(C.supervisorApproval) },
    { label: "Cases Completed", value: String(C.casesCompleted) },
  ];
  // Radar geometry
  const N = d.domains.length; const cx = 120, cy = 115, R = 88;
  const axis = (i: number) => { const a = (-90 + (i * 360) / Math.max(1, N)) * Math.PI / 180; return { ax: Math.cos(a), ay: Math.sin(a) }; };
  const poly = d.domains.map((r, i) => { const { ax, ay } = axis(i); const rad = (r.pct / 100) * R; return `${cx + ax * rad},${cy + ay * rad}`; }).join(" ");

  return (
    <div className="max-w-[1200px]">
      <OutcomesNav active="clinical" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 items-start">
        {/* Readiness radar */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-gray-900 mb-2">Clinical Readiness by Domain</h2>
          {N === 0 ? <p className="text-xs text-gray-400 py-8 text-center">No domain scores to chart.</p> : (
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <svg viewBox="0 0 240 230" className="w-full max-w-[260px]">
                {[0.33, 0.66, 1].map(f => <circle key={f} cx={cx} cy={cy} r={R * f} fill="none" stroke="#f3f4f6" strokeWidth="1" />)}
                {d.domains.map((r, i) => { const { ax, ay } = axis(i); return <g key={r.domain}><line x1={cx} y1={cy} x2={cx + ax * R} y2={cy + ay * R} stroke="#f3f4f6" strokeWidth="1" /><text x={cx + ax * (R + 12)} y={cy + ay * (R + 12)} fontSize="7" fill="#9ca3af" textAnchor="middle" dominantBaseline="middle">{r.domain.replace(/^Domain \d+: /, "").slice(0, 9)}</text></g>; })}
                <polygon points={poly} fill="#f97316" fillOpacity="0.15" stroke="#f97316" strokeWidth="1.5" />
              </svg>
              <div className="flex-1 grid grid-cols-2 gap-1.5">{d.domains.map(r => <div key={r.domain} className="text-[10px]"><span className="text-gray-500">{r.domain.replace(/^Domain \d+: /, "").slice(0, 14)}</span><span className="float-right font-bold text-gray-700">{r.pct}%</span></div>)}</div>
            </div>
          )}
        </div>

        {/* Readiness levels + exposure */}
        <div className="flex flex-col gap-4">
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Readiness by Level</h2>
            <div className="flex flex-col gap-2">{d.levels.map(x => (
              <div key={x.label} className="flex items-center gap-2 text-[11px]"><span className="w-2 h-2 rounded-full" style={{ background: x.color }} /><span className="text-gray-500 flex-1 truncate">{x.label}</span><span className="font-bold text-gray-800">{x.n}</span></div>
            ))}</div>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Clinical Exposure</h2>
            <div className="grid grid-cols-2 gap-2">{d.exposure.map(x => (
              <div key={x.label} className="rounded-lg bg-gray-50 p-2 text-center"><p className={`text-base font-bold ${x.n === null ? "text-gray-300" : "text-gray-900"}`}>{x.n === null ? "—" : x.n}</p><p className="text-[8px] font-bold uppercase text-gray-400">{x.label}</p></div>
            ))}</div>
            <p className="text-[9px] text-gray-300 mt-2">Procedures, rotations &amp; clinical hours need a placement/hours store.</p>
          </div>
        </div>
      </div>

      {/* Readiness table */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Learner Readiness</h2>
        {d.table.length === 0 ? <p className="text-xs text-gray-400">No learners yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
            <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Learner", "Programme", "Readiness", "Level"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
            <tbody>{d.table.map(r => (
              <tr key={r.id} className="border-b border-gray-50 text-[11px]">
                <td className="py-2 pr-3 font-semibold text-gray-800">{r.name}</td>
                <td className="py-2 pr-3 text-gray-500">{r.program}</td>
                <td className="py-2 pr-3"><span className="flex items-center gap-2"><span className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden inline-block"><span className={`block h-full rounded-full ${r.readiness >= 80 ? "bg-green-500" : r.readiness >= 60 ? "bg-blue-500" : r.readiness >= 40 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${r.readiness}%` }} /></span><span className="text-gray-700 font-semibold">{r.readiness}%</span></span></td>
                <td className="py-2 pr-3"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${LEVEL_CLS[r.level]}`}>{r.level}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
        {d.insights.length === 0 ? <p className="text-xs text-gray-400 mb-3">No readiness concerns detected. ✅</p> : <ul className="space-y-1.5 mb-3">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
        <Link href="/educator/simulation" className="text-[11px] font-semibold text-purple-600 hover:underline">Book simulation →</Link>
      </div>
    </div>
  );
}
