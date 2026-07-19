import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadLearnerOutcomes } from "@/lib/learner-outcomes";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import OutcomesNav from "../OutcomesNav";

// Module 4 — Certification Readiness. Eligibility checklist, funnel and
// per-learner certification status. OSCE/portfolio/CPD requirements need their
// stores — shown honestly.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const QUICK = [["Generate Certificate", "/educator/approvals"], ["Notify Learner", "/educator/communication"], ["Review Portfolio", "/educator/approvals"], ["Request Validation", "/educator/validations"]];

export default async function Certification() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadLearnerOutcomes(admin, hospitalId ?? "")).certification;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Eligible", value: String(C.eligible) },
    { label: "Requirements Met", value: pct(C.requirementsMet) },
    { label: "Evidence Verified", value: String(C.evidenceVerified) },
    { label: "Outstanding", value: String(C.outstanding), alert: C.outstanding > 0 },
    { label: "Certificates Issued", value: String(C.certificatesIssued) },
    { label: "Readiness Score", value: pct(C.readinessScore) },
  ];
  const fMax = d.funnel[0]?.n ?? 1;

  return (
    <div className="max-w-[1200px]">
      <OutcomesNav active="certification" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 items-start">
        {/* Checklist */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Certification Checklist</h2>
          <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
            <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Requirement", "Completed", "Pending", "Missing"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
            <tbody>{d.checklist.map(c => (
              <tr key={c.label} className="border-b border-gray-50 text-[11px]">
                <td className="py-2 pr-3 font-semibold text-gray-800">{c.label}</td>
                <td className="py-2 pr-3 text-green-600 font-bold">{c.completed}</td>
                <td className="py-2 pr-3 text-amber-600">{c.pending}</td>
                <td className="py-2 pr-3 text-red-600">{c.missing}</td>
              </tr>
            ))}
              <tr className="text-[11px] text-gray-300"><td className="py-2 pr-3">OSCE · Portfolio · CPD</td><td colSpan={3} className="py-2 pr-3 text-[8px] font-bold uppercase">soon — need their stores</td></tr>
            </tbody>
          </table></div>
        </div>

        {/* Funnel */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Certification Funnel</h2>
          <div className="flex flex-col gap-1">{d.funnel.map((s, i) => (
            <div key={s.label} className="flex items-center gap-2"><div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden"><div className="h-full rounded flex items-center px-2 text-[9px] font-bold text-white" style={{ width: `${fMax ? Math.max(14, (s.n / fMax) * 100) : 0}%`, background: `hsl(${170 - i * 6} 60% ${48 + i * 4}%)` }}>{s.n}</div></div><span className="text-[9px] text-gray-500 w-24 shrink-0">{s.label}</span></div>
          ))}</div>
        </div>
      </div>

      {/* Learner cert table */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Learner Certification Status</h2>
        {d.table.length === 0 ? <p className="text-xs text-gray-400">No learners yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
            <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Learner", "Achieved / Required", "Eligible", "Certificate"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
            <tbody>{d.table.map(c => (
              <tr key={c.id} className="border-b border-gray-50 text-[11px]">
                <td className="py-2 pr-3 font-semibold text-gray-800">{c.name}</td>
                <td className="py-2 pr-3 text-gray-600">{c.achieved} / {c.required}</td>
                <td className="py-2 pr-3">{c.eligible ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-50 text-green-600">Eligible</span> : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Pending</span>}</td>
                <td className="py-2 pr-3">{c.certificate ? <span className="text-green-500">✓</span> : <span className="text-gray-300">—</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
        <ul className="space-y-1.5 mb-3">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">{QUICK.map(([l, h]) => <Link key={l} href={h} className="text-[10px] font-semibold text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1.5 hover:border-purple-200 transition-colors">{l} →</Link>)}</div>
      </div>
    </div>
  );
}
