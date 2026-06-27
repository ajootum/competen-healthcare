"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Nurse = { id: string; full_name: string };
type Framework = { id: string; name: string; library: string };

const LIBRARY_LABEL: Record<string, string> = { core: "Core Nursing", specialty: "Specialty", role: "Role-Based" };

export default function CycleManager({ nurses, frameworks }: { nurses: Nurse[]; frameworks: Framework[] }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const [form, setForm] = useState({
    nurse_id: "",
    cycle_type: "orientation",
    end_date: "",
    notes: "",
  });
  const [selectedFrameworks, setSelectedFrameworks] = useState<string[]>([]);

  function toggleFramework(id: string) {
    setSelectedFrameworks(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  }

  // Group frameworks by library
  const grouped = frameworks.reduce((acc, f) => {
    if (!acc[f.library]) acc[f.library] = [];
    acc[f.library].push(f);
    return acc;
  }, {} as Record<string, Framework[]>);

  async function save() {
    if (!form.nurse_id || !form.cycle_type) { setError("Select a nurse and cycle type"); return; }
    if (!selectedFrameworks.length) { setError("Select at least one framework"); return; }
    setSaving(true); setError("");

    const res = await fetch("/api/cycles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, framework_ids: selectedFrameworks }),
    });
    setSaving(false);
    if (res.ok) {
      setOpen(false);
      setForm({ nurse_id: "", cycle_type: "orientation", end_date: "", notes: "" });
      setSelectedFrameworks([]);
      router.refresh();
    } else {
      const d = await res.json();
      setError(d.error ?? "Failed to create cycle");
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700">
        + New Cycle
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="font-bold text-gray-900 mb-4">Start Competency Cycle</h2>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Nurse *</label>
                <select value={form.nurse_id} onChange={e => setForm(p => ({ ...p, nurse_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">Select nurse…</option>
                  {nurses.map(n => <option key={n.id} value={n.id}>{n.full_name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Cycle Type *</label>
                <select value={form.cycle_type} onChange={e => setForm(p => ({ ...p, cycle_type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="orientation">Orientation (new staff)</option>
                  <option value="probation">Probation</option>
                  <option value="annual">Annual Review</option>
                  <option value="remediation">Remediation</option>
                  <option value="specialty">Specialty Certification</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Due Date (optional)</label>
                <input type="date" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 mb-2 block">Frameworks to assess *</label>
                <div className="flex flex-col gap-3">
                  {Object.entries(grouped).map(([lib, fws]) => (
                    <div key={lib}>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">{LIBRARY_LABEL[lib] ?? lib}</p>
                      <div className="flex flex-col gap-1">
                        {fws.map(f => (
                          <label key={f.id} className="flex items-center gap-2.5 cursor-pointer group">
                            <input type="checkbox" checked={selectedFrameworks.includes(f.id)}
                              onChange={() => toggleFramework(f.id)}
                              className="w-4 h-4 accent-teal-500 flex-shrink-0" />
                            <span className="text-sm text-gray-700 group-hover:text-gray-900">{f.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Notes (optional)</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  rows={2} placeholder="Any instructions or context for this cycle…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
              </div>
            </div>

            {error && <p className="mt-3 text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-2 mt-5">
              <button onClick={() => setOpen(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">Cancel</button>
              <button onClick={save} disabled={saving}
                className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
                {saving ? "Starting…" : "Start Cycle"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
