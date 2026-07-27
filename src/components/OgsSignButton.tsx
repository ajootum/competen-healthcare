"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// OGS e-sign button — signs a governance record (decision / charter / minutes) AS the current user via
// /api/office-governance/sign, then refreshes. Idempotent server-side. Shows the current signatures inline.
type Sig = { signerName: string | null; signerRole: string | null };

export function OgsSignButton({ entityType, entityId, signatures }: { entityType: "decision" | "charter" | "minutes"; entityId: string; signatures: Sig[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function sign() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/office-governance/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_type: entityType, entity_id: entityId }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Error ${res.status}`); return; }
      router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(false); }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {signatures.length > 0 && <span className="text-[10px] text-gray-500" title={signatures.map(s => `${s.signerName ?? "—"}${s.signerRole ? ` (${s.signerRole})` : ""}`).join(", ")}>✍ {signatures.length} signed</span>}
      <button disabled={busy} onClick={sign} className="text-[10px] text-teal-600 hover:underline disabled:opacity-40">{busy ? "…" : "Sign"}</button>
      {err && <span className="text-[10px] text-rose-500">{err}</span>}
    </span>
  );
}
