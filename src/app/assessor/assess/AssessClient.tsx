"use client";

import { useState, useCallback } from "react";

type Competency = { id: string; name: string; sort_order: number };
type Domain = { id: string; name: string; sort_order: number; framework_competencies: Competency[] };
type Framework = { id: string; name: string; library: string; framework_domains: Domain[] };

type Props = {
  cycleId: string;
  nurseId: string;
  nurseName: string;
  cycleType: string;
  frameworks: Framework[];
  existing: Record<string, number>;
};

const LEVELS = [
  { score: 0, short: "0 – Training Required",         desc: "Requires training to perform this activity satisfactorily." },
  { score: 1, short: "1 – Novice",                    desc: "Can perform with constant supervision and some assistance." },
  { score: 2, short: "2 – Advanced Beginner",         desc: "Can perform satisfactorily but requires some supervision." },
  { score: 3, short: "3 – Competent",                 desc: "Can perform satisfactorily without supervision." },
  { score: 4, short: "4 – Competent (Speed)",         desc: "Performs without supervision with more than acceptable speed and quality." },
  { score: 5, short: "5 – Proficient",                desc: "Performs with initiative and adaptability to special problem situations." },
  { score: 6, short: "6 – Expert",                    desc: "Can lead others in performing this activity." },
];

const SCORE_COLORS: Record<number, string> = {
  0: "border-red-300 bg-red-50 text-red-700",
  1: "border-orange-300 bg-orange-50 text-orange-700",
  2: "border-yellow-300 bg-yellow-50 text-yellow-700",
  3: "border-teal-300 bg-teal-50 text-teal-700",
  4: "border-teal-400 bg-teal-100 text-teal-800",
  5: "border-blue-300 bg-blue-50 text-blue-700",
  6: "border-purple-300 bg-purple-50 text-purple-700",
};

export default function AssessClient({ cycleId, nurseId, nurseName, cycleType, frameworks, existing }: Props) {
  const [scores, setScores] = useState<Record<string, number>>(existing);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [activeComp, setActiveComp] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFramework, setActiveFramework] = useState(frameworks[0]?.id ?? null);

  const setScore = useCallback((compId: string, score: number) => {
    setScores(prev => ({ ...prev, [compId]: score }));
    setSaved(false);
  }, []);

  const totalComps = frameworks.flatMap(f => f.framework_domains.flatMap(d => d.framework_competencies)).length;
  const scoredCount = Object.keys(scores).length;
  const pct = totalComps > 0 ? Math.round(scoredCount / totalComps * 100) : 0;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = Object.entries(scores).map(([competency_id, score]) => ({
        competency_id,
        score,
        notes: notes[competency_id] ?? undefined,
      }));
      const res = await fetch("/api/assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycle_id: cycleId, nurse_id: nurseId, scores: payload }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Save failed");
      } else {
        setSaved(true);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const currentFramework = frameworks.find(f => f.id === activeFramework);

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">Assessment in Progress</p>
            <h1 className="text-lg font-bold text-gray-900 mt-0.5">{nurseName}</h1>
            <p className="text-xs text-gray-500 capitalize">{cycleType} Cycle</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">{scoredCount}/{totalComps}</p>
              <p className="text-[10px] text-gray-400 font-semibold uppercase">Competencies Scored</p>
            </div>
            <button
              onClick={handleSave}
              disabled={saving || scoredCount === 0}
              className="bg-teal-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-teal-700 disabled:opacity-40 transition-colors min-w-[100px]">
              {saving ? "Saving…" : saved ? "Saved ✓" : "Save Scores"}
            </button>
          </div>
        </div>
        <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[10px] text-gray-400 mt-1">{pct}% of competencies scored</p>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>

      {/* Level reference */}
      <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 mb-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {LEVELS.map(l => (
            <div key={l.score} className={`rounded-lg p-2 border text-center cursor-help ${SCORE_COLORS[l.score]}`} title={l.desc}>
              <p className="text-lg font-bold">{l.score}</p>
              <p className="text-[9px] font-semibold leading-tight">{l.score === 0 ? "Training" : l.short.split(" – ")[1]}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Framework tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {frameworks.map(f => {
          const fComps = f.framework_domains.flatMap(d => d.framework_competencies);
          const fScored = fComps.filter(c => scores[c.id] !== undefined).length;
          return (
            <button key={f.id}
              onClick={() => setActiveFramework(f.id)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                f.id === activeFramework
                  ? "bg-teal-600 text-white border-teal-600"
                  : "bg-white text-gray-600 border-gray-200 hover:border-teal-300"
              }`}>
              {f.name}
              <span className="ml-1.5 opacity-70">({fScored}/{fComps.length})</span>
            </button>
          );
        })}
      </div>

      {/* Scoring grid */}
      {currentFramework && (
        <div className="space-y-4">
          {currentFramework.framework_domains
            .sort((a, b) => a.sort_order - b.sort_order)
            .map(domain => {
              const comps = [...domain.framework_competencies].sort((a, b) => a.sort_order - b.sort_order);
              const domainScored = comps.filter(c => scores[c.id] !== undefined).length;
              return (
                <div key={domain.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-semibold text-sm text-gray-900">{domain.name}</h3>
                    <span className="text-[10px] text-gray-400">{domainScored}/{comps.length} scored</span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {comps.map(comp => {
                      const currentScore = scores[comp.id];
                      const isActive = activeComp === comp.id;
                      return (
                        <div key={comp.id} className="px-5 py-3">
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800">{comp.name}</p>
                              {isActive && (
                                <input
                                  className="mt-1 text-xs border border-gray-200 rounded px-2 py-1 w-full text-gray-600 focus:outline-none focus:border-teal-400"
                                  placeholder="Add observation note (optional)…"
                                  value={notes[comp.id] ?? ""}
                                  onChange={e => setNotes(prev => ({ ...prev, [comp.id]: e.target.value }))}
                                />
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {[0, 1, 2, 3, 4, 5, 6].map(score => (
                                <button key={score}
                                  onClick={() => {
                                    setScore(comp.id, score);
                                    setActiveComp(comp.id);
                                  }}
                                  title={LEVELS[score].desc}
                                  className={`w-7 h-7 rounded text-xs font-bold border transition-all ${
                                    currentScore === score
                                      ? SCORE_COLORS[score] + " ring-2 ring-offset-1 ring-current"
                                      : "border-gray-200 bg-white text-gray-400 hover:border-gray-400"
                                  }`}>
                                  {score}
                                </button>
                              ))}
                              {currentScore !== undefined && (
                                <button
                                  onClick={() => {
                                    setScores(prev => { const n = { ...prev }; delete n[comp.id]; return n; });
                                    setSaved(false);
                                  }}
                                  className="w-7 h-7 rounded text-xs text-gray-400 hover:text-red-500 hover:border-red-200 border border-transparent transition-colors"
                                  title="Clear">
                                  ×
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <p className="text-xs text-gray-400">{scoredCount} of {totalComps} competencies scored</p>
        <button
          onClick={handleSave}
          disabled={saving || scoredCount === 0}
          className="bg-teal-600 text-white text-sm font-semibold px-6 py-2.5 rounded-lg hover:bg-teal-700 disabled:opacity-40 transition-colors">
          {saving ? "Saving…" : saved ? "All Saved ✓" : "Save All Scores"}
        </button>
      </div>
    </div>
  );
}
