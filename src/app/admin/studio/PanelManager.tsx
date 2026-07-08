"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Cycle = {
  id: string;
  cycle_type: string;
  min_assessors: number;
  consensus_rule: string;
  nurse_name: string;
  panel: { assessor_id: string; assessor_name: string | null }[];
};
type Assessor = { id: string; full_name: string };

const RULE_LABEL: Record<string, string> = {
  any: "Any (first score wins)", majority: "Majority (mean)", unanimous: "Unanimous (lowest)",
};

export default function PanelManager({ cycles, assessors }: { cycles: Cycle[]; assessors: Assessor[] }) {
  const router = useRouter();
  const [adding, setAdding]   = useState<Record<string, string>>({});
  const [saving, setSaving]   = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  if (!cycles.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
        <p className="text-2xl mb-2">👥</p>
        <p className="text-gray-400 text-sm">No active cycles with multi-assessor panels.</p>
        <p className="text-[11px] text-gray-400 mt-1">Set Min Assessors &gt; 1 when creating a cycle to enable panels.</p>
      </div>
    );
  }

  async function addAssessor(cycleId: string) {
    const assessorId = adding[cycleId];
    if (!assessorId) return;
    setSaving(cycleId);
    await fetch(`/api/cycles/${cycleId}/panel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessor_id: assessorId }),
    });
    setSaving(null);
    setAdding(p => ({ ...p, [cycleId]: "" }));
    router.refresh();
  }

  async function removeAssessor(cycleId: string, assessorId: string) {
    setRemoving(assessorId);
    await fetch(`/api/cycles/${cycleId}/panel`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessor_id: assessorId }),
    });
    setRemoving(null);
    router.refresh();
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Assessment Panels</h2>
        <p className="text-xs text-gray-400 mt-1">Assign assessors to active multi-assessor cycles. Scores are finalised only when the required number of assessors have submitted.</p>
      </div>

      <div className="divide-y divide-gray-50">
        {cycles.map(cycle => {
          const panelIds = new Set(cycle.panel.map(p => p.assessor_id));
          const available = assessors.filter(a => !panelIds.has(a.id));
          return (
            <div key={cycle.id} className="px-5 py-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{cycle.nurse_name}</p>
                  <p className="text-[10px] text-gray-400 capitalize mt-0.5">
                    {cycle.cycle_type} · Requires {cycle.min_assessors} assessor{cycle.min_assessors !== 1 ? "s" : ""} · {RULE_LABEL[cycle.consensus_rule] ?? cycle.consensus_rule}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    cycle.panel.length >= cycle.min_assessors ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                  }`}>
                    {cycle.panel.length}/{cycle.min_assessors} assigned
                  </span>
                </div>
              </div>

              {/* Current panel */}
              {cycle.panel.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {cycle.panel.map(p => (
                    <span key={p.assessor_id}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-teal-50 border border-teal-100 rounded-lg text-xs text-teal-700 font-medium">
                      {p.assessor_name ?? p.assessor_id}
                      <button
                        onClick={() => removeAssessor(cycle.id, p.assessor_id)}
                        disabled={removing === p.assessor_id}
                        className="text-teal-400 hover:text-red-500 transition-colors ml-0.5 leading-none">
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Add assessor */}
              {available.length > 0 && (
                <div className="flex gap-2">
                  <select
                    value={adding[cycle.id] ?? ""}
                    onChange={e => setAdding(p => ({ ...p, [cycle.id]: e.target.value }))}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="">Add assessor…</option>
                    {available.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                  </select>
                  <button
                    onClick={() => addAssessor(cycle.id)}
                    disabled={!adding[cycle.id] || saving === cycle.id}
                    className="px-3 py-1.5 text-xs font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-40 transition-colors">
                    {saving === cycle.id ? "Adding…" : "Add"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
