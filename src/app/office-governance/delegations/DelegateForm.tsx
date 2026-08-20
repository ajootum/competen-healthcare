"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// OGS-003 delegate-authority form — records a real delegation via /api/office-governance/delegations,
// then router.refresh()es so the delegation centre re-reads adm_delegations. Admin-gated server-side.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Person = { id: string; full_name: string | null; role: string | null };

export default function DelegateForm({ people, scopeHid, isSuper }: { people: Person[]; scopeHid: string | null; isSuper: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [position, setPosition] = useState("");
  const [delegateId, setDelegateId] = useState("");
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [validTo, setValidTo] = useState("");
  const inp = "border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px]";

  async function submit() {
    if (!position.trim() || !delegateId) return;
    setBusy(true); setErr(null);
    try {
      const body: any = { position, delegate_id: delegateId, valid_from: validFrom, valid_to: validTo || null };
      if (isSuper) body.hospital_id = scopeHid;
      const res = await fetch("/api/office-governance/delegations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Error ${res.status}`); return; }
      setPosition(""); setDelegateId(""); setValidTo(""); setOpen(false); router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-medium text-gray-700">Delegate authority</p>
        <button onClick={() => setOpen(v => !v)} className="text-[12px] bg-teal-700 text-white rounded-lg px-3 py-1.5 hover:bg-teal-700">{open ? "Close" : "＋ New delegation"}</button>
      </div>
      {err && <div className="mt-2 bg-[var(--cmp-surface-error)] border border-[var(--cmp-color-error)] text-[var(--cmp-text-error)] rounded-lg px-3 py-2 text-[12px]">{err}</div>}
      {open && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
          <div className="md:col-span-2"><label className="text-[11px] text-gray-500 mb-0.5 block">Position / authority</label><input className={`${inp} w-full`} value={position} onChange={e => setPosition(e.target.value)} placeholder="e.g. Acting Chair — Quality Office" /></div>
          <div><label className="text-[11px] text-gray-500 mb-0.5 block">Delegate to</label><select className={`${inp} w-full`} value={delegateId} onChange={e => setDelegateId(e.target.value)}><option value="">— person —</option>{people.map(p => <option key={p.id} value={p.id}>{p.full_name ?? "Unnamed"}</option>)}</select></div>
          <div><label className="text-[11px] text-gray-500 mb-0.5 block">Valid from</label><input type="date" className={`${inp} w-full`} value={validFrom} onChange={e => setValidFrom(e.target.value)} /></div>
          <div className="flex gap-2 items-end">
            <div className="flex-1"><label className="text-[11px] text-gray-500 mb-0.5 block">Valid to</label><input type="date" className={`${inp} w-full`} value={validTo} onChange={e => setValidTo(e.target.value)} /></div>
            <button disabled={busy || !position.trim() || !delegateId} onClick={submit} className="text-[12px] bg-gray-800 text-white rounded-lg px-3 py-1.5 disabled:opacity-40 whitespace-nowrap">Delegate</button>
          </div>
        </div>
      )}
      {open && <p className="text-[10px] text-gray-400 mt-2">Open-ended (no valid-to) records as a permanent delegation; a future start date schedules it. Delegating authority does not grant technical admin.</p>}
    </div>
  );
}
