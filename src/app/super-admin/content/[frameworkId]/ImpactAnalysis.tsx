"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/interactive";

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
        className="px-3 py-1.5 text-xs font-semibold bg-white border border-[var(--cmp-color-warning)] text-[var(--cmp-text-warning)] rounded-lg hover:bg-[var(--cmp-surface-warning)] transition-colors">
        🔎 Impact Analysis
      </button>

      {open && (
        <Modal open title="Change Impact Analysis" onClose={() => setOpen(false)} width="lg">
          {/* The strapline moves into the body: Modal's header takes an accessible name, not a name and a
              description, and this sentence is what tells you what the list below actually is. */}
          <p className="text-sm text-gray-500 -mt-2 mb-4">Downstream objects a change to this framework would affect</p>
          <div>
              {loading ? (
                <p className="text-center text-sm text-gray-500 py-8">Computing dependency graph…</p>
              ) : report ? (
                <div className="flex flex-col gap-3">
                  <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl px-4 py-3">
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
                        <p className="text-[10px] text-gray-500 mt-1 line-clamp-2">{a.items.slice(0, 12).join(" · ")}{a.items.length > 12 ? " …" : ""}</p>
                      )}
                    </div>
                  ))}
                  {report.edges.length > 0 && (
                    <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-4 py-2.5">
                      <p className="text-xs font-semibold text-indigo-700">{report.edges.length} explicit graph link{report.edges.length !== 1 ? "s" : ""}</p>
                    </div>
                  )}
                  <p className="text-[10px] text-gray-500 mt-1">
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
                <p className="text-center text-sm text-gray-500 py-8">No data.</p>
              )}
          </div>
        </Modal>
      )}
    </>
  );
}
