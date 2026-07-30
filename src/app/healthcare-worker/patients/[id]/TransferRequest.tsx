"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Initiate a transfer for my patient (HWW-WARD-002 transfer engine). The
// destination and reason are mandatory; ownership only changes when the
// receiving nurse accepts in their Assignment Inbox.

const TYPES = ["internal", "icu", "hdu", "theatre", "recovery", "other_ward", "other_hospital", "diagnostic", "other"];
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const btn = "px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50";
const btnGhost = "px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50";

export default function TransferRequest({ patientId, coStaff }: { patientId: string; coStaff: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("internal");
  const [toRoom, setToRoom] = useState("");
  const [destination, setDestination] = useState("");
  const [receiving, setReceiving] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/operations/census", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "initiate_transfer", patient_id: patientId, transfer_type: type,
        to_room: toRoom || undefined, destination: destination || undefined,
        receiving_staff_id: receiving || undefined, reason,
      }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "Failed"); return; }
    setOpen(false); setReason(""); setToRoom(""); setDestination("");
    setMsg(receiving ? "Transfer initiated — the receiving nurse must accept before ownership changes." : "Transfer initiated — your supervisor will route it to a receiving nurse.");
    router.refresh();
  }

  if (!open) {
    return (
      <span className="inline-flex items-center gap-2">
        <button className={btnGhost} onClick={() => setOpen(true)}>🔁 Request transfer</button>
        {msg && <span className="text-[10px] text-emerald-700">{msg}</span>}
      </span>
    );
  }

  return (
    <div className="mt-2 w-full border border-emerald-200 bg-emerald-50/30 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-800">Request transfer</span>
        <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>Close</button>
      </div>
      {msg && <p className="text-xs text-amber-700">{msg}</p>}
      <div className="grid sm:grid-cols-3 gap-2">
        <label className="text-xs text-gray-600">Type
          <select className={input} value={type} onChange={e => setType(e.target.value)}>
            {TYPES.map(t => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
        </label>
        {type === "internal" ? (
          <label className="text-xs text-gray-600">Destination room / bed
            <input className={input} placeholder="e.g. Room 4, Bed 2" value={toRoom} onChange={e => setToRoom(e.target.value)} />
          </label>
        ) : (
          <label className="text-xs text-gray-600">Destination
            <input className={input} placeholder="e.g. ICU, St. Mary's Hospital" value={destination} onChange={e => setDestination(e.target.value)} />
          </label>
        )}
        <label className="text-xs text-gray-600">Receiving nurse (optional)
          <select className={input} value={receiving} onChange={e => setReceiving(e.target.value)}>
            <option value="">Supervisor will route</option>
            {coStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      <input className={input} placeholder="Reason (required)" value={reason} onChange={e => setReason(e.target.value)} />
      <button className={btn} disabled={busy || !reason.trim()} onClick={submit}>{busy ? "Submitting…" : "Initiate transfer"}</button>
      <p className="text-[10px] text-gray-400">You remain responsible until the receiving nurse accepts. Every step is audited.</p>
    </div>
  );
}
