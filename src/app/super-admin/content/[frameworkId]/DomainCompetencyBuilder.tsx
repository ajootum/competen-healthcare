"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type ChecklistItem = { id: string; item: string; is_critical: boolean; sort_order: number };
type Checklist = { id: string; name: string; is_active: boolean; checklist_items: ChecklistItem[] };
type Skill = { id: string; name: string; sort_order: number; is_active: boolean; skill_checklists: Checklist[] };
type Criterion = { id: string; criterion: string; sort_order: number; is_active: boolean };
type MethodConfig = { id: string; method: string; is_required: boolean; min_assessors: number; weight: number; is_active: boolean };
type Competency = {
  id: string; name: string; description?: string; sort_order: number; is_active: boolean;
  performance_criteria: Criterion[];
  competency_skills: Skill[];
  assessment_method_configs: MethodConfig[];
};
type Domain = {
  id: string; name: string; description?: string; sort_order: number; is_active: boolean;
  framework_competencies: Competency[];
};

const METHOD_LABELS: Record<string, string> = {
  knowledge: "Knowledge Assessment",
  direct_observation: "Direct Observation",
  simulation: "Simulation",
  osce: "OSCE",
  concurrent_audit: "Concurrent Audit",
  retrospective_audit: "Retrospective Audit",
  logbook: "Logbook",
};

export default function DomainCompetencyBuilder({ frameworkId, domains }: { frameworkId: string; domains: Domain[] }) {
  const router = useRouter();
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [expandedComps, setExpandedComps] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<Record<string, string>>({});

  // Modal state
  const [modal, setModal] = useState<{
    type: "domain" | "competency" | "criterion" | "skill" | "checklist" | "item" | "method" | null;
    parentId?: string;
    data?: Record<string, string | boolean | number>;
  }>({ type: null });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean | number>>({});

  function toggleDomain(id: string) {
    setExpandedDomains(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }
  function toggleComp(id: string) {
    setExpandedComps(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  function openModal(type: typeof modal.type, parentId?: string, prefill?: Record<string, string | boolean | number>) {
    setModal({ type, parentId });
    setForm(prefill ?? {});
  }

  async function save() {
    setSaving(true);
    let url = "";
    const pid = modal.parentId ?? "";
    let body: Record<string, string | boolean | number> = form;

    if (modal.type === "domain") {
      url = "/api/content/domains";
      body = { ...form, framework_id: frameworkId };
    } else if (modal.type === "competency") {
      url = "/api/content/competencies";
      body = { ...form, domain_id: pid };
    } else if (modal.type === "criterion") {
      url = "/api/content/criteria";
      body = { ...form, competency_id: pid };
    } else if (modal.type === "skill") {
      url = "/api/content/skills";
      body = { ...form, competency_id: pid };
    } else if (modal.type === "checklist") {
      url = "/api/content/checklists";
      body = { ...form, skill_id: pid };
    } else if (modal.type === "item") {
      url = "/api/content/checklist-items";
      body = { ...form, checklist_id: pid };
    } else if (modal.type === "method") {
      url = "/api/content/methods";
      body = { ...form, competency_id: pid };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) { setModal({ type: null }); router.refresh(); }
    else alert("Save failed. Please try again.");
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm text-gray-500">{domains.length} domains</span>
        <button onClick={() => openModal("domain")}
          className="px-3 py-1.5 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700">
          + Add Domain
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {domains.map(domain => (
          <div key={domain.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {/* Domain Header */}
            <div className="flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-gray-50/50"
              onClick={() => toggleDomain(domain.id)}>
              <div className="flex items-center gap-3">
                <span className="text-gray-300 text-xs">{expandedDomains.has(domain.id) ? "▼" : "▶"}</span>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{domain.name}</p>
                  <p className="text-[10px] text-gray-400">{domain.framework_competencies?.length ?? 0} competencies</p>
                </div>
              </div>
              <button onClick={e => { e.stopPropagation(); openModal("competency", domain.id); }}
                className="px-3 py-1 bg-indigo-50 text-indigo-600 text-xs font-semibold rounded-lg hover:bg-indigo-100">
                + Competency
              </button>
            </div>

            {/* Competencies */}
            {expandedDomains.has(domain.id) && (
              <div className="border-t border-gray-50 divide-y divide-gray-50">
                {(domain.framework_competencies ?? []).map(comp => (
                  <div key={comp.id}>
                    {/* Competency Row */}
                    <div className="flex items-center justify-between px-5 py-3 pl-10 cursor-pointer hover:bg-gray-50/30"
                      onClick={() => toggleComp(comp.id)}>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-200 text-xs">{expandedComps.has(comp.id) ? "▼" : "▶"}</span>
                        <div>
                          <p className="text-sm font-medium text-gray-800">{comp.name}</p>
                          <p className="text-[10px] text-gray-400">
                            {comp.performance_criteria?.length ?? 0} criteria · {comp.competency_skills?.length ?? 0} skills · {comp.assessment_method_configs?.length ?? 0} methods
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Competency Detail */}
                    {expandedComps.has(comp.id) && (
                      <div className="bg-gray-50/50 border-t border-gray-50 px-5 py-4 pl-14">
                        {/* Tabs */}
                        <div className="flex gap-1 mb-4">
                          {["criteria", "skills", "methods"].map(tab => (
                            <button key={tab} onClick={() => setActiveTab(p => ({ ...p, [comp.id]: tab }))}
                              className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                                (activeTab[comp.id] ?? "criteria") === tab
                                  ? "bg-white border border-gray-200 text-gray-800 shadow-sm"
                                  : "text-gray-400 hover:text-gray-600"
                              }`}>
                              {tab === "criteria" ? "Performance Criteria" : tab === "skills" ? "Skills & Checklists" : "Assessment Methods"}
                            </button>
                          ))}
                        </div>

                        {/* Performance Criteria */}
                        {(activeTab[comp.id] ?? "criteria") === "criteria" && (
                          <div>
                            <div className="flex flex-col gap-2 mb-3">
                              {(comp.performance_criteria ?? []).map((c, i) => (
                                <div key={c.id} className="flex items-start gap-2 text-xs text-gray-700">
                                  <span className="text-gray-300 mt-0.5">{i + 1}.</span>
                                  <span>{c.criterion}</span>
                                </div>
                              ))}
                              {!(comp.performance_criteria ?? []).length && (
                                <p className="text-xs text-gray-400 italic">No performance criteria yet</p>
                              )}
                            </div>
                            <button onClick={() => openModal("criterion", comp.id)}
                              className="text-xs text-teal-600 font-semibold hover:underline">+ Add Criterion</button>
                          </div>
                        )}

                        {/* Skills & Checklists */}
                        {activeTab[comp.id] === "skills" && (
                          <div>
                            {(comp.competency_skills ?? []).map(skill => (
                              <div key={skill.id} className="mb-3">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-xs font-semibold text-gray-700">🔹 {skill.name}</p>
                                  <button onClick={() => openModal("checklist", skill.id)}
                                    className="text-[10px] text-indigo-500 hover:underline">+ Checklist</button>
                                </div>
                                {(skill.skill_checklists ?? []).map(cl => (
                                  <div key={cl.id} className="ml-3 mb-2">
                                    <div className="flex items-center justify-between">
                                      <p className="text-[10px] font-medium text-gray-500">📋 {cl.name}</p>
                                      <button onClick={() => openModal("item", cl.id)}
                                        className="text-[10px] text-gray-400 hover:underline">+ Item</button>
                                    </div>
                                    {(cl.checklist_items ?? []).map((item, i) => (
                                      <div key={item.id} className="flex items-start gap-1.5 ml-3 mt-0.5">
                                        <span className="text-gray-300 text-[10px] mt-0.5">{i + 1}.</span>
                                        <span className="text-[10px] text-gray-600">{item.item}</span>
                                        {item.is_critical && <span className="text-[9px] bg-red-100 text-red-600 px-1 rounded">Critical</span>}
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            ))}
                            {!(comp.competency_skills ?? []).length && (
                              <p className="text-xs text-gray-400 italic mb-2">No skills yet</p>
                            )}
                            <button onClick={() => openModal("skill", comp.id)}
                              className="text-xs text-teal-600 font-semibold hover:underline">+ Add Skill</button>
                          </div>
                        )}

                        {/* Assessment Methods */}
                        {activeTab[comp.id] === "methods" && (
                          <div>
                            <div className="flex flex-col gap-2 mb-3">
                              {(comp.assessment_method_configs ?? []).map(m => (
                                <div key={m.id} className="flex items-center gap-2 text-xs">
                                  <span className="font-medium text-gray-700">{METHOD_LABELS[m.method] ?? m.method}</span>
                                  {m.is_required && <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded text-[10px]">Required</span>}
                                  <span className="text-gray-400">min {m.min_assessors} assessor{m.min_assessors > 1 ? "s" : ""}</span>
                                  <span className="text-gray-400">weight ×{m.weight}</span>
                                </div>
                              ))}
                              {!(comp.assessment_method_configs ?? []).length && (
                                <p className="text-xs text-gray-400 italic">No assessment methods configured</p>
                              )}
                            </div>
                            <button onClick={() => openModal("method", comp.id)}
                              className="text-xs text-teal-600 font-semibold hover:underline">+ Add Method</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {!(domain.framework_competencies ?? []).length && (
                  <p className="px-10 py-3 text-xs text-gray-400 italic">No competencies yet — click &quot;+ Competency&quot; above</p>
                )}
              </div>
            )}
          </div>
        ))}

        {!domains.length && (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
            <p className="text-gray-400 text-sm">No domains yet — click &quot;+ Add Domain&quot; to start building</p>
          </div>
        )}
      </div>

      {/* Modal */}
      {modal.type && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="font-bold text-gray-900 mb-4 capitalize">
              {modal.type === "criterion" ? "New Performance Criterion"
                : modal.type === "item" ? "New Checklist Item"
                : modal.type === "method" ? "Configure Assessment Method"
                : `New ${modal.type}`}
            </h2>

            <div className="flex flex-col gap-3">
              {/* Domain */}
              {modal.type === "domain" && (
                <>
                  <input value={String(form.name ?? "")} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="Domain name *" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  <textarea value={String(form.description ?? "")} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    rows={2} placeholder="Description (optional)"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
                </>
              )}

              {/* Competency */}
              {modal.type === "competency" && (
                <>
                  <input value={String(form.name ?? "")} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="Competency name *" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  <textarea value={String(form.description ?? "")} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    rows={2} placeholder="Description (optional)"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
                </>
              )}

              {/* Performance Criterion */}
              {modal.type === "criterion" && (
                <>
                  <textarea value={String(form.criterion ?? "")} onChange={e => setForm(p => ({ ...p, criterion: e.target.value }))}
                    rows={3} placeholder="Performance criterion text *"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
                  <textarea value={String(form.description ?? "")} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    rows={2} placeholder="Additional description (optional)"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
                </>
              )}

              {/* Skill */}
              {modal.type === "skill" && (
                <>
                  <input value={String(form.name ?? "")} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="Skill name *" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  <textarea value={String(form.description ?? "")} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    rows={2} placeholder="Description (optional)"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
                </>
              )}

              {/* Checklist */}
              {modal.type === "checklist" && (
                <input value={String(form.name ?? "")} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Checklist name *" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              )}

              {/* Checklist Item */}
              {modal.type === "item" && (
                <>
                  <textarea value={String(form.item ?? "")} onChange={e => setForm(p => ({ ...p, item: e.target.value }))}
                    rows={2} placeholder="Checklist item text *"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={Boolean(form.is_critical)} onChange={e => setForm(p => ({ ...p, is_critical: e.target.checked }))}
                      className="w-4 h-4 accent-red-500" />
                    Critical item (must pass)
                  </label>
                </>
              )}

              {/* Assessment Method */}
              {modal.type === "method" && (
                <>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">Method *</label>
                    <select value={String(form.method ?? "")} onChange={e => setForm(p => ({ ...p, method: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                      <option value="">Select method…</option>
                      {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-gray-500 mb-1 block">Min Assessors</label>
                      <input type="number" min={1} value={String(form.min_assessors ?? 1)} onChange={e => setForm(p => ({ ...p, min_assessors: parseInt(e.target.value) }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 mb-1 block">Weight</label>
                      <input type="number" min={0.1} step={0.1} value={String(form.weight ?? 1)} onChange={e => setForm(p => ({ ...p, weight: parseFloat(e.target.value) }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={Boolean(form.is_required)} onChange={e => setForm(p => ({ ...p, is_required: e.target.checked }))}
                      className="w-4 h-4 accent-teal-500" />
                    Required (not optional)
                  </label>
                </>
              )}
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setModal({ type: null })}
                className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={save} disabled={saving}
                className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
