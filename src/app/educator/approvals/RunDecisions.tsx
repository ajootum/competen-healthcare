"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Final sign-off action: runs the formal decision process for a cycle —
// issues competency decisions, refreshes the learning pathway and notifies
// the learner. The passport updates from the decisions automatically.
export default function RunDecisions({ cycleId, disabled }: { cycleId: string; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!confirm("Run the decision process for this cycle? Decisions are issued, the passport updates and the learner is notified.")) return;
    setBusy(true); setError(null);
    const res = await fetch(`/api/cycles/${cycleId}/decisions`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setResult(`${d.created ?? 0} decision${d.created === 1 ? "" : "s"} issued`);
      router.refresh();
    } else setError(d.error ?? "Decision run failed");
    setBusy(false);
  }

  return (
    <span className="flex items-center gap-2">
      {result && <span className="text-[10px] font-semibold text-green-600">✓ {result}</span>}
      {error && <span className="text-[10px] text-red-600">{error}</span>}
      <button onClick={run} disabled={busy || disabled}
        title={disabled ? "Validate the scored competencies first" : "Issue formal decisions for this cycle"}
        className="text-[11px] font-bold text-white bg-purple-600 rounded-lg px-3 py-1.5 hover:bg-purple-700 disabled:opacity-40 transition-colors">
        {busy ? "Running…" : "🛂 Approve & issue decisions"}
      </button>
    </span>
  );
}
