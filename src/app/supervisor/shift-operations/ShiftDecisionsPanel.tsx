"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DECISION_TYPES, DECISION_TYPE_LABEL } from "@/lib/operations/shift-records";

// Material operational decisions (SSW-002 §6.8 / §5.4). Log a decision (type +
// summary + reason) and review/close it. Writes through the audited API.

type Decision = { id: string; decision_type: string; decision_summary: string; decision_reason: string | null; decision_maker_name: string | null; decided_at: string; status: string };

const STATUS_TONE: Record<string, string> = { active: "bg-blue-50 text-blue-700 border-blue-200", under_review: "bg-amber-50 text-amber-700 border-amber-200", closed: "bg-green-50 text-green-700 border-green-200", reversed: "bg-gray-100 text-gray-500 border-gray-200" };
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };

export default function ShiftDecisionsPanel({ shiftId, provisioned, decisions, editable }: {
  shiftId: string | null; provisioned: boolean; decisions: Decision[]; editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("redeploy_staff");
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");

  if (!provisioned) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-bold text-gray-900">Operational Decisions</h2>
        <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-4 text-center">
          <p className="text-sm text-gray-500">Decision log not provisioned</p>
          <p className="text-[11px] text-gray-400 mt-1">Run migration <span className="font-mono">066-shift-records</span> to enable the decision log.</p>
        </div>
      </div>
    );
  }

  async function log() {
    if (!shiftId || !summary.trim()) return;
    setBusy("log"); setErr(null);
    try {
      const res = await fetch(`/api/operations/shift-decisions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shift_id: shiftId, decision_type: type, decision_summary: summary.trim(), decision_reason: reason.trim() || undefined }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Log failed"); return; }
      setSummary(""); setReason(""); setOpen(false); router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(null); }
  }

  async function setStatus(id: string, status: string) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/operations/shift-decisions?id=${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Update failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(null); }
  }

  const sel = "text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Operational Decisions</h2>
          <p className="text-[11px] text-gray-500">Material decisions, recorded &amp; accountable (SSW-002 §6.8)</p>
        </div>
        {editable && <button onClick={() => setOpen(o => !o)} className="text-xs font-semibold text-teal-700 hover:underline shrink-0">{open ? "Cancel" : "+ Log decision"}</button>}
      </div>

      {open && editable && (
        <div className="mb-3 rounded-lg border border-gray-100 bg-gray-50/50 p-2.5 space-y-2">
          <div className="flex gap-2">
            <select value={type} onChange={e => setType(e.target.value)} className={`${sel} flex-1`}>
              {DECISION_TYPES.map(t => <option key={t} value={t}>{DECISION_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <input value={summary} onChange={e => setSummary(e.target.value)} placeholder="Decision summary *" className={`${sel} w-full`} />
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)" className={`${sel} w-full`} />
          <button onClick={log} disabled={!summary.trim() || busy === "log"} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">{busy === "log" ? "…" : "Record decision"}</button>
        </div>
      )}

      <div className="space-y-1.5">
        {decisions.length === 0 && <p className="text-xs text-gray-400">No decisions recorded this shift.</p>}
        {decisions.map((d) => (
          <div key={d.id} className="rounded-lg border border-gray-100 px-2.5 py-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-semibold uppercase text-gray-400 shrink-0">{DECISION_TYPE_LABEL[d.decision_type] ?? d.decision_type}</span>
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${STATUS_TONE[d.status] ?? "bg-gray-100 text-gray-500"}`}>{d.status.replace("_", " ")}</span>
              <span className="ml-auto text-[10px] text-gray-400 shrink-0">{relTime(d.decided_at)}</span>
            </div>
            <p className="text-xs text-gray-800 mt-0.5">{d.decision_summary}</p>
            {d.decision_reason && <p className="text-[10px] text-gray-400 truncate">{d.decision_reason}</p>}
            {editable && (d.status === "active" || d.status === "under_review") && (
              <div className="flex gap-2 mt-1">
                {d.status === "active" && <button onClick={() => setStatus(d.id, "under_review")} disabled={busy === d.id} className="text-[10px] text-amber-600 hover:underline">review</button>}
                <button onClick={() => setStatus(d.id, "closed")} disabled={busy === d.id} className="text-[10px] text-green-700 hover:underline">close</button>
                <button onClick={() => setStatus(d.id, "reversed")} disabled={busy === d.id} className="text-[10px] text-gray-400 hover:underline">reverse</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {err && <p className="text-[11px] text-rose-600 mt-2">{err}</p>}
    </div>
  );
}
