"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Bed status controls (SSW-PO-001 §6) — reserve / block / release / request
// cleaning for a bed via the existing /api/operations/beds PATCH. Occupied beds
// are managed through admission/discharge, so they're excluded here.
/* eslint-disable @typescript-eslint/no-explicit-any */
const input = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const tc = (s: string) => (s ?? "").replace(/_/g, " ").split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

const ACTIONS: { label: string; status: string; cls: string }[] = [
  { label: "Reserve", status: "reserved", cls: "border-violet-200 text-violet-700 hover:bg-violet-50" },
  { label: "Block (maintenance)", status: "out_of_service", cls: "border-gray-300 text-gray-600 hover:bg-gray-50" },
  { label: "Request cleaning", status: "cleaning", cls: "border-orange-200 text-orange-700 hover:bg-orange-50" },
  { label: "Release / return to service", status: "available", cls: "border-teal-200 text-teal-700 hover:bg-teal-50" },
];

export default function BedControls({ beds }: { beds: any[] }) {
  const router = useRouter();
  const [bed, setBed] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 4000); };
  const selectable = beds.filter((b: any) => b.status !== "occupied");
  const current = beds.find((b: any) => b.id === bed);

  async function setStatus(status: string, label: string) {
    if (!bed) { toast("err", "Pick a bed first"); return; }
    setBusy(true);
    const r = await fetch(`/api/operations/beds?id=${bed}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    setBusy(false);
    if (r.ok) { toast("ok", `Bed ${label.toLowerCase()}`); router.refresh(); } else { const d = await r.json().catch(() => ({})); toast("err", d?.error || "Failed"); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900">Bed status controls</h3>
        <select className={`${input} w-56`} value={bed} onChange={e => setBed(e.target.value)}>
          <option value="">Select a bed…</option>
          {selectable.map((b: any) => <option key={b.id} value={b.id}>{b.label} · {tc(b.status)}</option>)}
        </select>
      </div>
      {msg && <div className={`mt-2 text-sm rounded-lg px-3 py-1.5 ${msg.kind === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.text}</div>}
      <div className="mt-3 flex flex-wrap gap-2">
        {ACTIONS.map(a => (
          <button key={a.label} disabled={busy || !bed || current?.status === a.status} onClick={() => setStatus(a.status, a.label)}
            className={`text-sm font-medium rounded-lg border px-3 py-1.5 transition-colors disabled:opacity-40 ${a.cls}`}>{a.label}</button>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 mt-3">Occupied beds are managed through admission &amp; discharge and aren&apos;t listed here.</p>
    </div>
  );
}
