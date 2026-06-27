"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Step = { order: number; role: string; action: string; notify: boolean; deadline_days: number };

export default function WorkflowManager() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const [form, setForm] = useState({ name: "", description: "", trigger_type: "assessment_complete" });
  const [steps, setSteps] = useState<Step[]>([
    { order: 1, role: "assessor", action: "complete_assessment", notify: true, deadline_days: 7 },
    { order: 2, role: "educator", action: "validate", notify: true, deadline_days: 7 },
  ]);

  function addStep() {
    setSteps(p => [...p, { order: p.length + 1, role: "educator", action: "validate", notify: true, deadline_days: 7 }]);
  }
  function removeStep(i: number) {
    setSteps(p => p.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, order: idx + 1 })));
  }
  function updateStep(i: number, key: keyof Step, val: string | boolean | number) {
    setSteps(p => p.map((s, idx) => idx === i ? { ...s, [key]: val } : s));
  }

  async function save() {
    if (!form.name) return;
    setSaving(true);
    const res = await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, steps }),
    });
    setSaving(false);
    if (res.ok) { setOpen(false); router.refresh(); }
    else alert("Failed to save workflow.");
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700">
        + Add Workflow
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="font-bold text-gray-900 mb-4">New Workflow Template</h2>
            <div className="flex flex-col gap-3 mb-4">
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Workflow name *" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="Description" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Trigger</label>
                <select value={form.trigger_type} onChange={e => setForm(p => ({ ...p, trigger_type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="assessment_complete">Assessment Complete</option>
                  <option value="cycle_end">Cycle End</option>
                  <option value="score_below_threshold">Score Below Threshold</option>
                  <option value="expiry_approaching">Expiry Approaching</option>
                  <option value="validation_required">Validation Required</option>
                  <option value="policy_review_due">Policy Review Due</option>
                </select>
              </div>
            </div>

            <p className="text-xs font-semibold text-gray-500 mb-2">Steps</p>
            <div className="flex flex-col gap-2 mb-3">
              {steps.map((step, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-400">Step {step.order}</span>
                    {steps.length > 1 && (
                      <button onClick={() => removeStep(i)} className="text-[10px] text-red-400 hover:text-red-600">Remove</button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-400 mb-0.5 block">Role</label>
                      <select value={step.role} onChange={e => updateStep(i, "role", e.target.value)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none">
                        <option value="assessor">Assessor</option>
                        <option value="educator">Educator</option>
                        <option value="hospital_admin">Hospital Admin</option>
                        <option value="nurse">Nurse</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 mb-0.5 block">Action</label>
                      <select value={step.action} onChange={e => updateStep(i, "action", e.target.value)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none">
                        <option value="complete_assessment">Complete Assessment</option>
                        <option value="validate">Validate</option>
                        <option value="approve">Approve</option>
                        <option value="review">Review</option>
                        <option value="acknowledge">Acknowledge</option>
                        <option value="sign_off">Clinical Sign-off</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="text-[10px] text-gray-400 mb-0.5 block">Deadline (days)</label>
                      <input type="number" min={1} value={step.deadline_days}
                        onChange={e => updateStep(i, "deadline_days", parseInt(e.target.value))}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer pt-4">
                      <input type="checkbox" checked={step.notify} onChange={e => updateStep(i, "notify", e.target.checked)} className="w-3 h-3 accent-teal-500" />
                      Notify
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={addStep} className="text-xs text-teal-600 font-semibold hover:underline mb-4">+ Add Step</button>

            <div className="flex gap-2">
              <button onClick={() => setOpen(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">Cancel</button>
              <button onClick={save} disabled={saving || !form.name} className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {saving ? "Saving…" : "Save Workflow"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
