"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Assignment Inbox actions (HWW-WARD-002/003): accept an assignment (take
// responsibility now), decline with a mandatory reason (returns to the
// supervisor), or accept an incoming transfer (ownership changes on accept).

const btn = "px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50";
const btnGhost = "px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const input = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40";

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/operations/census", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

export function AssignmentActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function act(accept: boolean) {
    setBusy(true); setErr(null);
    const r = await post({ action: "respond_assignment", assignment_id: id, accept, reason });
    setBusy(false);
    if (!r.ok) { setErr(r.data.error ?? "Failed"); return; }
    router.refresh();
  }

  return (
    <div className="mt-1.5">
      {err && <p className="text-xs text-amber-700 mb-1">{err}</p>}
      {declining ? (
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${input} flex-1 min-w-[220px]`} placeholder="Reason (required — returns to your supervisor)" value={reason} onChange={e => setReason(e.target.value)} />
          <button className={btnGhost} disabled={busy || !reason.trim()} onClick={() => act(false)}>Confirm decline</button>
          <button className={btnGhost} onClick={() => setDeclining(false)}>Back</button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button className={btn} disabled={busy} onClick={() => act(true)}>✓ Accept responsibility</button>
          <button className={btnGhost} disabled={busy} onClick={() => setDeclining(true)}>Request reassignment…</button>
        </div>
      )}
    </div>
  );
}

export function TransferAccept({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mt-1.5">
      {err && <p className="text-xs text-amber-700 mb-1">{err}</p>}
      <button className={btn} disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        const r = await post({ action: "accept_transfer", transfer_id: id });
        setBusy(false);
        if (!r.ok) { setErr(r.data.error ?? "Failed"); return; }
        router.refresh();
      }}>✓ Accept transfer &amp; take responsibility</button>
    </div>
  );
}
