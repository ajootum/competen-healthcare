"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Btn } from "@/components/assessment/ui";

// A grant made for the learner: Accept (it becomes live) or Decline / End (it ends and is never reopened). Only the learner's own grants are
// reachable: the route checks the learner's id on the row.

export default function GrantActions({ grantId, standing }: { grantId: string; standing: "awaiting_acceptance" | "live" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(action: "accept" | "end") {
    if (busy) return;
    if (action === "end" && !window.confirm(standing === "live" ? "End this assessor's access? It cannot be reopened." : "Decline this assessor? It cannot be reopened.")) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/individual/scholar/assessments/grants/${encodeURIComponent(grantId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "accept" ? { action } : { action, reason: standing === "live" ? "Ended by the learner" : "Declined by the learner" }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) { router.refresh(); return; }
      setError(typeof json.error === "string" ? json.error : "That could not be saved just now.");
    } catch { setError("That could not be saved just now. Check your connection and try again."); }
    setBusy(false);
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className="flex flex-wrap gap-2">
        {standing === "awaiting_acceptance" && <Btn kind="primary" disabled={busy} onClick={() => send("accept")}>Accept</Btn>}
        <Btn kind="secondary" disabled={busy} onClick={() => send("end")}>{standing === "awaiting_acceptance" ? "Decline" : "End access"}</Btn>
      </span>
      {error && <span role="alert" className="text-[12.5px] text-[var(--cmp-text-error)]">{error}</span>}
    </span>
  );
}
