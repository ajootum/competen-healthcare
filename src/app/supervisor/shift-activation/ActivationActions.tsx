"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Shift Planning & Activation actions (SSW-SPA-001). Confirm a staff member's attendance
// (op_shift_staff status) and activate the shift (op_shifts planned → active) once mandatory
// readiness is met. Both through audited APIs; activation writes the shift live.
export function ConfirmAttendance({ staffId, status }: { staffId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (status === "on_duty" || status === "confirmed") return <span className="text-[10px] text-emerald-600">✓ Confirmed</span>;
  return <span className="flex gap-1">
    <button disabled={busy} onClick={async () => { setBusy(true); await fetch(`/api/operations/shift-staff?id=${staffId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "on_duty" }) }); setBusy(false); router.refresh(); }} className="text-[10px] rounded border border-emerald-200 px-1.5 py-0.5 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">Confirm</button>
    <button disabled={busy} onClick={async () => { setBusy(true); await fetch(`/api/operations/shift-staff?id=${staffId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "absent" }) }); setBusy(false); router.refresh(); }} className="text-[10px] rounded border border-rose-200 px-1.5 py-0.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50">Absent</button>
  </span>;
}

export function ActivateButton({ shiftId, ready, phase }: { shiftId: string | null; ready: boolean; phase: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (phase === "activated") return <span className="text-xs font-semibold rounded-lg py-2.5 px-4 bg-emerald-50 text-emerald-700">✓ Shift activated — operational</span>;
  if (!shiftId) return <span className="text-xs text-gray-400">No planned shift to activate.</span>;

  async function activate() {
    setBusy(true); setErr(null);
    const res = await fetch(`/api/operations/shifts?id=${shiftId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "active" }) });
    setBusy(false);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Activation failed"); return; }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button onClick={activate} disabled={busy || !ready} className="text-xs font-semibold rounded-lg py-2.5 px-5 bg-emerald-600 text-white disabled:opacity-50" title={ready ? "" : "Complete mandatory readiness checks first"}>{busy ? "Activating…" : "🚀 Activate Shift"}</button>
      {!ready && <span className="text-[11px] text-amber-600">Mandatory readiness checks incomplete — activation blocked.</span>}
      {err && <span className="text-[11px] text-rose-600">{err}</span>}
    </div>
  );
}
