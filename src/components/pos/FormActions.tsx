"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Verification actions for a form awaiting verification (POS-106 §8.2). Verify finalises the
// record; Return sends it back for correction with a mandatory reason. Both PATCH the form-engine
// API, which writes the transition event. Manager-gated server-side.
export default function FormActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(action: "verify" | "return") {
    let reason: string | null = null;
    if (action === "return") { reason = window.prompt("Reason for returning this form for correction:"); if (!reason) return; }
    setBusy(true);
    const r = await fetch(`/api/operations/pos-forms?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) });
    setBusy(false);
    if (r.ok) router.refresh();
    else { const d = await r.json().catch(() => ({})); window.alert(d?.error || "Failed"); }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button disabled={busy} onClick={() => act("verify")} className="text-[11px] font-medium text-emerald-700 hover:underline disabled:opacity-50">Verify</button>
      <span className="text-gray-200">·</span>
      <button disabled={busy} onClick={() => act("return")} className="text-[11px] font-medium text-amber-700 hover:underline disabled:opacity-50">Return</button>
    </span>
  );
}
