"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TRANSFER_REASONS, TRANSFER_REASON_LABEL } from "@/lib/operations/shift-closure";

// Closure & command transfer (SSW-002 §18 / §8). Capture an immutable end-of-shift
// snapshot (metrics computed server-side) and transfer operational command to the
// incoming supervisor — accepting updates the command owner. Writes via audited APIs.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Snapshot = { id: string; kind: string; census: number | null; occupied_beds: number | null; total_beds: number | null; present_staff: number | null; rostered_staff: number | null; open_alerts: number | null; active_escalations: number | null; open_tasks: number | null; overdue_tasks: number | null; completed_tasks: number | null; high_risk_patients: number | null; captured_by_name: string | null; captured_at: string };
type Transfer = { id: string; from_name: string | null; to_name: string | null; reason: string; status: string; outstanding_summary: string | null; initiated_at: string; rejected_reason: string | null };
type Staff = { id: string; full_name: string };

const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const STATUS_TONE: Record<string, string> = { initiated: "bg-amber-50 text-amber-700 border-amber-200", accepted: "bg-green-50 text-green-700 border-green-200", rejected: "bg-rose-50 text-rose-700 border-rose-200", cancelled: "bg-gray-100 text-gray-500 border-gray-200" };

export default function ClosurePanel({ shiftId, provisioned, snapshots, transfers, staff, editable }: {
  shiftId: string | null; provisioned: boolean; snapshots: Snapshot[]; transfers: Transfer[]; staff: Staff[]; editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toId, setToId] = useState("");
  const [reason, setReason] = useState("scheduled_end");
  const [summary, setSummary] = useState("");

  if (!provisioned) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-bold text-gray-900">Closure &amp; Command Transfer</h2>
        <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-4 text-center">
          <p className="text-sm text-gray-500">Closure snapshots not provisioned</p>
          <p className="text-[11px] text-gray-400 mt-1">Run migration <span className="font-mono">067-shift-closure</span> to enable snapshots &amp; command transfer.</p>
        </div>
      </div>
    );
  }

  async function capture() {
    if (!shiftId) return;
    setBusy("capture"); setErr(null);
    try {
      const res = await fetch(`/api/operations/shift-snapshots`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shift_id: shiftId, kind: "closure" }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Capture failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(null); }
  }

  async function initiate() {
    if (!shiftId || !toId) return;
    setBusy("transfer"); setErr(null);
    try {
      const res = await fetch(`/api/operations/command-transfer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shift_id: shiftId, to_user_id: toId, reason, outstanding_summary: summary.trim() || undefined }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Transfer failed"); return; }
      setToId(""); setSummary(""); router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(null); }
  }

  async function decide(id: string, action: "accept" | "reject") {
    let body: any = { action };
    if (action === "reject") { const r = typeof window !== "undefined" ? window.prompt("Reason for rejecting the transfer:") : ""; if (!r || !r.trim()) return; body = { ...body, rejected_reason: r.trim() }; }
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/operations/command-transfer?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Update failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(null); }
  }

  const sel = "text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white";
  const latest = snapshots[0];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Closure &amp; Command Transfer</h2>
          <p className="text-[11px] text-gray-500">Immutable snapshots + who accepts command (SSW-002 §18 / §8)</p>
        </div>
        {editable && <button onClick={capture} disabled={busy === "capture"} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 shrink-0">{busy === "capture" ? "…" : "Capture snapshot"}</button>}
      </div>

      {/* Latest snapshot metrics */}
      {latest ? (
        <div className="mb-3">
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Latest {latest.kind} snapshot · {relTime(latest.captured_at)}</p>
          <div className="grid grid-cols-4 gap-1.5">
            {[["Census", latest.census], ["Beds", `${latest.occupied_beds ?? "—"}/${latest.total_beds ?? "—"}`], ["Staff", `${latest.present_staff ?? "—"}/${latest.rostered_staff ?? "—"}`], ["High risk", latest.high_risk_patients], ["Alerts", latest.open_alerts], ["Escalations", latest.active_escalations], ["Tasks done", latest.completed_tasks], ["Overdue", latest.overdue_tasks]].map(([l, v]: any) => (
              <div key={l} className="rounded-lg bg-gray-50 border border-gray-100 p-1.5 text-center"><p className="text-[13px] font-bold text-gray-900 tabular-nums">{v ?? "—"}</p><p className="text-[8px] text-gray-500 uppercase truncate">{l}</p></div>
            ))}
          </div>
          {snapshots.length > 1 && <p className="text-[10px] text-gray-400 mt-1.5">{snapshots.length} snapshots captured this shift.</p>}
        </div>
      ) : <p className="text-xs text-gray-400 mb-3">No snapshots captured yet.</p>}

      {/* Command transfers */}
      <div className="pt-3 border-t border-gray-100">
        <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Command transfer</p>
        <div className="space-y-1.5 mb-2">
          {transfers.length === 0 && <p className="text-xs text-gray-400">No command transfers recorded.</p>}
          {transfers.map((t) => (
            <div key={t.id} className="rounded-lg border border-gray-100 px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-800 truncate flex-1">{t.from_name ?? "—"} → <span className="font-medium">{t.to_name ?? "—"}</span></span>
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${STATUS_TONE[t.status] ?? "bg-gray-100 text-gray-500"}`}>{t.status}</span>
                <span className="text-[10px] text-gray-400 shrink-0">{relTime(t.initiated_at)}</span>
              </div>
              <p className="text-[10px] text-gray-400">{TRANSFER_REASON_LABEL[t.reason] ?? t.reason}{t.outstanding_summary ? ` · ${t.outstanding_summary}` : ""}{t.rejected_reason ? ` · ${t.rejected_reason}` : ""}</p>
              {editable && t.status === "initiated" && (
                <div className="flex gap-2 mt-1">
                  <button onClick={() => decide(t.id, "accept")} disabled={busy === t.id} className="text-[10px] font-semibold text-green-700 hover:underline">accept command</button>
                  <button onClick={() => decide(t.id, "reject")} disabled={busy === t.id} className="text-[10px] text-gray-400 hover:underline">reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <select value={toId} onChange={e => setToId(e.target.value)} className={`${sel} flex-1 min-w-[130px]`}>
              <option value="">Incoming supervisor…</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            <select value={reason} onChange={e => setReason(e.target.value)} className={sel}>
              {TRANSFER_REASONS.map((r) => <option key={r} value={r}>{TRANSFER_REASON_LABEL[r]}</option>)}
            </select>
            <input value={summary} onChange={e => setSummary(e.target.value)} placeholder="Outstanding items (optional)" className={`${sel} flex-1 min-w-[130px]`} />
            <button onClick={initiate} disabled={!toId || busy === "transfer"} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">{busy === "transfer" ? "…" : "Initiate"}</button>
          </div>
        )}
      </div>
      {err && <p className="text-[11px] text-rose-600 mt-2">{err}</p>}
    </div>
  );
}
