"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ASSIGNMENT_TYPES, ASSIGNMENT_SOURCES, TYPE_LABEL, SOURCE_LABEL } from "@/lib/operations/supervisor-assignments";

// Supervisor assignment & confirmation (SSW-002 §6.3 / §8 / §9.2). Assign a
// supervisor to the shift, then confirm or decline. Confirming a PRIMARY sets the
// shift's command owner and satisfies the supervisor_confirmed readiness item.
// Writes through the audited supervisor-assignment API.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Assignment = { id: string; name: string; type: string; source: string; status: string; declinedReason: string | null; assignedBy: string | null };
type Staff = { id: string; full_name: string };

const STATUS_TONE: Record<string, string> = { confirmed: "bg-green-50 text-green-700 border-green-200", pending: "bg-amber-50 text-amber-700 border-amber-200", declined: "bg-gray-100 text-gray-500 border-gray-200" };

export default function SupervisorPanel({ shiftId, provisioned, assignments, staff, editable }: {
  shiftId: string | null; provisioned: boolean; assignments: Assignment[]; staff: Staff[]; editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [type, setType] = useState("primary");
  const [source, setSource] = useState("manual");

  if (!provisioned) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-bold text-gray-900">Command &amp; Supervisor Assignment</h2>
        <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-4 text-center">
          <p className="text-sm text-gray-500">Supervisor assignments not provisioned</p>
          <p className="text-[11px] text-gray-400 mt-1">Run migration <span className="font-mono">065-shift-supervisor-assignments</span> to enable command assignment &amp; confirmation.</p>
        </div>
      </div>
    );
  }

  async function assign() {
    if (!shiftId || !userId) return;
    setBusy("assign"); setErr(null);
    try {
      const res = await fetch(`/api/operations/shift-supervisors`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shift_id: shiftId, user_id: userId, assignment_type: type, assignment_source: source }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Assign failed"); return; }
      setUserId(""); router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(null); }
  }

  async function decide(id: string, action: "confirm" | "decline") {
    let body: any = { action };
    if (action === "decline") {
      const reason = typeof window !== "undefined" ? window.prompt("Reason for declining:") : "";
      if (!reason || !reason.trim()) return;
      body = { ...body, declined_reason: reason.trim() };
    }
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/operations/shift-supervisors?id=${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Update failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(null); }
  }

  const sel = "text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-bold text-gray-900">Command &amp; Supervisor Assignment</h2>
      <p className="text-[11px] text-gray-500 mb-3">One accountable command owner per shift — confirming a primary establishes command (SSW-002 §8).</p>

      <div className="space-y-1.5 mb-3">
        {assignments.length === 0 && <p className="text-xs text-gray-400">No supervisor assigned to this shift yet.</p>}
        {assignments.map((a) => (
          <div key={a.id} className="flex items-center gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-gray-800 truncate">{a.name}
                <span className="ml-1.5 text-[9px] font-semibold uppercase text-gray-400">{TYPE_LABEL[a.type] ?? a.type}</span>
              </p>
              <p className="text-[10px] text-gray-400 truncate">{SOURCE_LABEL[a.source] ?? a.source}{a.assignedBy ? ` · by ${a.assignedBy}` : ""}{a.status === "declined" && a.declinedReason ? ` · ${a.declinedReason}` : ""}</p>
            </div>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${STATUS_TONE[a.status] ?? "bg-gray-100 text-gray-500"}`}>{a.status}</span>
            {editable && a.status === "pending" && (
              <span className="flex gap-1 shrink-0">
                <button onClick={() => decide(a.id, "confirm")} disabled={busy === a.id} className="text-[10px] font-semibold text-green-700 hover:underline">confirm</button>
                <button onClick={() => decide(a.id, "decline")} disabled={busy === a.id} className="text-[10px] text-gray-400 hover:underline">decline</button>
              </span>
            )}
          </div>
        ))}
      </div>

      {editable && (
        <div className="pt-3 border-t border-gray-100">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Assign supervisor</p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={userId} onChange={e => setUserId(e.target.value)} className={`${sel} flex-1 min-w-[140px]`}>
              <option value="">Select staff…</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            <select value={type} onChange={e => setType(e.target.value)} className={sel}>
              {ASSIGNMENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
            <select value={source} onChange={e => setSource(e.target.value)} className={sel}>
              {ASSIGNMENT_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </select>
            <button onClick={assign} disabled={!userId || busy === "assign"} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
              {busy === "assign" ? "…" : "Assign"}
            </button>
          </div>
        </div>
      )}
      {err && <p className="text-[11px] text-rose-600 mt-2">{err}</p>}
    </div>
  );
}
