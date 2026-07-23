"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Pre-shift safety huddle (SSW-002 §6.7). Record the team briefing — concerns,
// risks and planned actions — and complete it. Completing satisfies the
// safety_huddle_prepared readiness item. Writes through the audited API.

type Huddle = {
  facilitator_name: string | null; attendance_count: number; completion_status: string;
  patient_safety_concerns: string | null; staffing_concerns: string | null;
  operational_risks: string | null; planned_actions: string | null; completed_at: string | null;
} | null;

const FIELDS: [keyof NonNullable<Huddle>, string][] = [
  ["patient_safety_concerns", "Patient safety concerns"],
  ["staffing_concerns", "Staffing concerns"],
  ["operational_risks", "Operational risks"],
  ["planned_actions", "Planned actions"],
];

export default function SafetyHuddlePanel({ shiftId, provisioned, huddle, editable }: {
  shiftId: string | null; provisioned: boolean; huddle: Huddle; editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({
    patient_safety_concerns: huddle?.patient_safety_concerns ?? "", staffing_concerns: huddle?.staffing_concerns ?? "",
    operational_risks: huddle?.operational_risks ?? "", planned_actions: huddle?.planned_actions ?? "",
    attendance_count: String(huddle?.attendance_count ?? ""),
  });
  const done = huddle?.completion_status === "completed";

  if (!provisioned) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-bold text-gray-900">Safety Huddle</h2>
        <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-4 text-center">
          <p className="text-sm text-gray-500">Safety huddle not provisioned</p>
          <p className="text-[11px] text-gray-400 mt-1">Run migration <span className="font-mono">066-shift-records</span> to enable the pre-shift huddle &amp; decision log.</p>
        </div>
      </div>
    );
  }

  async function save(complete: boolean) {
    if (!shiftId) return;
    setBusy(complete ? "complete" : "save"); setErr(null);
    try {
      const res = await fetch(`/api/operations/safety-huddles`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shift_id: shiftId, ...form, attendance_count: Number(form.attendance_count) || 0, completion_status: complete ? "completed" : "in_progress" }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Save failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(null); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Safety Huddle</h2>
          <p className="text-[11px] text-gray-500">Pre-shift team briefing (SSW-002 §6.7)</p>
        </div>
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${done ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>{done ? "completed" : (huddle?.completion_status ?? "not started")}</span>
      </div>

      {done && !editable ? (
        <div className="space-y-1.5 mt-2">
          {FIELDS.map(([k, label]) => huddle?.[k] ? (
            <div key={k as string}><p className="text-[10px] font-semibold text-gray-400 uppercase">{label}</p><p className="text-xs text-gray-700">{huddle[k] as string}</p></div>
          ) : null)}
          <p className="text-[10px] text-gray-400 pt-1">Facilitated by {huddle?.facilitator_name ?? "—"} · {huddle?.attendance_count ?? 0} attended</p>
        </div>
      ) : (
        <div className="space-y-2 mt-2">
          {FIELDS.map(([k, label]) => (
            <div key={k as string}>
              <label className="text-[10px] font-semibold text-gray-400 uppercase">{label}</label>
              <textarea value={form[k as string]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} rows={2}
                disabled={!editable} placeholder="—"
                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none disabled:bg-gray-50" />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-semibold text-gray-400 uppercase">Attended</label>
            <input type="number" min={0} value={form.attendance_count} onChange={e => setForm(f => ({ ...f, attendance_count: e.target.value }))}
              disabled={!editable} className="w-16 text-xs border border-gray-200 rounded-lg px-2 py-1 disabled:bg-gray-50" />
            {editable && (
              <span className="ml-auto flex gap-2">
                <button onClick={() => save(false)} disabled={!!busy} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">{busy === "save" ? "…" : "Save draft"}</button>
                <button onClick={() => save(true)} disabled={!!busy} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">{busy === "complete" ? "…" : "Complete huddle"}</button>
              </span>
            )}
          </div>
        </div>
      )}
      {err && <p className="text-[11px] text-rose-600 mt-2">{err}</p>}
    </div>
  );
}
