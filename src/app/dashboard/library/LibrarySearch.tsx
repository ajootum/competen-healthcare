"use client";

import { useState } from "react";

// Intelligent library search (Clinical Library spec §4): full-text search over
// the governed knowledge base via search_ckcm — frameworks, CPUs,
// competencies, skills, resources, policies, quality standards, knowledge
// objects and clinical cases — with quick-filter chips over result types.

type Hit = { object_type: string; object_id: string; title: string; snippet: string };

const TYPE_UI: Record<string, { label: string; icon: string; cls: string }> = {
  framework:      { label: "Framework",      icon: "🏛️", cls: "bg-teal-50 text-teal-700" },
  cpu:            { label: "Practice Unit",  icon: "🏥", cls: "bg-blue-50 text-blue-700" },
  competency:     { label: "Competency",     icon: "🪪", cls: "bg-violet-50 text-violet-700" },
  skill:          { label: "Skill",          icon: "✋", cls: "bg-indigo-50 text-indigo-600" },
  resource:       { label: "Learning",       icon: "📚", cls: "bg-amber-50 text-amber-700" },
  policy:         { label: "Policy",         icon: "📜", cls: "bg-gray-100 text-gray-600" },
  quality_object: { label: "Quality",        icon: "🛡️", cls: "bg-green-50 text-green-700" },
  knowledge:      { label: "Knowledge",      icon: "🫀", cls: "bg-rose-50 text-rose-700" },
  case:           { label: "Case Study",     icon: "🧑‍⚕️", cls: "bg-sky-50 text-sky-700" },
};

// Quick filter chips → the object types they include (spec §3)
const CHIPS: { label: string; icon: string; types: string[] }[] = [
  { label: "Guidelines & Policies", icon: "📜", types: ["policy"] },
  { label: "Procedures", icon: "🏥", types: ["cpu"] },
  { label: "Skills & Competencies", icon: "✋", types: ["skill", "competency"] },
  { label: "Knowledge & Cases", icon: "🫀", types: ["knowledge", "case"] },
  { label: "Quality Standards", icon: "🛡️", types: ["quality_object"] },
  { label: "Learning", icon: "📚", types: ["resource"] },
];

export default function LibrarySearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [chip, setChip] = useState<number | null>(null);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/library?q=${encodeURIComponent(q.trim())}`);
    setBusy(false);
    if (res.ok) setHits((await res.json()).hits);
  }

  const shown = (hits ?? []).filter(h => chip === null || CHIPS[chip].types.includes(h.object_type));

  return (
    <div>
      <form onSubmit={search} className="flex gap-2 mb-3">
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search guidelines, procedures, policies, skills… e.g. oxygen therapy"
          className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 bg-white"
        />
        <button type="submit" disabled={busy || !q.trim()}
          className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-5 rounded-xl transition-colors disabled:opacity-50">
          {busy ? "…" : "Search"}
        </button>
      </form>

      {/* Quick filters */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mr-1">Quick filters</span>
        {CHIPS.map((c, i) => (
          <button key={c.label} onClick={() => setChip(chip === i ? null : i)}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
              chip === i ? "border-teal-500 bg-teal-50 text-teal-800" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
            <span>{c.icon}</span>{c.label}
          </button>
        ))}
      </div>

      {hits !== null && (
        shown.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400 mb-5">
            {hits.length === 0
              ? <>No results for &ldquo;{q}&rdquo; — try different clinical terms, or ask the AI Coach.</>
              : "No results of this type — clear the quick filter to see all matches."}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 mb-5">
            {shown.map((h, i) => {
              const t = TYPE_UI[h.object_type] ?? TYPE_UI.policy;
              return (
                <div key={i} className="flex items-start gap-3 px-5 py-3.5">
                  <span className="text-lg mt-0.5">{t.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{h.title}</p>
                    {h.snippet && <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{h.snippet}</p>}
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${t.cls}`}>{t.label}</span>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
