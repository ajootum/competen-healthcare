"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Nurse = { id: string; full_name: string; specialization: string | null };
type Framework = { id: string; name: string; library: string };

type Props = { nurses: Nurse[]; frameworks: Framework[] };

const CYCLE_TYPES = [
  { value: "orientation", label: "Orientation",  desc: "New staff — first 90 days" },
  { value: "probation",   label: "Probation",    desc: "Probationary period assessment" },
  { value: "annual",      label: "Annual",       desc: "Yearly competency review" },
  { value: "remediation", label: "Remediation",  desc: "Performance improvement plan" },
  { value: "specialty",   label: "Specialty",    desc: "New specialty or department" },
];

export default function CycleCreator({ nurses, frameworks }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nurseId, setNurseId] = useState("");
  const [cycleType, setCycleType] = useState("orientation");
  const [selectedFrameworks, setSelectedFrameworks] = useState<string[]>([]);
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coreFrameworks = frameworks.filter(f => f.library === "core");
  const specialtyFrameworks = frameworks.filter(f => f.library === "specialty");
  const roleFrameworks = frameworks.filter(f => f.library === "role");

  function toggleFramework(id: string) {
    setSelectedFrameworks(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  }

  async function handleCreate() {
    if (!nurseId || !cycleType || selectedFrameworks.length === 0) {
      setError("Select a nurse, cycle type, and at least one framework.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/cycles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nurse_id: nurseId,
          cycle_type: cycleType,
          framework_ids: selectedFrameworks,
          end_date: endDate || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Failed to create cycle");
      } else {
        setOpen(false);
        setNurseId("");
        setCycleType("orientation");
        setSelectedFrameworks([]);
        setEndDate("");
        router.refresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-teal-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors">
        + Create Cycle
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Create Competency Cycle</h2>
              <p className="text-sm text-gray-400 mt-0.5">Assign a nurse to a competency assessment cycle with specific frameworks.</p>
            </div>

            <div className="p-6 space-y-5">
              {/* Nurse selector */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Nurse</label>
                <select
                  value={nurseId}
                  onChange={e => setNurseId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-teal-400">
                  <option value="">Select nurse…</option>
                  {nurses.map(n => (
                    <option key={n.id} value={n.id}>{n.full_name}{n.specialization ? ` (${n.specialization})` : ""}</option>
                  ))}
                </select>
              </div>

              {/* Cycle type */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Cycle Type</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {CYCLE_TYPES.map(ct => (
                    <button key={ct.value}
                      onClick={() => setCycleType(ct.value)}
                      className={`text-left p-3 rounded-lg border text-sm transition-colors ${
                        cycleType === ct.value
                          ? "border-teal-400 bg-teal-50 text-teal-700"
                          : "border-gray-200 hover:border-gray-300 text-gray-700"
                      }`}>
                      <p className="font-semibold">{ct.label}</p>
                      <p className="text-[11px] opacity-70 mt-0.5">{ct.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* End date */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">End Date (optional)</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-teal-400" />
              </div>

              {/* Framework selection */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Frameworks to Include <span className="text-teal-600">({selectedFrameworks.length} selected)</span>
                </label>

                {[
                  { label: "Core Framework", items: coreFrameworks, color: "border-teal-200 bg-teal-50 text-teal-700" },
                  { label: "Specialty Frameworks", items: specialtyFrameworks, color: "border-indigo-200 bg-indigo-50 text-indigo-700" },
                  { label: "Role Frameworks", items: roleFrameworks, color: "border-violet-200 bg-violet-50 text-violet-700" },
                ].map(group => group.items.length > 0 && (
                  <div key={group.label} className="mb-3">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">{group.label}</p>
                    <div className="flex flex-wrap gap-2">
                      {group.items.map(f => (
                        <button key={f.id}
                          onClick={() => toggleFramework(f.id)}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                            selectedFrameworks.includes(f.id)
                              ? group.color
                              : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
                          }`}>
                          {f.name}
                          {selectedFrameworks.includes(f.id) && " ✓"}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            </div>

            <div className="p-6 border-t border-gray-100 flex items-center justify-between gap-3">
              <button onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={saving}
                className="bg-teal-600 text-white text-sm font-semibold px-6 py-2.5 rounded-lg hover:bg-teal-700 disabled:opacity-40 transition-colors">
                {saving ? "Creating…" : "Create Cycle"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
