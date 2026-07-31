"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Escalation response actions (SSW-CCR-003 workflow steps 3-5: triage ->
// respond -> resolve) over the existing PATCH /api/operations/escalations,
// which supports acknowledge / assign / escalate / resolve and audits each.

const btn = "px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 disabled:opacity-50";
const btnGhost = "px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const input = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/40";

async function patch(id: string, body: Record<string, unknown>) {
  const r = await fetch(`/api/operations/escalations?id=${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

export default function EscalationActions({ id, status, responders }: {
  id: string; status: string; responders: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"" | "assign" | "resolve">("");
  const [assignee, setAssignee] = useState("");
  const [resolution, setResolution] = useState("");

  async function act(body: Record<string, unknown>) {
    setBusy(true); setErr(null);
    const r = await patch(id, body);
    setBusy(false);
    if (!r.ok) { setErr(r.data.error ?? "Failed"); return; }
    setMode(""); setResolution(""); setAssignee("");
    router.refresh();
  }

  return (
    <div className="mt-1.5">
      {err && <p className="text-xs text-[var(--cmp-text-warning)] mb-1">{err}</p>}
      {mode === "" && (
        <div className="flex flex-wrap gap-1.5">
          {status === "open" && <button className={btn} disabled={busy} onClick={() => act({ action: "acknowledge" })}>Acknowledge</button>}
          <button className={btnGhost} disabled={busy} onClick={() => setMode("assign")}>Assign responder</button>
          <button className={btnGhost} disabled={busy} title="Raise one level and reset the response deadline" onClick={() => act({ action: "escalate" })}>Escalate ↑</button>
          <button className={btnGhost} disabled={busy} onClick={() => setMode("resolve")}>Resolve</button>
        </div>
      )}
      {mode === "assign" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <select className={input} value={assignee} onChange={e => setAssignee(e.target.value)}>
            <option value="">Responder…</option>
            {responders.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button className={btn} disabled={busy || !assignee} onClick={() => act({ action: "assign", assign_to: assignee })}>Assign</button>
          <button className={btnGhost} onClick={() => setMode("")}>Cancel</button>
        </div>
      )}
      {mode === "resolve" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input className={`${input} flex-1 min-w-[220px]`} placeholder="Resolution / outcome" value={resolution} onChange={e => setResolution(e.target.value)} />
          <button className={btn} disabled={busy} onClick={() => act({ action: "resolve", resolution })}>Confirm resolve</button>
          <button className={btnGhost} onClick={() => setMode("")}>Cancel</button>
        </div>
      )}
    </div>
  );
}
