"use client";

import { useState } from "react";

// CPU detail panel with tabs (mockup: Overview / Competencies / Knowledge /
// Cases / Assessments / Resources). All data is real and passed from the
// server; tabs are client-only view switching.

export type CpuDetailData = {
  code: string | null; name: string; description: string | null; risk: string | null;
  complexity: number | null; reassessMonths: number | null; pubStatus: string;
  competencies: { name: string; code: string | null }[];
  knowledge: { title: string; code: string | null }[];
  cases: { title: string }[];
  resources: string[];
  assessments: number;
};

const TABS = ["Overview", "Competencies", "Knowledge", "Cases", "Resources"] as const;

export default function CpuDetail({ cpu }: { cpu: CpuDetailData }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const count: Record<string, number> = {
    Competencies: cpu.competencies.length, Knowledge: cpu.knowledge.length,
    Cases: cpu.cases.length, Resources: cpu.resources.length,
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {cpu.code && <span className="text-[10px] font-mono text-gray-400">{cpu.code}</span>}
        <span className="text-xs font-bold text-gray-800">{cpu.name}</span>
        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${cpu.pubStatus === "published" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>{cpu.pubStatus}</span>
      </div>
      <div className="flex items-center gap-1 mb-3 flex-wrap border-b border-gray-100">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`text-[11px] px-2.5 py-1.5 -mb-px border-b-2 transition-colors ${tab === t ? "border-purple-500 text-purple-700 font-semibold" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t}{count[t] != null ? ` (${count[t]})` : ""}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="text-[11px] text-gray-600 space-y-1">
            {cpu.description && <p>{cpu.description}</p>}
            <p><span className="text-gray-400">Risk:</span> {cpu.risk ?? "—"} · <span className="text-gray-400">Complexity:</span> L{cpu.complexity ?? "—"}</p>
            {cpu.reassessMonths && <p><span className="text-gray-400">Reassess every:</span> {cpu.reassessMonths} months</p>}
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-center">
            {[["Competencies", cpu.competencies.length], ["Knowledge", cpu.knowledge.length], ["Cases", cpu.cases.length], ["Assessments", cpu.assessments]].map(([l, n]) => (
              <div key={l as string} className="bg-gray-50 rounded-lg p-1.5">
                <p className="text-sm font-bold text-gray-900">{n as number}</p>
                <p className="text-[8px] font-bold text-gray-400 uppercase">{l}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === "Competencies" && (
        <ul className="space-y-0.5">{cpu.competencies.map((c, i) => <li key={i} className="text-[11px] text-gray-600">{c.code ? <span className="text-gray-400 mr-1">{c.code}</span> : null}{c.name}</li>)}{!cpu.competencies.length && <li className="text-[10px] text-gray-400">None linked.</li>}</ul>
      )}
      {tab === "Knowledge" && (
        <ul className="space-y-0.5">{cpu.knowledge.map((k, i) => <li key={i} className="text-[11px] text-gray-600">📄 {k.code ? `${k.code} · ` : ""}{k.title}</li>)}{!cpu.knowledge.length && <li className="text-[10px] text-gray-400">No knowledge objects.</li>}</ul>
      )}
      {tab === "Cases" && (
        <ul className="space-y-0.5">{cpu.cases.map((c, i) => <li key={i} className="text-[11px] text-gray-600">🧪 {c.title}</li>)}{!cpu.cases.length && <li className="text-[10px] text-gray-400">No cases / simulations.</li>}</ul>
      )}
      {tab === "Resources" && (
        <ul className="space-y-0.5">{cpu.resources.map((r, i) => <li key={i} className="text-[11px] text-gray-600">📚 {r}</li>)}{!cpu.resources.length && <li className="text-[10px] text-gray-400">No linked resources.</li>}</ul>
      )}
    </div>
  );
}
