import Link from "next/link";
import { loadTemplateLibrary } from "@/lib/studio/templates";
import { studioGuard } from "../_studio-ui";

// CST-102 — Competency Template Library. A governed catalogue of the reusable assets that can be cloned
// as starting points (framework libraries, skill objects, question banks, checklists, CPUs) — real
// counts from the Studio's stores. Cloning happens in each source surface; a dedicated curated
// starter-template store is the next-phase authoring layer.

export const dynamic = "force-dynamic";

export default async function StudioTemplatesPage() {
  const { admin, isSuper, hid } = await studioGuard();

  const { total, categories, featured, libraryBreakdown } = await loadTemplateLibrary(admin, hid, isSuper);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-widest mb-0.5">CST-102 · Template Library</p>
          <h1 className="text-xl font-bold text-gray-900">Template Library</h1>
          <p className="text-gray-400 text-sm mt-0.5">Reusable competency assets — frameworks, skills, question banks, checklists and CPUs — ready to clone.</p>
        </div>
        <Link href="/super-admin/studio" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Studio</Link>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-100 p-3.5">
          <p className="text-xl font-bold text-gray-900">{total}</p>
          <p className="text-[10px] text-gray-400 font-medium mt-0.5">Reusable assets</p>
        </div>
        {libraryBreakdown.map(b => (
          <div key={b.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
            <p className="text-xl font-bold text-gray-900">{b.n}</p>
            <p className="text-[10px] text-gray-400 font-medium mt-0.5">{b.label} frameworks</p>
          </div>
        ))}
      </div>

      {/* Template categories */}
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Template categories</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-6">
        {categories.map(c => (
          <Link key={c.key} href={c.href} className="bg-white rounded-xl border border-gray-100 p-5 hover:border-teal-200 hover:shadow-sm transition-all group block">
            <div className="flex items-center gap-2.5 mb-1.5">
              <span className="text-xl">{c.icon}</span>
              <p className="font-bold text-gray-900 text-sm group-hover:text-teal-700">{c.label}</p>
              <span className="ml-auto text-lg font-bold text-gray-900">{c.n}</span>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed mb-2">{c.desc}</p>
            {c.breakdown && (
              <div className="flex gap-1.5 mb-2">
                {c.breakdown.map(b => <span key={b.label} className="text-[10px] font-semibold text-gray-600 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{b.label} {b.n}</span>)}
              </div>
            )}
            {c.samples.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {c.samples.map((s, i) => <span key={i} className="text-[10px] font-medium text-teal-700 bg-teal-50 border border-teal-100 rounded px-1.5 py-0.5 truncate max-w-full">{s}</span>)}
              </div>
            )}
          </Link>
        ))}
      </div>

      {/* Featured */}
      {featured.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Featured framework templates</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {featured.map(f => (
              <Link key={f.id} href={`/super-admin/content/${f.id}`} className="border border-gray-100 rounded-lg p-3 hover:border-teal-200 transition-colors">
                <p className="text-xs font-semibold text-gray-800 truncate">{f.name}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{f.kind}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
        <p className="text-[11px] text-teal-900">
          <span className="font-bold">Reuse today.</span> Every asset above is clonable from its source surface (frameworks, skills, question banks, checklists, CPUs). A dedicated library of curated starter templates — pre-built blueprints beyond cloning existing assets — is the next-phase authoring layer.
        </p>
      </div>
    </div>
  );
}
