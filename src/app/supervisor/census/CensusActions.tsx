"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Supervisor census actions (HWW-WARD-002): offer a patient to a nurse (the
// acceptance flow — it lands in their Assignment Inbox, responsibility moves
// only when they accept) and route a pending transfer to a receiving nurse.
// The assign path surfaces the competency-override prompt (422) when the
// nurse has no current validated competency.

const btn = "px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-medium hover:bg-teal-700 disabled:opacity-50";
const input = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/40";

export function AssignPatient({ patientId, nurses }: { patientId: string; nurses: { id: string; name: string }[] }) {
  const router = useRouter();
  const [staffId, setStaffId] = useState("");
  const [override, setOverride] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function assign() {
    if (!staffId) { setErr("Pick a nurse"); return; }
    setBusy(true); setErr(null);
    const r = await fetch("/api/operations/assignments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patient_id: patientId, staff_id: staffId, override_reason: override != null ? reason : undefined }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.status === 422 && d.requires_override) { setOverride(d.error ?? "Override required"); return; }
    if (!r.ok) { setErr(d.error ?? "Failed"); return; }
    setOverride(null); setReason(""); setStaffId("");
    router.refresh();
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      {err && <p className="text-xs text-[var(--cmp-text-warning)]">{err}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <select className={input} value={staffId} onChange={e => setStaffId(e.target.value)}>
          <option value="">Assign to nurse…</option>
          {nurses.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <button className={btn} disabled={busy || !staffId} onClick={assign}>Offer assignment</button>
      </div>
      {override != null && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-[var(--cmp-text-critical)] w-full">{override}</span>
          <input className={`${input} flex-1 min-w-[220px]`} placeholder="Override reason (emergency staffing judgement)" value={reason} onChange={e => setReason(e.target.value)} />
          <button className={btn} disabled={busy || !reason.trim()} onClick={assign}>Offer with override</button>
        </div>
      )}
    </div>
  );
}

export function RouteTransfer({ transferId, nurses }: { transferId: string; nurses: { id: string; name: string }[] }) {
  const router = useRouter();
  const [staffId, setStaffId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {err && <span className="text-xs text-[var(--cmp-text-warning)] w-full">{err}</span>}
      <select className={input} value={staffId} onChange={e => setStaffId(e.target.value)}>
        <option value="">Route to receiving nurse…</option>
        {nurses.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
      </select>
      <button className={btn} disabled={busy || !staffId} onClick={async () => {
        setBusy(true); setErr(null);
        const r = await fetch("/api/operations/census", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "route_transfer", transfer_id: transferId, receiving_staff_id: staffId }),
        });
        const d = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok) { setErr(d.error ?? "Failed"); return; }
        router.refresh();
      }}>Route</button>
    </div>
  );
}
