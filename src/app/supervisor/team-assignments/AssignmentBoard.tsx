"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import { useRouter } from "next/navigation";

// Live Assignment Board (SSW-TC-TEAM-001) — ward columns of patient cards with click-to-
// assign. Assign / reassign a patient to a present clinician through the audited,
// competency-validating /api/operations/assignments route; a 422 (no current validated
// competency) prompts for an override reason before retrying. Unassign ends the
// assignment. Cards show operational identifiers + acuity only (op_patients holds no PHI).
type Staff = { id: string; name: string; role: string };
type Patient = { id: string; label: string; bed: string | null; acuity: string; acuityBadge: string; isolation: string; assigned: { assignmentId: string; name: string; staffId: string; validated: boolean } | null };
type Column = { ward: string; patients: Patient[]; assigned: number; total: number };

const ACUITY: Record<string, string> = { High: "text-rose-600", Medium: "text-amber-600", Low: "text-emerald-600" };
const ACUITY_DOT: Record<string, string> = { High: "bg-rose-500", Medium: "bg-amber-500", Low: "bg-emerald-500" };
const cap = (s: string) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "");

export default function AssignmentBoard({ columns, staff, shiftId, showUnassignedOnly }: { columns: Column[]; staff: Staff[]; shiftId: string | null; showUnassignedOnly?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function assign(patientId: string, staffId: string, override?: string) {
    const res = await fetch("/api/operations/assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patient_id: patientId, staff_id: staffId, shift_id: shiftId, override_reason: override }) });
    if (res.status === 422) {
      const reason = window.prompt("This clinician has no current validated competency. Enter an emergency override reason to proceed:", "");
      if (reason === null || !reason.trim()) return false;
      return assign(patientId, staffId, reason.trim());
    }
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? "Failed"); }
    return true;
  }

  async function doAssign(patientId: string) {
    if (!pick) return;
    setBusy(true); setErr(null);
    try { const ok = await assign(patientId, pick); if (ok) { setOpen(null); setPick(""); router.refresh(); } }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  async function unassign(assignmentId: string) {
    setBusy(true); setErr(null);
    try { const res = await fetch(`/api/operations/assignments?id=${assignmentId}`, { method: "PATCH" }); if (!res.ok) throw new Error("Failed"); router.refresh(); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <div>
      {err && <p className="text-[11px] text-rose-600 mb-2">{err}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {columns.map(col => {
          const shown = showUnassignedOnly ? col.patients.filter(p => !p.assigned) : col.patients;
          if (showUnassignedOnly && shown.length === 0) return null;
          return (
            <div key={col.ward} className="rounded-xl border border-gray-200 bg-gray-50/40 p-2.5">
              <div className="flex items-center justify-between mb-2 px-1"><span className="text-xs font-bold text-gray-800 truncate">{col.ward}</span><span className="text-[10px] text-gray-400">{col.assigned}/{col.total}</span></div>
              <div className="space-y-2">
                {shown.map(p => (
                  <div key={p.id} className="rounded-lg border border-gray-200 bg-white p-2.5">
                    <div className="flex items-start justify-between">
                      <div><p className="text-xs font-bold text-gray-900">{p.bed ? `Bed ${p.bed}` : "Unassigned bed"}</p><p className="text-[11px] text-gray-500">{p.label}</p></div>
                      <span className={`flex items-center gap-1 text-[10px] font-semibold ${ACUITY[p.acuityBadge]}`}><span className={`w-1.5 h-1.5 rounded-full ${ACUITY_DOT[p.acuityBadge]}`} />{p.acuityBadge}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 capitalize mt-0.5">Acuity {p.acuity}{p.isolation !== "none" ? ` · Isolation ${p.isolation}` : ""}</p>
                    {p.assigned ? (
                      <div className="mt-1.5 flex items-center justify-between rounded-md bg-emerald-50/60 px-2 py-1.5">
                        <span className="text-[11px] text-gray-700 truncate">👤 {p.assigned.name}{!p.assigned.validated && <span className="text-amber-600" title="Override — no validated competency"> ⚠</span>}</span>
                        <span className="flex items-center gap-1.5"><button onClick={() => { setOpen(open === p.id ? null : p.id); setPick(""); }} className="text-[10px] text-gray-500 hover:text-emerald-700">Reassign</button><button disabled={busy} onClick={() => unassign(p.assigned!.assignmentId)} className="text-[10px] text-rose-400 hover:text-rose-600 disabled:opacity-50" title="Unassign">✕</button></span>
                      </div>
                    ) : (
                      <button onClick={() => { setOpen(open === p.id ? null : p.id); setPick(""); }} className="mt-1.5 w-full text-[11px] font-semibold rounded-md border border-dashed border-emerald-300 text-emerald-700 py-1.5 hover:bg-emerald-50/50">+ Assign clinician</button>
                    )}
                    {open === p.id && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <select value={pick} onChange={e => setPick(e.target.value)} className="flex-1 text-[11px] rounded border border-gray-200 px-1.5 py-1.5"><option value="">Select…</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name} · {cap(s.role)}</option>)}</select>
                        <button disabled={!pick || busy} onClick={() => doAssign(p.id)} className="text-[11px] font-semibold rounded bg-emerald-600 text-white px-2 py-1.5 disabled:opacity-50">{busy ? "…" : "Go"}</button>
                      </div>
                    )}
                  </div>
                ))}
                {shown.length === 0 && <p className="text-[11px] text-gray-400 px-1 py-2 text-center">No patients.</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
