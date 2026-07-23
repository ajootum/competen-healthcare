"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// CAPA lifecycle actions (UMW-EA-003 §7). Reuses the audited /api/operations/quality-actions
// PATCH (status advance) + POST (create). Start / Take Action / Mark Complete / Reopen are
// live; Open RCA, Escalate and Attach Evidence are next-phase honest states.
const BTN = "text-xs font-semibold rounded-lg py-2 px-3 disabled:opacity-50";

export function CapaActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function setStatus(next: string, label: string) {
    setBusy(label); setErr(null);
    const res = await fetch(`/api/operations/quality-actions?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); setBusy(null); return; }
    setBusy(null); router.refresh();
  }

  const primary = status === "completed"
    ? <button onClick={() => setStatus("in_progress", "Reopen")} disabled={!!busy} className={`${BTN} bg-gray-700 text-white`}>Reopen</button>
    : status === "in_progress" || status === "overdue"
      ? <button onClick={() => setStatus("completed", "Complete")} disabled={!!busy} className={`${BTN} bg-green-600 text-white`}>Mark Complete</button>
      : <button onClick={() => setStatus("in_progress", "Start")} disabled={!!busy} className={`${BTN} bg-violet-600 text-white`}>Take Action</button>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {primary}
        {status !== "completed" && status !== "overdue" && <button onClick={() => setStatus("overdue", "Flag")} disabled={!!busy} className={`${BTN} border border-amber-300 text-amber-700`}>Flag Overdue</button>}
        <button disabled className={`${BTN} border border-gray-100 text-gray-300`} title="Root Cause Analysis workspace — next phase">Open RCA</button>
        <button disabled className={`${BTN} border border-gray-100 text-gray-300`} title="Escalate — next phase">Escalate</button>
        <button disabled className={`${BTN} border border-gray-100 text-gray-300`} title="Evidence store — next phase">Attach Evidence</button>
      </div>
      {err && <p className="text-[10px] text-rose-600">{err}</p>}
    </div>
  );
}

const TYPES: [string, string][] = [["capa", "CAPA"], ["audit_action", "Audit Action"], ["pdsa", "PDSA Cycle"], ["improvement_project", "Improvement Project"], ["rca", "Root Cause Analysis"], ["policy_review", "Policy Review"]];

export function NewCapaButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ title: "", action_type: "capa", priority: "medium", due_hours: "168", description: "" });

  async function submit() {
    if (!f.title.trim()) { setErr("Title is required"); return; }
    setBusy(true); setErr(null);
    const res = await fetch("/api/operations/quality-actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, due_hours: Number(f.due_hours) || null }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); setBusy(false); return; }
    setBusy(false); setOpen(false); setF({ title: "", action_type: "capa", priority: "medium", due_hours: "168", description: "" }); router.refresh();
  }

  if (!open) return <button onClick={() => setOpen(true)} className="text-xs font-semibold rounded-lg py-2 px-3 bg-violet-600 text-white">+ Create CAPA</button>;
  return (
    <div className="border border-violet-200 rounded-xl p-3 bg-violet-50/40 space-y-2">
      <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Title / issue" className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2" />
      <div className="grid grid-cols-3 gap-2">
        <select value={f.action_type} onChange={e => setF({ ...f, action_type: e.target.value })} className="text-xs rounded-lg border border-gray-200 px-2 py-2">{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })} className="text-xs rounded-lg border border-gray-200 px-2 py-2"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
        <select value={f.due_hours} onChange={e => setF({ ...f, due_hours: e.target.value })} className="text-xs rounded-lg border border-gray-200 px-2 py-2"><option value="24">Due 1 day</option><option value="72">Due 3 days</option><option value="168">Due 1 week</option><option value="336">Due 2 weeks</option></select>
      </div>
      <textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="Description (optional)" rows={2} className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2" />
      {err && <p className="text-[10px] text-rose-600">{err}</p>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="text-xs font-semibold rounded-lg py-2 px-3 bg-violet-600 text-white disabled:opacity-50">{busy ? "Creating…" : "Create"}</button>
        <button onClick={() => { setOpen(false); setErr(null); }} className="text-xs font-semibold rounded-lg py-2 px-3 border border-gray-200 text-gray-600">Cancel</button>
      </div>
    </div>
  );
}
