"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Framework = { id: string; name: string };

export default function ScheduleManager({ frameworks }: { frameworks: Framework[] }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const [form, setForm] = useState({
    name: "", cycle_type: "annual", frequency_months: "12",
    grace_period_days: "30", framework_id: "",
    trigger_on_fail: true, trigger_on_expiry: true,
    trigger_on_role_change: false, auto_create_cycle: false,
  });

  async function save() {
    if (!form.name) return;
    setSaving(true);
    const res = await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        frequency_months: parseInt(form.frequency_months),
        grace_period_days: parseInt(form.grace_period_days),
        framework_id: form.framework_id || null,
      }),
    });
    setSaving(false);
    if (res.ok) { setOpen(false); router.refresh(); }
    else alert("Failed to save schedule.");
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700">
        + Add Schedule
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="font-bold text-gray-900 mb-4">New Reassessment Schedule</h2>
            <div className="flex flex-col gap-3">
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Schedule name *" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Cycle Type</label>
                <select value={form.cycle_type} onChange={e => setForm(p => ({ ...p, cycle_type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="orientation">Orientation</option>
                  <option value="probation">Probation</option>
                  <option value="annual">Annual</option>
                  <option value="remediation">Remediation</option>
                  <option value="specialty">Specialty</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Frequency (months)</label>
                  <input type="number" min={1} value={form.frequency_months} onChange={e => setForm(p => ({ ...p, frequency_months: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Grace Period (days)</label>
                  <input type="number" min={0} value={form.grace_period_days} onChange={e => setForm(p => ({ ...p, grace_period_days: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Link to Framework (optional)</label>
                <select value={form.framework_id} onChange={e => setForm(p => ({ ...p, framework_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">All frameworks (global)</option>
                  {frameworks.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={form.trigger_on_fail} onChange={e => setForm(p => ({ ...p, trigger_on_fail: e.target.checked }))} className="w-4 h-4 accent-teal-500" />
                  Trigger on fail
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={form.trigger_on_expiry} onChange={e => setForm(p => ({ ...p, trigger_on_expiry: e.target.checked }))} className="w-4 h-4 accent-teal-500" />
                  Trigger on expiry
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={form.trigger_on_role_change} onChange={e => setForm(p => ({ ...p, trigger_on_role_change: e.target.checked }))} className="w-4 h-4 accent-teal-500" />
                  Trigger on role change
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={form.auto_create_cycle} onChange={e => setForm(p => ({ ...p, auto_create_cycle: e.target.checked }))} className="w-4 h-4 accent-teal-500" />
                  Automatically create next cycle
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setOpen(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">Cancel</button>
              <button onClick={save} disabled={saving || !form.name} className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {saving ? "Saving…" : "Create Schedule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
