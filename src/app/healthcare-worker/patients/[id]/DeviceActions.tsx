"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Devices & lines capture (migration 158): record a device on my patient and
// record removal — line-days and dwell-review flags compute server-side.

const TYPES = ["central_line", "peripheral_iv", "arterial_line", "urinary_catheter", "ng_tube", "peg_tube", "chest_drain", "wound_drain", "tracheostomy", "ett", "other"];
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
const input = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const btn = "px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50";
const btnGhost = "px-2 py-0.5 rounded-lg border border-gray-300 text-[10px] text-gray-700 hover:bg-gray-50 disabled:opacity-50";

export function AddDevice({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("peripheral_iv");
  const [site, setSite] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return <button className={btnGhost} onClick={() => setOpen(true)}>+ Record device</button>;
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1">
      <select className={input} value={type} onChange={e => setType(e.target.value)}>
        {TYPES.map(t => <option key={t} value={t}>{titleCase(t)}</option>)}
      </select>
      <input className={input} placeholder="Site (e.g. L forearm)" value={site} onChange={e => setSite(e.target.value)} />
      <button className={btn} disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        const r = await fetch("/api/operations/devices", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patient_id: patientId, device_type: type, site }),
        });
        const d = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok) { setErr(d.error ?? "Failed"); return; }
        setOpen(false); setSite("");
        router.refresh();
      }}>Record</button>
      <button className={btnGhost} onClick={() => setOpen(false)}>Cancel</button>
      {err && <span className="text-xs text-amber-700 w-full">{err}</span>}
    </div>
  );
}

export function RemoveDevice({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className={btnGhost} disabled={busy} onClick={async () => {
      setBusy(true);
      await fetch("/api/operations/devices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      setBusy(false);
      router.refresh();
    }}>Removed</button>
  );
}
