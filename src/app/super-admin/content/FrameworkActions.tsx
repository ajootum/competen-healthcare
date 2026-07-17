"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function FrameworkActions({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", library: "core", description: "" });
  const router = useRouter();

  async function save() {
    if (!form.name.trim()) return;
    setLoading(true);
    const res = await fetch("/api/content/frameworks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (res.ok) { setOpen(false); setForm({ name: "", library: "core", description: "" }); router.refresh(); }
    else alert("Failed to create framework.");
  }

  return (
    <>
      <button onClick={() => setOpen(true)} title="New framework"
        className={compact
          ? "text-xs font-semibold text-gray-500 border border-gray-200 hover:bg-gray-50 px-2 py-1 rounded-lg"
          : "px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-colors"}>
        {compact ? "+ New" : "+ Add Framework"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="font-bold text-gray-900 mb-4">New Framework</h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Framework Name *</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Core Nursing Framework"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Library</label>
                <select value={form.library} onChange={e => setForm(p => ({ ...p, library: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="core">Core Nursing</option>
                  <option value="specialty">Specialty</option>
                  <option value="role">Role-Based</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Description</label>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={2} placeholder="Brief description..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setOpen(false)}
                className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={save} disabled={loading || !form.name.trim()}
                className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
                {loading ? "Saving…" : "Create Framework"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
