"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Competency validation decision actions (UMW-EA-004 §8). Reuses the audited
// /api/educator/validate route (validate = approve; return = reject/return/request-info).
const BTN = "text-xs font-semibold rounded-lg py-2 disabled:opacity-50";
export default function ValidationActions({ scoreId, validated }: { scoreId: string; validated: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(action: "validate" | "return", label: string, needNote: boolean) {
    let notes: string | null = null;
    if (needNote) { notes = window.prompt(`Note for “${label}” (recorded to audit):`, ""); if (notes === null) return; if (label !== "Approve with Conditions" && !notes.trim()) { setErr("A note is required"); return; } }
    setBusy(label); setErr(null);
    const res = await fetch("/api/educator/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ competency_score_id: scoreId, action, notes }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); setBusy(null); return; }
    setBusy(null); router.refresh();
  }
  if (validated) return <p className="text-xs text-gray-400">This competency has been validated.</p>;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => act("validate", "Approve", false)} disabled={!!busy} className={`${BTN} bg-green-600 text-white`}>Approve</button>
        <button onClick={() => act("validate", "Approve with Conditions", true)} disabled={!!busy} className={`${BTN} border border-green-500 text-green-700`}>Conditions</button>
        <button onClick={() => act("return", "Reject", true)} disabled={!!busy} className={`${BTN} bg-rose-600 text-white`}>Reject</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => act("return", "Return for More Evidence", true)} disabled={!!busy} className={`${BTN} border border-gray-200 text-gray-600`}>Return</button>
        <button onClick={() => act("return", "Request Information", true)} disabled={!!busy} className={`${BTN} border border-gray-200 text-gray-600`}>Request Info</button>
        <button disabled className={`${BTN} border border-gray-100 text-gray-300`} title="Assign learning — next phase">Assign Learning</button>
      </div>
      {err && <p className="text-[10px] text-rose-600">{err}</p>}
    </div>
  );
}
