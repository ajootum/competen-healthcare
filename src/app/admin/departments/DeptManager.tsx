"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const UNIT_TYPES = ["Ward","ICU","HDU","Theatre","OPD","Emergency","Maternity","Paediatric","Pharmacy","Laboratory","Radiology","Physiotherapy","Other"];

export default function DeptManager({ hospitalId }: { hospitalId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"dept"|"unit">("dept");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [deptForm, setDeptForm] = useState({ name: "", specialty: "" });
  const [unitForm, setUnitForm] = useState({ department_id: "", name: "", unit_type: "Ward", bed_count: "" });
  const [departments, setDepartments] = useState<{id:string;name:string}[]>([]);

  async function openModal() {
    setOpen(true);
    const res = await fetch(`/api/admin/departments?hospital_id=${hospitalId}`);
    if (res.ok) setDepartments(await res.json());
  }

  async function saveDept() {
    setSaving(true); setError("");
    const res = await fetch("/api/admin/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...deptForm, hospital_id: hospitalId }),
    });
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); setSaving(false); return; }
    setOpen(false); setDeptForm({ name: "", specialty: "" });
    router.refresh(); setSaving(false);
  }

  async function saveUnit() {
    setSaving(true); setError("");
    const res = await fetch("/api/admin/units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...unitForm, bed_count: unitForm.bed_count ? parseInt(unitForm.bed_count) : null }),
    });
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); setSaving(false); return; }
    setOpen(false); setUnitForm({ department_id: "", name: "", unit_type: "Ward", bed_count: "" });
    router.refresh(); setSaving(false);
  }

  return (
    <>
      <button onClick={openModal}
        className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-colors">
        + Add
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">Add Department or Unit</h2>
              <button onClick={() => { setOpen(false); setError(""); }} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>

            <div className="flex gap-1 px-6 pt-4">
              {(["dept","unit"] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    tab === t ? "bg-teal-100 text-teal-700" : "text-gray-500 hover:bg-gray-100"
                  }`}>
                  {t === "dept" ? "🏢 Department" : "📍 Unit"}
                </button>
              ))}
            </div>

            <div className="p-6 flex flex-col gap-4">
              {tab === "dept" ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Department Name *</label>
                    <input value={deptForm.name} onChange={e => setDeptForm({...deptForm, name: e.target.value})}
                      placeholder="e.g. Intensive Care Unit"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Specialty / Type</label>
                    <input value={deptForm.specialty} onChange={e => setDeptForm({...deptForm, specialty: e.target.value})}
                      placeholder="e.g. Critical Care, Surgical, Medical"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100" />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Department *</label>
                    <select value={unitForm.department_id} onChange={e => setUnitForm({...unitForm, department_id: e.target.value})}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-400">
                      <option value="">Select department…</option>
                      {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Unit Name *</label>
                    <input value={unitForm.name} onChange={e => setUnitForm({...unitForm, name: e.target.value})}
                      placeholder="e.g. ICU Bay A"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Unit Type</label>
                      <select value={unitForm.unit_type} onChange={e => setUnitForm({...unitForm, unit_type: e.target.value})}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-400">
                        {UNIT_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Bed Count</label>
                      <input type="number" min="0" value={unitForm.bed_count} onChange={e => setUnitForm({...unitForm, bed_count: e.target.value})}
                        placeholder="e.g. 12"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100" />
                    </div>
                  </div>
                </>
              )}

              {error && <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}

              <div className="flex gap-3 pt-1">
                <button onClick={() => { setOpen(false); setError(""); }}
                  className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={tab === "dept" ? saveDept : saveUnit} disabled={saving}
                  className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-60">
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
