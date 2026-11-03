"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Btn } from "@/components/assessment/ui";

/** Start (or resume) an assessment from a grant made to me. */
export function StartButton({ grantId, label = "Start assessment" }: { grantId: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/hq/checklist-assessments/instances", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grantId }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { setError(b.error ?? "That could not be started."); setBusy(false); return; }
      router.push(`/super-admin/checklist-assessments/${b.instanceId}`);
    } catch {
      setError("There is no connection. Try again."); setBusy(false);
    }
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <Btn kind="primary" onClick={go} disabled={busy}>{busy ? "Starting" : label}</Btn>
      {error ? <p role="alert" className="text-sm text-[var(--cmp-text-error)]">{error}</p> : null}
    </div>
  );
}
