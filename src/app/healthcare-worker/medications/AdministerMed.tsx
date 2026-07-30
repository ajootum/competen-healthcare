"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FIVE_RIGHTS } from "@/lib/hww/medications";

// Administration workflow (HWW-MED-001 S4/S6): five-rights verification,
// witness selection for configured double-checks, then administer / delay /
// omit (reason required for the latter two). The engine enforces the witness
// rule and raises the delay escalation server-side.

const btn = "px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50";
const btnGhost = "px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const input = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40";

export default function AdministerMed({ scheduleId, drug, requiresDoubleCheck, coStaff }: {
  scheduleId: string; drug: string; requiresDoubleCheck: boolean;
  coStaff: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [witness, setWitness] = useState("");
  const [mode, setMode] = useState<"" | "delayed" | "omitted">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const allChecked = FIVE_RIGHTS.every(r => checks[r.key]);

  async function submit(outcome: "administered" | "delayed" | "omitted") {
    setBusy(true); setErr(null);
    const r = await fetch("/api/operations/medications", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "record", schedule_id: scheduleId, outcome, reason, safety_checks: checks, witness_id: witness || null }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error ?? "Failed"); return; }
    setOpen(false); setChecks({}); setWitness(""); setMode(""); setReason("");
    router.refresh();
  }

  if (!open) return <button className={btnGhost} onClick={() => setOpen(true)}>Record</button>;

  return (
    <div className="mt-2 w-full border border-emerald-200 bg-emerald-50/30 rounded-lg p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-800">Safety verification — {drug}</span>
        <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>Close</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {FIVE_RIGHTS.map(r => (
          <label key={r.key} className="flex items-center gap-1.5 text-xs text-gray-700">
            <input type="checkbox" checked={!!checks[r.key]} onChange={e => setChecks({ ...checks, [r.key]: e.target.checked })} />
            {r.label}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={input} value={witness} onChange={e => setWitness(e.target.value)}>
          <option value="">{requiresDoubleCheck ? "Witness (required)" : "Witness (optional)"}</option>
          {coStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {requiresDoubleCheck && <span className="text-[10px] text-orange-600 font-medium">Independent double-check configured</span>}
      </div>
      {mode === "" ? (
        <div className="flex flex-wrap gap-1.5">
          <button className={btn} disabled={busy || !allChecked || (requiresDoubleCheck && !witness)} title={!allChecked ? "Complete all five rights first" : ""} onClick={() => submit("administered")}>✓ Administered</button>
          <button className={btnGhost} disabled={busy} onClick={() => setMode("delayed")}>Delayed…</button>
          <button className={btnGhost} disabled={busy} onClick={() => setMode("omitted")}>Omitted…</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${input} flex-1 min-w-[200px]`} placeholder={`Reason ${mode} (required)`} value={reason} onChange={e => setReason(e.target.value)} />
          <button className={btn} disabled={busy || !reason.trim()} onClick={() => submit(mode)}>Confirm {mode}</button>
          <button className={btnGhost} onClick={() => setMode("")}>Back</button>
        </div>
      )}
      {err && <p className="text-xs text-amber-700">{err}</p>}
      <p className="text-[10px] text-gray-400">Delays over 60 min (high-risk) or 120 min (any) automatically escalate to your coordinator.</p>
    </div>
  );
}
