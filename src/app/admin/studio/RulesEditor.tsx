"use client";
import { useState } from "react";

type Framework = { id: string; name: string; library: string };
type Rule = { framework_id: string; min_passing_score: number; min_passing_pct: number };

export default function RulesEditor({
  frameworks,
  initialRules,
}: {
  frameworks: Framework[];
  initialRules: Rule[];
}) {
  const [rules, setRules] = useState<Record<string, { score: number; pct: number }>>(() => {
    const map: Record<string, { score: number; pct: number }> = {};
    for (const r of initialRules) map[r.framework_id] = { score: r.min_passing_score, pct: r.min_passing_pct };
    return map;
  });
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved]   = useState<string | null>(null);

  function getRule(fid: string) {
    return rules[fid] ?? { score: 4, pct: 80 };
  }

  function setRule(fid: string, field: "score" | "pct", val: number) {
    setRules(p => ({ ...p, [fid]: { ...getRule(fid), [field]: val } }));
  }

  async function save(fid: string) {
    setSaving(fid);
    const r = getRule(fid);
    await fetch("/api/admin/studio", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "rules", framework_id: fid, min_passing_score: r.score, min_passing_pct: r.pct }),
    });
    setSaving(null);
    setSaved(fid);
    setTimeout(() => setSaved(null), 2000);
  }

  const BENNER = ["Training","Novice","Adv. Beginner","Competent","Competent+","Proficient","Expert"];

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Assessment Rules</h2>
        <p className="text-xs text-gray-400 mt-1">Set the minimum score and pass rate each framework requires for a nurse to be considered competent.</p>
      </div>
      <div className="divide-y divide-gray-50">
        {frameworks.map(f => {
          const r = getRule(f.id);
          return (
            <div key={f.id} className="px-5 py-4 flex items-center gap-4 flex-wrap">
              <div className="flex-1 min-w-[160px]">
                <p className="text-sm font-medium text-gray-900">{f.name}</p>
                <p className="text-[10px] text-gray-400 capitalize mt-0.5">{f.library} library</p>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Min Score</label>
                  <div className="flex items-center gap-1">
                    <select
                      value={r.score}
                      onChange={e => setRule(f.id, "score", parseInt(e.target.value))}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                      {BENNER.map((label, i) => (
                        <option key={i} value={i}>{i} — {label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Pass Rate</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number" min={0} max={100}
                      value={r.pct}
                      onChange={e => setRule(f.id, "pct", parseInt(e.target.value) || 0)}
                      className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-teal-500" />
                    <span className="text-xs text-gray-400">%</span>
                  </div>
                </div>

                <button
                  onClick={() => save(f.id)}
                  disabled={saving === f.id}
                  className="mt-4 px-3 py-1.5 text-xs font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
                  {saving === f.id ? "Saving…" : saved === f.id ? "✓ Saved" : "Save"}
                </button>
              </div>
            </div>
          );
        })}
        {!frameworks.length && (
          <div className="px-5 py-8 text-center text-xs text-gray-400">No active frameworks.</div>
        )}
      </div>
    </div>
  );
}
