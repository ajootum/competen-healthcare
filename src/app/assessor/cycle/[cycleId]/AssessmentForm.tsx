"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Level = { score: number; label: string; description?: string; color: string; is_passing: boolean };
type ChecklistItem = { id: string; item: string; is_critical: boolean; sort_order: number };
type Checklist = { id: string; name: string; checklist_items: ChecklistItem[] };
type Skill = { id: string; name: string; skill_checklists: Checklist[] };
type Criterion = { id: string; criterion: string; sort_order: number };
type MethodConfig = { id: string; method: string; is_required: boolean; min_assessors: number };
type Competency = {
  id: string; name: string; description?: string; sort_order: number;
  performance_criteria: Criterion[];
  competency_skills: Skill[];
  assessment_method_configs: MethodConfig[];
};
type Domain = { id: string; name: string; sort_order: number; framework_competencies: Competency[] };
type Framework = { id: string; name: string; library: string; framework_domains: Domain[] };
type CycleFramework = { id: string; status: string; framework_score?: number; frameworks: Framework | null };
type ExistingAssessment = {
  id: string; competency_id: string; assessor_id: string; method: string;
  score?: number; status: string; notes?: string; assessed_at?: string;
  profiles: { full_name: string } | null;
};

const METHOD_LABELS: Record<string, string> = {
  knowledge: "Knowledge Assessment", direct_observation: "Direct Observation",
  simulation: "Simulation", osce: "OSCE",
  concurrent_audit: "Concurrent Audit", retrospective_audit: "Retrospective Audit", logbook: "Logbook",
};
const ALL_METHODS = Object.keys(METHOD_LABELS);

export default function AssessmentForm({
  cycle,
  existingAssessments,
  levels,
  assessorId,
}: {
  cycle: { id: string; cycle_type: string; cycle_frameworks: CycleFramework[] };
  existingAssessments: ExistingAssessment[];
  levels: Level[];
  assessorId: string;
}) {
  const router = useRouter();
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [activeCompetency, setActiveCompetency] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scoreForm, setScoreForm] = useState<Record<string, { method: string; score: string; notes: string }>>({});

  function toggleDomain(id: string) {
    setExpandedDomains(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  function getExisting(competencyId: string) {
    return existingAssessments.filter(a => a.competency_id === competencyId);
  }

  function initScoreForm(competencyId: string, defaultMethod: string) {
    if (!scoreForm[competencyId]) {
      setScoreForm(p => ({ ...p, [competencyId]: { method: defaultMethod, score: "", notes: "" } }));
    }
    setActiveCompetency(activeCompetency === competencyId ? null : competencyId);
  }

  async function submitScore(competencyId: string) {
    const f = scoreForm[competencyId];
    if (!f?.method || f.score === "") return;
    setSaving(true);
    const res = await fetch("/api/assessments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cycle_id: cycle.id,
        competency_id: competencyId,
        method: f.method,
        score: parseInt(f.score),
        notes: f.notes || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setActiveCompetency(null);
      router.refresh();
    } else {
      alert("Failed to save assessment. Please try again.");
    }
  }

  const frameworks = (cycle.cycle_frameworks ?? []).map(cf => cf.frameworks).filter(Boolean) as Framework[];

  return (
    <div className="flex flex-col gap-6">
      {/* Scoring legend */}
      <div className="bg-white rounded-xl border border-gray-100 px-5 py-3">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Scoring Scale</p>
        <div className="flex flex-wrap gap-2">
          {levels.map(l => (
            <div key={l.score} className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
                style={{ backgroundColor: l.color }}>{l.score}</div>
              <span className="text-[10px] text-gray-600">{l.label}</span>
              {l.is_passing && <span className="text-[9px] text-green-500">✓</span>}
            </div>
          ))}
        </div>
      </div>

      {frameworks.map(fw => (
        <div key={fw.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-3.5 bg-gray-50/50 border-b border-gray-100">
            <p className="font-bold text-gray-900 text-sm">{fw.name}</p>
            <p className="text-[10px] text-gray-400 capitalize mt-0.5">{fw.library} library · {fw.framework_domains?.length ?? 0} domains</p>
          </div>

          <div className="divide-y divide-gray-50">
            {(fw.framework_domains ?? []).sort((a, b) => a.sort_order - b.sort_order).map(domain => {
              const competencies = domain.framework_competencies ?? [];
              const assessedCount = competencies.filter(c => getExisting(c.id).some(a => a.score != null)).length;
              return (
                <div key={domain.id}>
                  <div
                    className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-gray-50/30"
                    onClick={() => toggleDomain(domain.id)}>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-300 text-xs">{expandedDomains.has(domain.id) ? "▼" : "▶"}</span>
                      <p className="font-medium text-sm text-gray-800">{domain.name}</p>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-gray-400">
                      <span>{assessedCount}/{competencies.length} assessed</span>
                      {assessedCount === competencies.length && competencies.length > 0 && (
                        <span className="text-teal-500 font-semibold">✓ Complete</span>
                      )}
                    </div>
                  </div>

                  {expandedDomains.has(domain.id) && (
                    <div className="divide-y divide-gray-50 border-t border-gray-50">
                      {competencies.sort((a, b) => a.sort_order - b.sort_order).map(comp => {
                        const existing = getExisting(comp.id);
                        const myExisting = existing.filter(a => a.assessor_id === assessorId);
                        const myLatest = myExisting[myExisting.length - 1] as ExistingAssessment | undefined;
                        const othersScored = existing.filter(a => a.assessor_id !== assessorId && a.score != null);
                        const isActive = activeCompetency === comp.id;
                        const sf = scoreForm[comp.id];
                        const defaultMethod = comp.assessment_method_configs?.[0]?.method ?? "direct_observation";

                        return (
                          <div key={comp.id} className="pl-10">
                            <div className="flex items-center justify-between px-5 py-3">
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-800">{comp.name}</p>
                                {comp.description && <p className="text-[10px] text-gray-400 mt-0.5">{comp.description}</p>}
                                <div className="flex items-center gap-3 mt-1">
                                  {myLatest?.score != null && (
                                    <span className="text-[10px] font-semibold text-teal-600">
                                      My score: {myLatest.score} · {METHOD_LABELS[myLatest.method] ?? myLatest.method}
                                    </span>
                                  )}
                                  {othersScored.length > 0 && (
                                    <span className="text-[10px] text-gray-400">
                                      +{othersScored.length} other assessor{othersScored.length > 1 ? "s" : ""}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={() => initScoreForm(comp.id, defaultMethod)}
                                className={`ml-3 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                                  myLatest?.score != null
                                    ? "bg-teal-50 text-teal-600 border border-teal-100"
                                    : "bg-teal-600 text-white hover:bg-teal-700"
                                }`}>
                                {myLatest?.score != null ? "Re-assess" : "Assess"}
                              </button>
                            </div>

                            {/* Assessment panel */}
                            {isActive && (
                              <div className="mx-5 mb-4 bg-gray-50 rounded-xl p-4">
                                {/* Performance criteria */}
                                {(comp.performance_criteria ?? []).length > 0 && (
                                  <div className="mb-4">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Performance Criteria</p>
                                    <div className="flex flex-col gap-1">
                                      {(comp.performance_criteria ?? []).sort((a, b) => a.sort_order - b.sort_order).map((c, i) => (
                                        <p key={c.id} className="text-[11px] text-gray-600 flex gap-1.5">
                                          <span className="text-gray-300 shrink-0">{i + 1}.</span>{c.criterion}
                                        </p>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                <div className="flex flex-col gap-3">
                                  <div>
                                    <label className="text-xs font-semibold text-gray-500 mb-1 block">Assessment Method</label>
                                    <select
                                      value={sf?.method ?? defaultMethod}
                                      onChange={e => setScoreForm(p => ({ ...p, [comp.id]: { ...p[comp.id], method: e.target.value } }))}
                                      className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                                      {ALL_METHODS.map(m => (
                                        <option key={m} value={m}>{METHOD_LABELS[m]}</option>
                                      ))}
                                    </select>
                                  </div>

                                  <div>
                                    <label className="text-xs font-semibold text-gray-500 mb-2 block">Score (0–6)</label>
                                    <div className="flex gap-2 flex-wrap">
                                      {levels.map(l => (
                                        <button
                                          key={l.score}
                                          onClick={() => setScoreForm(p => ({ ...p, [comp.id]: { ...p[comp.id], score: String(l.score) } }))}
                                          className={`flex flex-col items-center px-3 py-2 rounded-xl border-2 transition-all ${
                                            sf?.score === String(l.score)
                                              ? "border-current shadow-md scale-105"
                                              : "border-transparent bg-white hover:border-gray-200"
                                          }`}
                                          style={sf?.score === String(l.score) ? { borderColor: l.color, color: l.color } : {}}>
                                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
                                            style={{ backgroundColor: l.color }}>{l.score}</div>
                                          <span className="text-[9px] font-semibold mt-1 text-center leading-tight max-w-[60px]"
                                            style={sf?.score === String(l.score) ? { color: l.color } : { color: "#6b7280" }}>
                                            {l.label}
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  <div>
                                    <label className="text-xs font-semibold text-gray-500 mb-1 block">Assessment Notes</label>
                                    <textarea
                                      value={sf?.notes ?? ""}
                                      onChange={e => setScoreForm(p => ({ ...p, [comp.id]: { ...p[comp.id], notes: e.target.value } }))}
                                      rows={2} placeholder="Observations, context, or justification for this score…"
                                      className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
                                  </div>

                                  <div className="flex gap-2">
                                    <button onClick={() => setActiveCompetency(null)}
                                      className="flex-1 py-2 border border-gray-200 bg-white rounded-lg text-sm text-gray-600">Cancel</button>
                                    <button
                                      onClick={() => submitScore(comp.id)}
                                      disabled={saving || sf?.score === ""}
                                      className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
                                      {saving ? "Saving…" : "Submit Score"}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
