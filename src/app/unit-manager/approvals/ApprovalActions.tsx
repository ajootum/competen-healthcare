"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Approvals decision actions (UMW-EA-001 §9) + Create Request. Every decision
// PATCHes the audited /api/operations/approvals route.

const CATS = ["personnel", "staffing", "clinical", "competency", "education", "equipment", "policy", "finance", "operations", "it", "governance"];

export function NewApprovalButton({ provisioned }: { provisioned: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ title: "", category: "operations", priority: "medium", impact: "medium", reason: "" });

  async function create() {
    if (!f.title.trim()) { setErr("Title required"); return; }
    setBusy(true); setErr(null);
    const res = await fetch("/api/operations/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); setBusy(false); return; }
    setOpen(false); setF({ title: "", category: "operations", priority: "medium", impact: "medium", reason: "" }); setBusy(false); router.refresh();
  }
  const inp = "w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5";
  return (
    <>
      <button onClick={() => setOpen(o => !o)} disabled={!provisioned} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:bg-gray-200 disabled:text-gray-400">+ New Request</button>
      {open && (
        <div className="absolute right-0 mt-2 z-20 w-72 bg-white rounded-xl border border-gray-200 shadow-lg p-3 space-y-2">
          <input placeholder="Request title" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} className={inp} />
          <div className="grid grid-cols-2 gap-2">
            <select value={f.category} onChange={e => setF({ ...f, category: e.target.value })} className={inp}>{CATS.map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select>
            <select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })} className={inp}>{["critical", "high", "medium", "low"].map(p => <option key={p} value={p}>{p}</option>)}</select>
          </div>
          <select value={f.impact} onChange={e => setF({ ...f, impact: e.target.value })} className={inp}>{["high", "medium", "low"].map(p => <option key={p} value={p}>{p} impact</option>)}</select>
          <textarea placeholder="Reason / context" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} className={`${inp} h-16 resize-none`} />
          {err && <p className="text-[10px] text-rose-600">{err}</p>}
          <div className="flex gap-2"><button onClick={create} disabled={busy} className="flex-1 text-xs font-semibold bg-teal-600 text-white rounded-lg py-1.5">Submit</button><button onClick={() => setOpen(false)} className="text-xs text-gray-500 px-3">Cancel</button></div>
        </div>
      )}
    </>
  );
}

const BTN = "text-xs font-semibold rounded-lg py-2 disabled:opacity-50";
export default function ApprovalActions({ selectedId }: { selectedId?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function decide(action: string, needNote: boolean) {
    if (!selectedId) return;
    let note: string | null = null;
    if (needNote) { note = window.prompt(`Note for ${action.replace(/_/g, " ")}:`, ""); if (note === null) return; }
    setBusy(action); setErr(null);
    const res = await fetch("/api/operations/approvals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selectedId, action, note }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); setBusy(null); return; }
    setBusy(null); router.refresh();
  }
  if (!selectedId) return null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => decide("approve", false)} disabled={!!busy} className={`${BTN} bg-green-600 text-white col-span-1`}>Approve</button>
        <button onClick={() => decide("approve_conditions", true)} disabled={!!busy} className={`${BTN} border border-green-500 text-green-700 col-span-1`}>Conditions</button>
        <button onClick={() => decide("reject", true)} disabled={!!busy} className={`${BTN} bg-rose-600 text-white col-span-1`}>Reject</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => decide("return", true)} disabled={!!busy} className={`${BTN} border border-gray-200 text-gray-600`}>Return</button>
        <button onClick={() => decide("request_info", true)} disabled={!!busy} className={`${BTN} border border-gray-200 text-gray-600`}>Request Info</button>
        <button onClick={() => decide("delegate", true)} disabled={!!busy} className={`${BTN} border border-gray-200 text-gray-600`}>Delegate</button>
      </div>
      {err && <p className="text-[10px] text-rose-600">{err}</p>}
    </div>
  );
}
