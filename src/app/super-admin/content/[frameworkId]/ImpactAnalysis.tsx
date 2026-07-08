"use client";
import { useState } from "react";

type Report = {
  entity: { type: string; id: string; name: string };
  affected: { label: string; count: number; items: string[] }[];
  edges: { relationship: string; target_type: string; target_id: string }[];
};

export default function ImpactAnalysis({ frameworkId }: { frameworkId: string }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);
  const [briefing, setBriefing] = useState(false);

  async function run() {
    setOpen(true); setLoading(true); setBrief(null);
    const res = await fetch(`/api/content/frameworks/${frameworkId}/impact`);
    if (res.ok) setReport(await res.json());
    setLoading(false);
  }

  async function aiBrief() {
    setBriefing(true);
    const res = await fetch("/api/ai/governance", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frameworkId }),
    });
    const d = await res.json();
    setBrief(res.ok ? d.answer : `⚠ ${d.error ?? "Briefing failed"}`);
    setBriefing(false);
  }

  const total = report?.affected.reduce((s, a) => s + a.count, 0) ?? 0;

  return (
    <>
      <button onClick={run}
        className="px-3 py-1.5 text-xs font-semibold bg-white border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-50 transition-colors">
        🔎 Impact Analysis
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 sticky top-0 bg-white">
              <div>
                <h2 className="font-bold text-gray-900">Change Impact Analysis</h2>
                <p className="text-sm text-gray-400">Downstream objects a change to this framework would affect</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
            </div>

            <div className="p-6">
              {loading ? (
                <p className="text-center text-sm text-gray-400 py-8">Computing dependency graph…</p>
              ) : report ? (
                <div className="flex flex-col gap-3">
                  <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                    <p className="text-sm text-amber-800">
                      <span className="font-bold">{total}</span> downstream object{total !== 1 ? "s" : ""} across{" "}
                      <span className="font-bold">{report.affected.length}</span> categor{report.affected.length !== 1 ? "ies" : "y"} would be affected.
                    </p>
                  </div>
                  {report.affected.map(a => (
                    <div key={a.label} className="rounded-lg border border-gray-100 px-4 py-2.5">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-800">{a.label}</p>
                        <span className="text-xs font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{a.count}</span>
                      </div>
                      {a.items.length > 0 && (
                        <p className="text-[10px] text-gray-400 mt-1 line-clamp-2">{a.items.slice(0, 12).join(" · ")}{a.items.length > 12 ? " …" : ""}</p>
                      )}
                    </div>
                  ))}
                  {report.edges.length > 0 && (
                    <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-4 py-2.5">
                      <p className="text-xs font-semibold text-indigo-700">{report.edges.length} explicit graph link{report.edges.length !== 1 ? "s" : ""}</p>
                    </div>
                  )}
                  <p className="text-[10px] text-gray-400 mt-1">
                    Review this before publishing changes — existing competency decisions remain linked to the version active at assessment time.
                  </p>

                  {/* AI governance briefing */}
                  <div className="border-t border-gray-100 pt-3 mt-1">
                    {brief ? (
                      <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl px-4 py-3">
                        <p className="text-[10px] font-bold text-indigo-700 uppercase tracking-widest mb-1.5">🤖 Governance Briefing</p>
                        <p className="text-xs text-gray-700 whitespace-pre-wrap">{brief}</p>
                      </div>
                    ) : (
                      <button onClick={aiBrief} disabled={briefing}
                        className="w-full py-2 text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
                        {briefing ? "Writing briefing…" : "🤖 Generate AI committee briefing"}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-center text-sm text-gray-400 py-8">No data.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
