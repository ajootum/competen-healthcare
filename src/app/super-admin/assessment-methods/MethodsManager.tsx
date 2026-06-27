"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Framework = { id: string; name: string };

export default function MethodsManager({ frameworks }: { frameworks: Framework[] }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const [form, setForm] = useState({
    framework_id: "", method: "direct_observation",
    is_required: false, min_assessors: "1", weight: "1",
  });

  async function save() {
    if (!form.framework_id || !form.method) return;
    setSaving(true);
    const res = await fetch("/api/content/methods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        framework_id: form.framework_id,
        method: form.method,
        is_required: form.is_required,
        min_assessors: parseInt(form.min_assessors),
        weight: parseFloat(form.weight),
      }),
    });
    setSaving(false);
    if (res.ok) { setOpen(false); router.refresh(); }
    else alert("Failed to save method config.");
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700">
        + Configure Method
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="font-bold text-gray-900 mb-4">Configure Assessment Method</h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Apply to Framework *</label>
                <select value={form.framework_id} onChange={e => setForm(p => ({ ...p, framework_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">Select framework…</option>
                  {frameworks.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Method *</label>
                <select value={form.method} onChange={e => setForm(p => ({ ...p, method: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="knowledge">Knowledge Assessment</option>
                  <option value="direct_observation">Direct Observation (Checklist)</option>
                  <option value="simulation">Simulation</option>
                  <option value="osce">OSCE</option>
                  <option value="concurrent_audit">Concurrent Audit</option>
                  <option value="retrospective_audit">Retrospective/Chart Audit</option>
                  <option value="logbook">Logbook</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Min Assessors</label>
                  <input type="number" min={1} value={form.min_assessors} onChange={e => setForm(p => ({ ...p, min_assessors: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Score Weight</label>
                  <input type="number" min={0.1} step={0.1} value={form.weight} onChange={e => setForm(p => ({ ...p, weight: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={form.is_required} onChange={e => setForm(p => ({ ...p, is_required: e.target.checked }))} className="w-4 h-4 accent-teal-500" />
                Required (nurses cannot skip this method)
              </label>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setOpen(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">Cancel</button>
              <button onClick={save} disabled={saving || !form.framework_id} className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {saving ? "Saving…" : "Save Config"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
