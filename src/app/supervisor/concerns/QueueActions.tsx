"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Supervisor review controls per concern (HWW-ADD-001 workflow steps 4-6):
// acknowledge, route via the CCE destinations, convert review decisions into
// ward-round actions (optionally spawned as real op_tasks back to the bedside),
// and resolve. All writes hit /api/operations/concerns and are audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const DESTS = ["doctor", "medical_team", "specialty", "subspecialty", "on_call", "shift_supervisor", "allied_health", "quality"];
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
const btnGhost = "px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const input = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/40";

async function patch(body: any) {
  const r = await fetch("/api/operations/concerns", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

export default function QueueActions({ id, acknowledged, routedTo }: { id: string; acknowledged: boolean; routedTo: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"" | "route" | "action" | "resolve">("");
  const [dest, setDest] = useState(routedTo ?? "medical_team");
  const [text, setText] = useState("");
  const [spawnTask, setSpawnTask] = useState(true);
  const [notes, setNotes] = useState("");

  async function act(body: any) {
    setBusy(true); setErr(null);
    const r = await patch(body);
    setBusy(false);
    if (!r.ok) { setErr(r.data.error ?? "Failed"); return; }
    setMode(""); setText(""); setNotes("");
    router.refresh();
  }

  return (
    <div className="mt-2 space-y-2">
      {err && <p className="text-xs text-[var(--cmp-text-warning)]">{err}</p>}
      {mode === "" && (
        <div className="flex flex-wrap gap-1.5">
          {!acknowledged && <button className={btnGhost} disabled={busy} onClick={() => act({ action: "acknowledge", id })}>Acknowledge</button>}
          <button className={btnGhost} disabled={busy} onClick={() => setMode("route")}>{routedTo ? "Re-route" : "Route"}</button>
          <button className={btnGhost} disabled={busy} onClick={() => setMode("action")}>+ Ward round action</button>
          <button className={btnGhost} disabled={busy} onClick={() => setMode("resolve")}>Resolve</button>
        </div>
      )}
      {mode === "route" && (
        <div className="flex flex-wrap items-center gap-2">
          <select className={input} value={dest} onChange={e => setDest(e.target.value)}>
            {DESTS.map(d => <option key={d} value={d}>{titleCase(d)}</option>)}
          </select>
          <button className={btnGhost} disabled={busy} onClick={() => act({ action: "route", id, routed_to: dest })}>Route</button>
          <button className={btnGhost} onClick={() => setMode("")}>Cancel</button>
        </div>
      )}
      {mode === "action" && (
        <div className="space-y-1.5">
          <input className={`${input} w-full`} placeholder="Agreed action (assigned back to the raising nurse)" value={text} onChange={e => setText(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={spawnTask} onChange={e => setSpawnTask(e.target.checked)} /> Also create as a live task</label>
            <button className={btnGhost} disabled={busy || !text.trim()} onClick={() => act({ action: "add_action", id, text, spawn_task: spawnTask })}>Create action</button>
            <button className={btnGhost} onClick={() => setMode("")}>Cancel</button>
          </div>
        </div>
      )}
      {mode === "resolve" && (
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${input} flex-1 min-w-[200px]`} placeholder="Resolution notes" value={notes} onChange={e => setNotes(e.target.value)} />
          <button className={btnGhost} disabled={busy} onClick={() => act({ action: "status", id, status: "resolved", resolution_notes: notes })}>Confirm</button>
          <button className={btnGhost} onClick={() => setMode("")}>Cancel</button>
        </div>
      )}
    </div>
  );
}
