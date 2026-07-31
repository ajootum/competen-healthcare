"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Per-concern lifecycle buttons for the RAISER/assigned nurse (HWW-ADD-001):
// start working it, resolve with closure notes, or carry it into the next
// shift's handover. Ward-round actions get a complete button for their owner.
/* eslint-disable @typescript-eslint/no-explicit-any */

const btnGhost = "px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";

async function patch(body: any) {
  const r = await fetch("/api/operations/concerns", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

export function ConcernRowActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const active = ["open", "in_progress", "carried_forward"].includes(status);
  if (!active) return null;

  async function act(body: any) {
    setBusy(true); setErr(null);
    const r = await patch(body);
    setBusy(false);
    if (!r.ok) { setErr(r.data.error ?? "Failed"); return; }
    setResolving(false); setNotes("");
    router.refresh();
  }

  return (
    <div className="mt-2 space-y-2">
      {err && <p className="text-xs text-[var(--cmp-text-warning)]">{err}</p>}
      {resolving ? (
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${input} flex-1 min-w-[220px]`} placeholder="Resolution notes (operational closure)" value={notes} onChange={e => setNotes(e.target.value)} />
          <button className={btnGhost} disabled={busy} onClick={() => act({ action: "status", id, status: "resolved", resolution_notes: notes })}>Confirm resolve</button>
          <button className={btnGhost} disabled={busy} onClick={() => setResolving(false)}>Cancel</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {status === "open" && <button className={btnGhost} disabled={busy} onClick={() => act({ action: "status", id, status: "in_progress" })}>Start</button>}
          <button className={btnGhost} disabled={busy} onClick={() => setResolving(true)}>Resolve</button>
          {status !== "carried_forward" && <button className={btnGhost} disabled={busy} title="Keep this concern active into the next shift's handover" onClick={() => act({ action: "status", id, status: "carried_forward" })}>Carry forward</button>}
        </div>
      )}
    </div>
  );
}

export function CompleteAction({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className={btnGhost} disabled={busy} onClick={async () => {
      setBusy(true);
      await patch({ action: "action_status", id, status: "completed" });
      setBusy(false);
      router.refresh();
    }}>Done</button>
  );
}
