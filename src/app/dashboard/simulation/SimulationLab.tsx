"use client";

import { useState } from "react";
import Link from "next/link";

// Scenario library (Simulation Lab Redesign spec §3): curated scenario briefs
// that launch REAL interactive AI simulations in the Clinical Coach, plus the
// governed clinical case studies with their think-first readers.

export type Scenario = {
  id: string; title: string; category: string; difficulty: string; duration: string;
  description: string; skills: string[]; prompt: string;
};
export type GovernedCase = { id: string; title: string; difficulty: string | null; cpuName: string | null };

const DIFF_CLS: Record<string, string> = {
  Easy: "bg-green-100 text-green-700",
  Medium: "bg-amber-100 text-amber-700",
  Hard: "bg-red-100 text-red-600",
  beginner: "bg-green-100 text-green-700",
  intermediate: "bg-amber-100 text-amber-700",
  advanced: "bg-red-100 text-red-600",
};
const CAT_ICON: Record<string, string> = {
  Emergency: "🚨", "Critical Care": "❤️", Pediatrics: "👶", Pharmacology: "💊",
  Surgery: "🔪", "Maternal Health": "🤱", Neurology: "🧠",
};

export default function SimulationLab({ scenarios, cases }: { scenarios: Scenario[]; cases: GovernedCase[] }) {
  const [cat, setCat] = useState("All Scenarios");
  const [q, setQ] = useState("");

  const categories = ["All Scenarios", ...new Set(scenarios.map(s => s.category))];
  const filtered = scenarios.filter(s => {
    if (cat !== "All Scenarios" && s.category !== cat) return false;
    const t = q.trim().toLowerCase();
    if (t && ![s.title, s.category, s.description, ...s.skills].some(v => v.toLowerCase().includes(t))) return false;
    return true;
  });
  const filteredCases = cases.filter(c => {
    const t = q.trim().toLowerCase();
    return !t || [c.title, c.cpuName ?? ""].some(v => v.toLowerCase().includes(t));
  });

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {categories.map(c => (
          <button key={c} onClick={() => setCat(c)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
              cat === c ? "bg-teal-600 border-teal-600 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
            {c}
          </button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search scenarios…"
          className="ml-auto border border-gray-200 rounded-lg px-3 py-1.5 text-xs w-44 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
      </div>

      {/* AI scenario cards */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        {filtered.map(s => (
          <div key={s.id} className="bg-white rounded-xl border border-gray-100 p-4 flex flex-col">
            <div className="flex items-start justify-between mb-2">
              <span className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-lg">{CAT_ICON[s.category] ?? "🩺"}</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${DIFF_CLS[s.difficulty] ?? "bg-gray-100 text-gray-600"}`}>{s.difficulty}</span>
            </div>
            <p className="text-sm font-bold text-gray-900 leading-snug">{s.title}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{s.category} · ⏱ {s.duration}</p>
            <p className="text-[11px] text-gray-500 mt-1.5 leading-snug flex-1">{s.description}</p>
            <p className="text-[9px] text-gray-400 mt-1.5 line-clamp-1" title={s.skills.join(", ")}>
              🎯 {s.skills.slice(0, 2).join(" · ")}{s.skills.length > 2 ? " …" : ""}
            </p>
            <Link href={`/dashboard/copilot?scenario=${encodeURIComponent(s.prompt)}`}
              className="mt-3 text-center text-xs font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 py-2 rounded-lg transition-colors">
              ▶ Start Scenario
            </Link>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full text-center text-xs text-gray-400 py-8">No scenarios match. Clear the filters to see all.</p>
        )}
      </div>

      {/* Governed case studies */}
      {filteredCases.length > 0 && (
        <div className="mb-2">
          <h2 className="font-semibold text-gray-900 text-sm mb-1">Governed Case Studies</h2>
          <p className="text-[10px] text-gray-400 mb-3">Worked scenarios from your organisation&apos;s clinical practice units — think first, then reveal the expert reasoning.</p>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {filteredCases.map(c => (
              <Link key={c.id} href={`/dashboard/knowledge/case/${c.id}`}
                className="bg-white rounded-xl border border-gray-100 hover:border-teal-300 p-4 transition-colors group">
                <p className="text-sm font-medium text-gray-800 group-hover:text-teal-700 leading-snug">{c.title}</p>
                <div className="flex items-center gap-1.5 mt-2">
                  {c.cpuName && <span className="text-[9px] font-semibold bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded truncate max-w-[130px]">{c.cpuName}</span>}
                  {c.difficulty && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded capitalize ${DIFF_CLS[c.difficulty] ?? "bg-gray-100 text-gray-600"}`}>{c.difficulty}</span>}
                  <span className="ml-auto text-[10px] text-teal-600 font-semibold">Work through →</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
