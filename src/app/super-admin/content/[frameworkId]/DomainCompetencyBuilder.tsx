"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Skill = { id: string; name: string; sort_order: number; is_active: boolean };
type Competency = {
  id: string; name: string; description?: string | null; sort_order: number;
  competency_skills: Skill[];
};
type Domain = {
  id: string; name: string; sort_order: number;
  framework_competencies: Competency[];
};

type ModalState =
  | { type: "add-domain" }
  | { type: "add-competency"; domainId: string }
  | { type: "add-skill"; competencyId: string }
  | { type: "edit-domain"; id: string; name: string }
  | { type: "edit-competency"; id: string; name: string; description: string }
  | { type: "edit-skill"; id: string; name: string }
  | { type: "delete-domain"; id: string; name: string }
  | { type: "delete-competency"; id: string; name: string }
  | { type: "delete-skill"; id: string; name: string };

export default function DomainCompetencyBuilder({ frameworkId, domains }: { frameworkId: string; domains: Domain[] }) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  function openAdd(m: ModalState) { setModal(m); setForm({ name: "", description: "" }); }
  function openEdit(m: ModalState & { name: string }) {
    setModal(m);
    setForm({ name: m.name, description: ("description" in m ? m.description : "") as string });
  }

  async function callApi(url: string, method: string, body?: object) {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.ok;
  }

  async function save() {
    if (!modal) return;
    setSaving(true);
    let ok = false;

    if (modal.type === "add-domain") {
      ok = await callApi("/api/content/domains", "POST", { name: form.name, framework_id: frameworkId });
    } else if (modal.type === "add-competency") {
      ok = await callApi("/api/content/competencies", "POST", { name: form.name, description: form.description, domain_id: modal.domainId });
    } else if (modal.type === "add-skill") {
      ok = await callApi("/api/content/skills", "POST", { name: form.name, competency_id: modal.competencyId });
    } else if (modal.type === "edit-domain") {
      ok = await callApi(`/api/content/domains?id=${modal.id}`, "PATCH", { name: form.name });
    } else if (modal.type === "edit-competency") {
      ok = await callApi(`/api/content/competencies?id=${modal.id}`, "PATCH", { name: form.name, description: form.description });
    } else if (modal.type === "edit-skill") {
      ok = await callApi(`/api/content/skills?id=${modal.id}`, "PATCH", { name: form.name });
    } else if (modal.type === "delete-domain") {
      ok = await callApi(`/api/content/domains?id=${modal.id}`, "DELETE");
    } else if (modal.type === "delete-competency") {
      ok = await callApi(`/api/content/competencies?id=${modal.id}`, "DELETE");
    } else if (modal.type === "delete-skill") {
      ok = await callApi(`/api/content/skills?id=${modal.id}`, "DELETE");
    }

    setSaving(false);
    if (ok) { setModal(null); router.refresh(); }
    else alert("Operation failed. Please try again.");
  }

  const isDelete = modal?.type.startsWith("delete");
  const isEdit = modal?.type.startsWith("edit");
  const needsDescription = modal?.type === "add-competency" || modal?.type === "edit-competency";

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm text-gray-500">{domains.length} domains</span>
        <button onClick={() => openAdd({ type: "add-domain" })}
          className="px-3 py-1.5 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700">
          + Add Domain
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {domains.map(domain => (
          <div key={domain.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {/* Domain Header */}
            <div className="flex items-center justify-between px-5 py-3.5 bg-gray-50/60 border-b border-gray-100">
              <div>
                <p className="font-semibold text-gray-900 text-sm">{domain.name}</p>
                <p className="text-[10px] text-gray-400">{domain.framework_competencies?.length ?? 0} competencies</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => openEdit({ type: "edit-domain", id: domain.id, name: domain.name })}
                  className="px-2.5 py-1 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-100">
                  Edit
                </button>
                <button onClick={() => setModal({ type: "delete-domain", id: domain.id, name: domain.name })}
                  className="px-2.5 py-1 text-xs text-red-500 border border-red-100 rounded-lg hover:bg-red-50">
                  Delete
                </button>
                <button onClick={() => openAdd({ type: "add-competency", domainId: domain.id })}
                  className="px-3 py-1 bg-indigo-50 text-indigo-600 text-xs font-semibold rounded-lg hover:bg-indigo-100">
                  + Competency
                </button>
              </div>
            </div>

            {/* Competencies */}
            <div className="divide-y divide-gray-50">
              {(domain.framework_competencies ?? []).map(comp => (
                <div key={comp.id} className="px-5 py-3 pl-8">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{comp.name}</p>
                      <p className="text-[10px] text-gray-400">{comp.competency_skills?.length ?? 0} skills</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-4">
                      <button
                        onClick={() => openEdit({ type: "edit-competency", id: comp.id, name: comp.name, description: comp.description ?? "" })}
                        className="px-2 py-0.5 text-[11px] text-gray-500 border border-gray-200 rounded hover:bg-gray-100">
                        Edit
                      </button>
                      <button
                        onClick={() => setModal({ type: "delete-competency", id: comp.id, name: comp.name })}
                        className="px-2 py-0.5 text-[11px] text-red-500 border border-red-100 rounded hover:bg-red-50">
                        Delete
                      </button>
                      <button
                        onClick={() => openAdd({ type: "add-skill", competencyId: comp.id })}
                        className="px-2 py-0.5 text-[11px] text-teal-600 border border-teal-200 rounded hover:bg-teal-50 font-semibold">
                        + Skill
                      </button>
                    </div>
                  </div>
                  {/* Skills as pills with delete */}
                  <div className="flex flex-wrap gap-1.5">
                    {(comp.competency_skills ?? []).map(skill => (
                      <span key={skill.id}
                        className="group inline-flex items-center gap-1 text-xs bg-teal-50 border border-teal-100 text-teal-700 pl-2.5 pr-1.5 py-0.5 rounded-full">
                        {skill.name}
                        <button
                          onClick={() => openEdit({ type: "edit-skill", id: skill.id, name: skill.name })}
                          className="opacity-0 group-hover:opacity-100 text-teal-400 hover:text-teal-700 transition-opacity text-[10px] leading-none px-0.5"
                          title="Edit skill">
                          ✎
                        </button>
                        <button
                          onClick={() => setModal({ type: "delete-skill", id: skill.id, name: skill.name })}
                          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity leading-none px-0.5"
                          title="Remove skill">
                          ×
                        </button>
                      </span>
                    ))}
                    {!(comp.competency_skills ?? []).length && (
                      <p className="text-xs text-gray-300 italic">No skills yet</p>
                    )}
                  </div>
                </div>
              ))}
              {!(domain.framework_competencies ?? []).length && (
                <p className="px-8 py-3 text-xs text-gray-400 italic">No competencies yet</p>
              )}
            </div>
          </div>
        ))}

        {!domains.length && (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
            <p className="text-gray-400 text-sm">No domains yet — click &quot;+ Add Domain&quot; to start building</p>
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="font-bold text-gray-900 mb-4">
              {isDelete
                ? `Delete ${modal.type.replace("delete-", "")}`
                : isEdit
                  ? `Edit ${modal.type.replace("edit-", "")}`
                  : `New ${modal.type.replace("add-", "")}`}
            </h2>

            {isDelete ? (
              <p className="text-sm text-gray-600 mb-5">
                Are you sure you want to delete <span className="font-semibold">&quot;{"name" in modal ? modal.name : ""}&quot;</span>?
                {modal.type === "delete-domain" && " This will also remove all competencies and skills inside it."}
                {modal.type === "delete-competency" && " This will also remove all skills inside it."}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <input
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Name *"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  autoFocus
                />
                {needsDescription && (
                  <textarea
                    value={form.description}
                    onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    rows={2}
                    placeholder="Description (optional)"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                  />
                )}
              </div>
            )}

            <div className="flex gap-2 mt-5">
              <button onClick={() => setModal(null)}
                className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 ${
                  isDelete
                    ? "bg-red-500 text-white hover:bg-red-600"
                    : "bg-teal-600 text-white hover:bg-teal-700"
                }`}>
                {saving ? "…" : isDelete ? "Delete" : isEdit ? "Save changes" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
