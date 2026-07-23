"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Escalation decision actions (UMW-EA-002 §8). PATCHes the audited escalations API.
const BTN = "text-xs font-semibold rounded-lg py-2 disabled:opacity-50";
export default function EscalationActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(action: string, needNote: boolean) {
    let resolution: string | null = null;
    if (needNote) { resolution = window.prompt("Resolution outcome (required for audit):", ""); if (resolution === null) return; if (!resolution.trim()) { setErr("Documented outcome required"); return; } }
    setBusy(action); setErr(null);
    const res = await fetch(`/api/operations/escalations?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, resolution }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); setBusy(null); return; }
    setBusy(null); router.refresh();
  }
  if (["resolved", "cancelled"].includes(status)) return <p className="text-xs text-gray-400">This escalation is closed.</p>;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => act("acknowledge", false)} disabled={!!busy} className={`${BTN} bg-rose-600 text-white`}>Take Action</button>
        <button onClick={() => act("assign", false)} disabled={!!busy} className={`${BTN} border border-gray-200 text-gray-600`}>Assign to me</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => act("escalate", false)} disabled={!!busy} className={`${BTN} border border-amber-300 text-amber-700`}>Escalate Higher</button>
        <button onClick={() => act("resolve", true)} disabled={!!busy} className={`${BTN} bg-green-600 text-white`}>Resolve</button>
      </div>
      {err && <p className="text-[10px] text-rose-600">{err}</p>}
    </div>
  );
}
