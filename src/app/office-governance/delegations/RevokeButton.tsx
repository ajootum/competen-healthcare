"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// OGS-003 — revoke a delegation. Only offered for active/scheduled delegations; PATCHes the revoke API
// (admin-gated, tenant-scoped, audited) then refreshes.
export default function RevokeButton({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!["active", "scheduled"].includes(status)) return null;

  async function revoke() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/office-governance/delegations?id=${id}`, { method: "PATCH" });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Error ${res.status}`); return; }
      router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(false); }
  }
  return <button disabled={busy} onClick={revoke} className="text-[10px] text-rose-500 hover:text-[var(--cmp-text-error)] disabled:opacity-40 ml-2" title={err ?? "Revoke this delegation"}>{busy ? "…" : "revoke"}</button>;
}
