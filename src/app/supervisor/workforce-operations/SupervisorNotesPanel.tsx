"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NOTE_TYPES, NOTE_TYPE_LABEL } from "@/lib/operations/workforce-breaks-notes";

// Supervisor Notes (SSW-WFO-001 §5) — the structured shift journal. Add a note
// (staffing decision, operational event, coaching, risk, action item…), filter by
// type, and close action items. Persisted through the audited notes API.
/* eslint-disable @typescript-eslint/no-explicit-any */

const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const TYPE_TONE: Record<string, string> = { staffing_decision: "bg-blue-50 text-blue-700", operational_event: "bg-amber-50 text-amber-700", coaching: "bg-teal-50 text-teal-700", risk: "bg-rose-50 text-rose-700", handover: "bg-violet-50 text-violet-700", action_item: "bg-orange-50 text-orange-700", general: "bg-gray-100 text-gray-600" };

export default function SupervisorNotesPanel({ shiftId, data, editable }: {
  shiftId: string | null; data: any; editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [type, setType] = useState("staffing_decision");
  const [body, setBody] = useState("");
  const [filter, setFilter] = useState("all");

  if (!data || data.provisioned === false) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-2"><span className="w-7 h-7 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center text-sm font-bold">5</span><div><h2 className="text-sm font-bold text-gray-900 leading-tight">Supervisor Notes</h2><p className="text-[10px] text-gray-500">Shift notes, decisions &amp; operational log</p></div></div>
        <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-4 text-center">
          <p className="text-sm text-gray-500">Supervisor notes not provisioned</p>
          <p className="text-[11px] text-gray-400 mt-1">Run migration <span className="font-mono">069-workforce-breaks-notes</span> to persist the shift journal.</p>
        </div>
      </div>
    );
  }
  const notes = (data.notes ?? []).filter((n: any) => filter === "all" || n.note_type === filter);

  async function add() {
    if (!body.trim()) return;
    setBusy("add"); setErr(null);
    try {
      const res = await fetch(`/api/operations/supervisor-notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note_type: type, body: body.trim(), shift_id: shiftId }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Save failed"); return; }
      setBody(""); router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(null); }
  }
  async function close(id: string) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/operations/supervisor-notes?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "closed" }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Update failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(null); }
  }
  const sel = "text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-3"><span className="w-7 h-7 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center text-sm font-bold">5</span><div><h2 className="text-sm font-bold text-gray-900 leading-tight">Supervisor Notes</h2><p className="text-[10px] text-gray-500">Shift notes, decisions &amp; operational log</p></div></div>

      {editable && (
        <div className="mb-3 space-y-2">
          <div className="flex gap-2">
            <select value={type} onChange={e => setType(e.target.value)} className={`${sel} flex-1`}>{NOTE_TYPES.map(t => <option key={t} value={t}>{NOTE_TYPE_LABEL[t]}</option>)}</select>
          </div>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={2} placeholder="Write a note…" className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none" />
          <button onClick={add} disabled={!body.trim() || busy === "add"} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">{busy === "add" ? "…" : "Add Note"}</button>
        </div>
      )}

      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-semibold text-gray-400 uppercase">Recent notes</p>
        <select value={filter} onChange={e => setFilter(e.target.value)} className="text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white"><option value="all">All types</option>{NOTE_TYPES.map(t => <option key={t} value={t}>{NOTE_TYPE_LABEL[t]}</option>)}</select>
      </div>
      <div className="space-y-1.5 max-h-72 overflow-y-auto">
        {notes.length === 0 ? <p className="text-xs text-gray-400 py-3 text-center">No notes recorded this shift.</p> : notes.map((n: any) => (
          <div key={n.id} className="rounded-lg border border-gray-100 px-2.5 py-1.5">
            <div className="flex items-center gap-2">
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${TYPE_TONE[n.note_type] ?? "bg-gray-100 text-gray-600"}`}>{NOTE_TYPE_LABEL[n.note_type] ?? n.note_type}</span>
              {n.note_type === "action_item" && <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${n.status === "open" ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"}`}>{n.status}</span>}
              <span className="ml-auto text-[10px] text-gray-400 shrink-0">{relTime(n.created_at)}</span>
            </div>
            <p className="text-xs text-gray-800 mt-0.5">{n.body}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-gray-400">{n.author_name ?? "—"}</span>
              {editable && n.note_type === "action_item" && n.status === "open" && <button onClick={() => close(n.id)} disabled={busy === n.id} className="text-[10px] text-green-700 hover:underline">mark done</button>}
            </div>
          </div>
        ))}
      </div>
      {err && <p className="text-[11px] text-rose-600 mt-2">{err}</p>}
    </div>
  );
}
