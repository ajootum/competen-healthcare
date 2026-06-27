"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Framework = { id: string; name: string };

export default function PolicyEditor({ frameworks }: { frameworks: Framework[] }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const [form, setForm] = useState({
    title: "", policy_type: "clinical", version: "1.0",
    content: "", effective_date: "", review_date: "", framework_id: "",
  });

  async function save() {
    if (!form.title) return;
    setSaving(true);
    const res = await fetch("/api/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, framework_id: form.framework_id || null }),
    });
    setSaving(false);
    if (res.ok) { setOpen(false); setForm({ title: "", policy_type: "clinical", version: "1.0", content: "", effective_date: "", review_date: "", framework_id: "" }); router.refresh(); }
    else alert("Failed to save policy.");
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700">
        + New Policy
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="font-bold text-gray-900 mb-4">New Policy Document</h2>
            <div className="flex flex-col gap-3">
              <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                placeholder="Policy title *" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Type</label>
                  <select value={form.policy_type} onChange={e => setForm(p => ({ ...p, policy_type: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="clinical">Clinical</option>
                    <option value="hr">HR</option>
                    <option value="safety">Safety</option>
                    <option value="governance">Governance</option>
                    <option value="infection_control">Infection Control</option>
                    <option value="quality">Quality</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Version</label>
                  <input value={form.version} onChange={e => setForm(p => ({ ...p, version: e.target.value }))}
                    placeholder="1.0" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Link to Framework (optional)</label>
                <select value={form.framework_id} onChange={e => setForm(p => ({ ...p, framework_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">No framework link</option>
                  {frameworks.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Effective Date</label>
                  <input type="date" value={form.effective_date} onChange={e => setForm(p => ({ ...p, effective_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Review Date</label>
                  <input type="date" value={form.review_date} onChange={e => setForm(p => ({ ...p, review_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Policy Content</label>
                <textarea value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
                  rows={6} placeholder="Enter the full policy text here…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setOpen(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">Cancel</button>
              <button onClick={save} disabled={saving || !form.title} className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {saving ? "Saving…" : "Save Policy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
