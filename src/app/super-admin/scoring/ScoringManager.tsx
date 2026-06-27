"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Level = { id: string; score: number; label: string; description?: string; color: string; is_passing: boolean };
type Scale = { id: string; name: string; description?: string; min_score: number; max_score: number; is_default: boolean; scoring_levels?: Level[] };

export default function ScoringManager({ scales }: { scales: Scale[] }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"scale" | "level">("scale");
  const [saving, setSaving] = useState(false);
  const [scaleId, setScaleId] = useState(scales[0]?.id ?? "");
  const router = useRouter();

  const [scaleForm, setScaleForm] = useState({ name: "", description: "", min_score: "0", max_score: "6" });
  const [levelForm, setLevelForm] = useState({ score: "0", label: "", description: "", color: "#6b7280", is_passing: false });

  async function saveScale() {
    setSaving(true);
    const res = await fetch("/api/scoring/scales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...scaleForm, min_score: parseInt(scaleForm.min_score), max_score: parseInt(scaleForm.max_score) }),
    });
    setSaving(false);
    if (res.ok) { setOpen(false); router.refresh(); }
    else alert("Failed to save scale.");
  }

  async function saveLevel() {
    if (!scaleId) return;
    setSaving(true);
    const res = await fetch("/api/scoring/levels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...levelForm, score: parseInt(levelForm.score), scale_id: scaleId }),
    });
    setSaving(false);
    if (res.ok) { setOpen(false); router.refresh(); }
    else alert("Failed to save level.");
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700">
        + Add / Edit
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="font-bold text-gray-900 mb-4">Scoring Configuration</h2>

            <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1">
              <button onClick={() => setTab("scale")} className={`flex-1 py-1.5 text-sm rounded-md font-medium transition-colors ${tab === "scale" ? "bg-white shadow-sm text-gray-800" : "text-gray-400"}`}>New Scale</button>
              <button onClick={() => setTab("level")} className={`flex-1 py-1.5 text-sm rounded-md font-medium transition-colors ${tab === "level" ? "bg-white shadow-sm text-gray-800" : "text-gray-400"}`}>Add Level</button>
            </div>

            {tab === "scale" && (
              <div className="flex flex-col gap-3">
                <input value={scaleForm.name} onChange={e => setScaleForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Scale name *" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                <input value={scaleForm.description} onChange={e => setScaleForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Description" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Min Score</label>
                    <input type="number" value={scaleForm.min_score} onChange={e => setScaleForm(p => ({ ...p, min_score: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Max Score</label>
                    <input type="number" value={scaleForm.max_score} onChange={e => setScaleForm(p => ({ ...p, max_score: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => setOpen(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">Cancel</button>
                  <button onClick={saveScale} disabled={saving || !scaleForm.name} className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                    {saving ? "Saving…" : "Create Scale"}
                  </button>
                </div>
              </div>
            )}

            {tab === "level" && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Scale</label>
                  <select value={scaleId} onChange={e => setScaleId(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    {scales.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Score *</label>
                    <input type="number" value={levelForm.score} onChange={e => setLevelForm(p => ({ ...p, score: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Colour</label>
                    <input type="color" value={levelForm.color} onChange={e => setLevelForm(p => ({ ...p, color: e.target.value }))}
                      className="w-full h-9 border border-gray-200 rounded-lg px-1 py-1 cursor-pointer" />
                  </div>
                </div>
                <input value={levelForm.label} onChange={e => setLevelForm(p => ({ ...p, label: e.target.value }))}
                  placeholder="Label *  e.g. Competent+" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                <input value={levelForm.description} onChange={e => setLevelForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Description" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={levelForm.is_passing} onChange={e => setLevelForm(p => ({ ...p, is_passing: e.target.checked }))} className="w-4 h-4 accent-teal-500" />
                  This score is a passing level
                </label>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => setOpen(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">Cancel</button>
                  <button onClick={saveLevel} disabled={saving || !levelForm.label} className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                    {saving ? "Saving…" : "Add Level"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
