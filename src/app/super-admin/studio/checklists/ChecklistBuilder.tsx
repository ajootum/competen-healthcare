"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SCORING_METHOD_LABELS } from "@/lib/ckcm";

type SkillRow = { id: string; name: string; competency: string; framework: string };
type Checklist = { id: string; skill_id: string; name: string; description: string | null; assessor_instructions: string | null };
type Item = {
  id: string; checklist_id: string; item: string; section: string | null;
  is_critical: boolean; is_required: boolean; scoring_method: string;
  evidence_required: string | null; assessor_note: string | null; sort_order: number;
};

const EMPTY_ITEM = { item: "", section: "", is_critical: false, is_required: true, scoring_method: "done_not_done", evidence_required: "", assessor_note: "" };

export default function ChecklistBuilder({ skills, checklists, items }: {
  skills: SkillRow[]; checklists: Checklist[]; items: Item[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(checklists[0]?.id ?? null);
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSkill, setNewSkill] = useState("");
  const [newInstructions, setNewInstructions] = useState("");
  const [itemForm, setItemForm] = useState(EMPTY_ITEM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = checklists.find(c => c.id === selectedId) ?? null;
  const selectedSkill = selected ? skills.find(s => s.id === selected.skill_id) ?? null : null;
  const selectedItems = useMemo(() => items.filter(i => i.checklist_id === selectedId), [items, selectedId]);
  const sections = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of selectedItems) {
      const k = i.section?.trim() || "General";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    return m;
  }, [selectedItems]);
  const itemCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.checklist_id, (m.get(i.checklist_id) ?? 0) + 1);
    return m;
  }, [items]);

  const visibleChecklists = checklists.filter(c => !search.trim() || c.name.toLowerCase().includes(search.toLowerCase()));

  async function api(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    const res = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); return null; }
    router.refresh();
    return res.json();
  }

  const input = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30";
  const label = "text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_260px] gap-5">
      {/* LEFT — checklist library */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 self-start">
        <button onClick={() => setShowNew(v => !v)}
          className="w-full bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors mb-3">
          {showNew ? "Cancel" : "+ New Checklist"}
        </button>
        {showNew && (
          <div className="flex flex-col gap-2 mb-3 pb-3 border-b border-gray-100">
            <input className={input} placeholder="Checklist name" value={newName} onChange={e => setNewName(e.target.value)} />
            <select className={input} value={newSkill} onChange={e => setNewSkill(e.target.value)}>
              <option value="">For skill…</option>
              {skills.map(s => <option key={s.id} value={s.id}>{s.name} ({s.competency})</option>)}
            </select>
            <textarea className={input} rows={2} placeholder="Assessor instructions (optional)"
              value={newInstructions} onChange={e => setNewInstructions(e.target.value)} />
            <button disabled={busy || !newName.trim() || !newSkill}
              onClick={async () => {
                const r = await api({ kind: "checklist", skill_id: newSkill, name: newName.trim(), assessor_instructions: newInstructions });
                if (r) { setSelectedId(r.id); setShowNew(false); setNewName(""); setNewSkill(""); setNewInstructions(""); }
              }}
              className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors disabled:opacity-50">
              Create
            </button>
          </div>
        )}
        <input className={`${input} mb-2`} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex flex-col gap-1 max-h-96 overflow-y-auto">
          {visibleChecklists.length === 0 && <p className="text-xs text-gray-400 py-4 text-center">No checklists yet.</p>}
          {visibleChecklists.map(c => (
            <button key={c.id} onClick={() => { setSelectedId(c.id); setError(null); }}
              className={`text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                c.id === selectedId ? "bg-teal-50 text-teal-800 border border-teal-200" : "hover:bg-gray-50 text-gray-700"}`}>
              <span>☑️</span>
              <span className="flex-1 min-w-0 truncate">{c.name}</span>
              <span className="text-[9px] bg-gray-100 text-gray-500 rounded-full px-1.5 font-bold shrink-0">{itemCount.get(c.id) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* MIDDLE — items editor */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 self-start">
        {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}
        {!selected ? (
          <p className="text-sm text-gray-400 py-8 text-center">Select or create a checklist to edit its items.</p>
        ) : (
          <>
            <p className="font-bold text-gray-900 text-sm">{selected.name}</p>
            {selected.assessor_instructions && (
              <p className="text-[11px] text-gray-500 italic mt-1">Assessor: {selected.assessor_instructions}</p>
            )}

            {/* Existing items grouped by section */}
            <div className="mt-4 flex flex-col gap-4">
              {[...sections.entries()].map(([section, sectionItems]) => (
                <div key={section}>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">{section}</p>
                  <div className="flex flex-col gap-1">
                    {sectionItems.map(i => (
                      <div key={i.id} className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800">{i.item}</p>
                          <p className="text-[10px] text-gray-400">
                            {SCORING_METHOD_LABELS[i.scoring_method] ?? i.scoring_method}
                            {!i.is_required && " · optional"}
                            {i.evidence_required && ` · evidence: ${i.evidence_required}`}
                          </p>
                        </div>
                        {i.is_critical && <span className="text-[9px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-bold shrink-0">CRITICAL FAIL</span>}
                        <button disabled={busy} title="Delete item"
                          onClick={async () => { setBusy(true); await fetch(`/api/studio?kind=checklist_item&id=${i.id}`, { method: "DELETE" }); setBusy(false); router.refresh(); }}
                          className="text-gray-300 hover:text-red-500 text-xs shrink-0">✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {selectedItems.length === 0 && <p className="text-xs text-gray-400">No items yet — add the first one below.</p>}
            </div>

            {/* Add item */}
            <div className="mt-5 pt-4 border-t border-gray-100 flex flex-col gap-2.5">
              <p className="text-[10px] font-bold text-teal-600 uppercase tracking-widest">Add item</p>
              <input className={input} placeholder="Item statement — e.g. Confirms patient identity using two identifiers"
                value={itemForm.item} onChange={e => setItemForm(f => ({ ...f, item: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <input className={input} placeholder="Section — e.g. Before administration"
                  value={itemForm.section} onChange={e => setItemForm(f => ({ ...f, section: e.target.value }))} />
                <select className={input} value={itemForm.scoring_method}
                  onChange={e => setItemForm(f => ({ ...f, scoring_method: e.target.value }))}>
                  {Object.entries(SCORING_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input className={input} placeholder="Evidence required (optional)"
                  value={itemForm.evidence_required} onChange={e => setItemForm(f => ({ ...f, evidence_required: e.target.value }))} />
                <input className={input} placeholder="Assessor note (optional)"
                  value={itemForm.assessor_note} onChange={e => setItemForm(f => ({ ...f, assessor_note: e.target.value }))} />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={itemForm.is_critical}
                    onChange={e => setItemForm(f => ({ ...f, is_critical: e.target.checked }))} />
                  Critical fail
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={itemForm.is_required}
                    onChange={e => setItemForm(f => ({ ...f, is_required: e.target.checked }))} />
                  Required
                </label>
                <button disabled={busy || !itemForm.item.trim()}
                  onClick={async () => {
                    const r = await api({ kind: "checklist_item", checklist_id: selectedId, ...itemForm });
                    if (r) setItemForm(f => ({ ...EMPTY_ITEM, section: f.section }));
                  }}
                  className="ml-auto bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  Add item
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* RIGHT — relationships chain */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 self-start">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Linked chain</p>
        {!selectedSkill ? (
          <p className="text-xs text-gray-400">Select a checklist to see its place in the hierarchy.</p>
        ) : (
          <div className="flex flex-col gap-1 text-xs">
            {[
              { label: "Framework", value: selectedSkill.framework, icon: "🏛️" },
              { label: "Competency", value: selectedSkill.competency, icon: "🪪" },
              { label: "Skill", value: selectedSkill.name, icon: "✋" },
              { label: "Checklist", value: selected?.name ?? "", icon: "☑️" },
            ].map((row, i) => (
              <div key={row.label}>
                {i > 0 && <p className="text-gray-300 text-center leading-none">↓</p>}
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-[9px] font-bold text-gray-400 uppercase">{row.icon} {row.label}</p>
                  <p className="text-gray-800 leading-tight">{row.value}</p>
                </div>
              </div>
            ))}
            <p className="text-[10px] text-gray-400 mt-3">
              Critical-fail items block competency regardless of overall score.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
