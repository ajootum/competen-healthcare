import Link from "next/link";
import { loadRulesEngine } from "@/lib/studio/rules-engine";
import { studioGuard } from "../_studio-ui";

// CST-007 — Competency Rules Engine. Consolidation view over the business rules that already govern
// competency progression, assessment scoring, evidence validation, critical failure and recertification
// — surfaced as one Rules Library from their real stores (loadRulesEngine). Authoring stays in each
// source surface; a unified visual rule builder is the next-phase authoring layer.

export const dynamic = "force-dynamic";

export default async function StudioRulesPage() {
  const { admin, isSuper, hid } = await studioGuard();

  const { total, categories, schedules } = await loadRulesEngine(admin, hid, isSuper);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-widest mb-0.5">CST-007 · Rules Engine</p>
          <h1 className="text-xl font-bold text-gray-900">Competency Rules Library</h1>
          <p className="text-gray-400 text-sm mt-0.5">Every business rule governing progression, scoring, evidence, risk and recertification — consolidated from its source of truth.</p>
        </div>
        <Link href="/super-admin/studio" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Studio</Link>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-100 p-3.5">
          <p className="text-xl font-bold text-gray-900">{total}</p>
          <p className="text-[10px] text-gray-400 font-medium mt-0.5">Active rules</p>
        </div>
        {categories.map(c => (
          <div key={c.key} className="bg-white rounded-xl border border-gray-100 p-3.5">
            <p className="text-xl font-bold text-gray-900">{c.n}</p>
            <p className="text-[10px] text-gray-400 font-medium mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Rules Library */}
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Rules library</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mb-6">
        {categories.map(c => (
          <Link key={c.key} href={c.href} className="bg-white rounded-xl border border-gray-100 p-5 hover:border-teal-200 hover:shadow-sm transition-all group block">
            <div className="flex items-center gap-2.5 mb-1.5">
              <span className="text-xl">{c.icon}</span>
              <p className="font-bold text-gray-900 text-sm group-hover:text-teal-700">{c.label}</p>
              <span className="ml-auto text-lg font-bold text-gray-900">{c.n}</span>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed mb-2">{c.desc}</p>
            {c.samples.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {c.samples.map((s, i) => <span key={i} className="text-[10px] font-medium text-gray-600 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 truncate max-w-full">{s}</span>)}
              </div>
            ) : (
              <p className="text-[10px] text-gray-300">No rules of this type yet — author them in the linked surface.</p>
            )}
          </Link>
        ))}
      </div>

      {/* Reassessment schedules — the most concrete named rules */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 text-sm">Reassessment &amp; recertification schedules</h2>
          <Link href="/competency-office/recertification" className="text-xs text-teal-600 hover:underline">Recertification →</Link>
        </div>
        {schedules.length === 0 ? (
          <p className="text-xs text-gray-400">No reassessment schedules defined.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-50">
            {schedules.map((s, i) => (
              <div key={i} className="flex items-center gap-3 py-2 text-xs">
                <span className="font-semibold text-gray-800 w-52 truncate">{s.name}</span>
                {s.cycle && <span className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 capitalize">{s.cycle}</span>}
                <span className="text-gray-500">{s.months ? `Every ${s.months} months` : "—"}</span>
                <div className="flex gap-1 ml-auto">
                  {s.triggers.map(t => <span key={t} className="text-[9px] font-semibold text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded px-1.5 py-0.5">{t}</span>)}
                  {s.grace != null && <span className="text-[9px] text-gray-400">{s.grace}d grace</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
        <p className="text-[11px] text-teal-900">
          <span className="font-bold">Consolidation view.</span> These rules are authored today in their source surfaces (assignment rules, assessment blueprints, evidence matrices, CPU config, recertification). A unified no-code visual rule builder that authors across all categories from one canvas is the next-phase layer.
        </p>
      </div>
    </div>
  );
}
