import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import ImprovementNav from "../ImprovementNav";

// Module 1 — Improvement Plans. No improvement-plan store exists yet; corrective
// actions are tracked live under CAPA. Shown honestly.

export const dynamic = "force-dynamic";
const KPIS = ["On Track", "At Risk", "Overdue", "Completed", "Awaiting Review"];

export default async function Plans() {
  await requireEducatorAccess();
  const tiles: Tile[] = KPIS.map(label => ({ label, value: "—", sub: "no store" }));
  return (
    <div className="max-w-[1200px]">
      <ImprovementNav active="plans" />
      <div className="mb-2"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-5" /></div>
      <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-5">ℹ️ No improvement-plan store exists yet. The guided plan builder (SMART objectives, milestones, action register, owners, dependencies and effectiveness verification) is on the roadmap. Corrective actions are tracked live under CAPA.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">What this module needs</h2>
          <ul className="space-y-1.5 text-[11px] text-gray-600">
            <li className="flex gap-2"><span className="text-gray-300">·</span>An improvement-plans table with objectives, milestones, status and owners.</li>
            <li className="flex gap-2"><span className="text-gray-300">·</span>An action register linking each action to its originating finding.</li>
            <li className="flex gap-2"><span className="text-gray-300">·</span>Progress tracking and post-implementation effectiveness verification.</li>
          </ul>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Available now</h2>
          <div className="flex flex-col gap-1.5">
            <Link href="/educator/analytics/improvement/capa" className="text-[11px] font-semibold text-purple-600 hover:underline">CAPA — corrective actions →</Link>
            <Link href="/educator/analytics/improvement/risks" className="text-[11px] font-semibold text-purple-600 hover:underline">Educational risks →</Link>
            <Link href="/educator/plans" className="text-[11px] font-semibold text-purple-600 hover:underline">Learner learning plans →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
