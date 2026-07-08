"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RECOGNITION_TYPE_LABELS } from "@/lib/ckcm";

type Worker = { id: string; full_name: string };
type Recognition = {
  id: string; nurse_id: string; recognition_type: string; title: string;
  description: string | null; awarded_by_name: string | null; awarded_at: string;
  profiles: { full_name: string } | null;
};

export default function RecognitionsManager({ workers, recognitions }: { workers: Worker[]; recognitions: Recognition[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ nurse_id: "", recognition_type: "excellence_award", title: "", description: "" });

  async function award() {
    if (!form.nurse_id || !form.title.trim()) { alert("Worker and title required"); return; }
    setBusy(true);
    const res = await fetch("/api/recognitions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, title: form.title.trim(), description: form.description || null }),
    });
    setBusy(false);
    if (res.ok) {
      setAdding(false);
      setForm({ nurse_id: "", recognition_type: "excellence_award", title: "", description: "" });
      router.refresh();
    } else alert((await res.json().catch(() => ({}))).error ?? "Failed");
  }

  async function del(r: Recognition) {
    if (!confirm(`Remove recognition "${r.title}"?`)) return;
    setBusy(true);
    await fetch(`/api/recognitions?id=${r.id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button onClick={() => setAdding(a => !a)} className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700">
          {adding ? "Cancel" : "+ Award Recognition"}
        </button>
      </div>

      {adding && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Worker *</label>
              <select value={form.nurse_id} onChange={e => setForm(p => ({ ...p, nurse_id: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="">Select…</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Type</label>
              <select value={form.recognition_type} onChange={e => setForm(p => ({ ...p, recognition_type: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                {Object.entries(RECOGNITION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
          </div>
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            placeholder="Title * (e.g. Q2 Excellence Award — ICU)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            rows={2} placeholder="Citation / reason (optional)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none" />
          <button onClick={award} disabled={busy}
            className="self-end px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50">
            {busy ? "Awarding…" : "Award"}
          </button>
        </div>
      )}

      {recognitions.map(r => {
        const t = RECOGNITION_TYPE_LABELS[r.recognition_type] ?? RECOGNITION_TYPE_LABELS.custom;
        return (
          <div key={r.id} className="bg-white rounded-xl border border-gray-100 px-5 py-4 flex items-start gap-3">
            <span className="text-2xl">{t.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-gray-900 text-sm">{r.title}</p>
                <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-semibold">{t.label}</span>
              </div>
              <p className="text-xs text-gray-600 mt-0.5">{r.profiles?.full_name ?? "—"}</p>
              {r.description && <p className="text-[11px] text-gray-400 mt-1 italic">&ldquo;{r.description}&rdquo;</p>}
              <p className="text-[10px] text-gray-400 mt-1">
                {new Date(r.awarded_at).toLocaleDateString()}{r.awarded_by_name && ` · awarded by ${r.awarded_by_name}`}
              </p>
            </div>
            <button onClick={() => del(r)} className="px-2.5 py-1 text-xs text-red-500 border border-red-100 rounded-lg hover:bg-red-50 shrink-0">Remove</button>
          </div>
        );
      })}

      {!recognitions.length && !adding && (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-2xl mb-2">🏆</p>
          <p className="text-gray-400 text-sm">No recognitions yet — celebrate excellence to boost engagement.</p>
        </div>
      )}
    </div>
  );
}
