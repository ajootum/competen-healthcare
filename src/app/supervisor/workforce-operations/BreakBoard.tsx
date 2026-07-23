"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BREAK_TYPES } from "@/lib/operations/workforce-breaks-notes";

// Break Management workspace (SSW-WFO-001 §4). Live break board — schedule a
// break, start/end it, and see overdue/upcoming with compliance. Writes through
// the audited break API. Replaces the previous static break placeholder.
/* eslint-disable @typescript-eslint/no-explicit-any */

const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const scoreTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 90 ? "text-green-600" : n >= 75 ? "text-amber-600" : "text-rose-600");

export default function BreakBoard({ shiftId, data, staff, editable }: {
  shiftId: string | null; data: any; staff: { id: string; name: string; role: string }[]; editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [staffId, setStaffId] = useState("");
  const [type, setType] = useState("rest");
  const [dur, setDur] = useState("30");

  if (!data || data.provisioned === false) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-2"><span className="w-7 h-7 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center text-sm font-bold">4</span><div><h2 className="text-sm font-bold text-gray-900 leading-tight">Break Management</h2><p className="text-[10px] text-gray-500">Break scheduling, compliance &amp; fatigue</p></div></div>
        <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-4 text-center">
          <p className="text-sm text-gray-500">Break management not provisioned</p>
          <p className="text-[11px] text-gray-400 mt-1">Run migration <span className="font-mono">069-workforce-breaks-notes</span> for the live break board.</p>
        </div>
      </div>
    );
  }
  const comp = data.compliance;
  const donut = (() => { const segs = [["#22c55e", comp.compliant], ["#f59e0b", comp.atRisk], ["#ef4444", comp.overdue]] as [string, number][]; const tot = comp.compliant + comp.atRisk + comp.overdue || 1; let acc = 0; const st: string[] = []; segs.forEach(([c, n]) => { const a = (acc / tot) * 360, b = ((acc + n) / tot) * 360; if (n) st.push(`${c} ${a}deg ${b}deg`); acc += n; }); return st.length ? `conic-gradient(${st.join(", ")})` : "conic-gradient(#e5e7eb 0deg 360deg)"; })();

  async function schedule() {
    if (!staffId) return;
    const s = staff.find(x => x.id === staffId);
    setBusy("schedule"); setErr(null);
    try {
      const res = await fetch(`/api/operations/staff-breaks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staff_id: staffId, role: s?.role, break_type: type, duration_min: Number(dur) || 30, shift_id: shiftId }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Schedule failed"); return; }
      setStaffId(""); router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(null); }
  }
  async function move(id: string, status: string) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/operations/staff-breaks?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Update failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(null); }
  }
  const sel = "text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-3"><span className="w-7 h-7 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center text-sm font-bold">4</span><div><h2 className="text-sm font-bold text-gray-900 leading-tight">Break Management</h2><p className="text-[10px] text-gray-500">Break scheduling, compliance &amp; fatigue</p></div></div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {[["Due for Break", data.dueForBreak, "text-gray-900"], ["On Break Now", data.onBreakNow, "text-blue-600"], ["Overdue Breaks", data.overdue, data.overdue > 0 ? "text-rose-600" : "text-gray-900"]].map(([l, n, tone]: any) => (
          <div key={l} className="rounded-lg border border-gray-100 p-2 text-center"><p className={`text-xl font-bold tabular-nums ${tone}`}>{n}</p><p className="text-[9px] text-gray-500">{l}</p></div>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="relative w-16 h-16 shrink-0 rounded-full" style={{ background: donut }}><div className="absolute inset-[7px] bg-white rounded-full flex items-center justify-center"><span className={`text-sm font-bold ${scoreTone(comp.pct)}`}>{comp.pct == null ? "—" : `${comp.pct}%`}</span></div></div>
        <div className="text-[11px] space-y-0.5 flex-1">
          {[["Compliant", comp.compliant, "#22c55e"], ["At Risk", comp.atRisk, "#f59e0b"], ["Overdue", comp.overdue, "#ef4444"]].map(([l, n, c]: any) => (
            <div key={l} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><span className="text-gray-600 flex-1">{l}</span><span className="font-semibold text-gray-800 tabular-nums">{n}</span></div>
          ))}
        </div>
      </div>

      {data.overdueList.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Overdue breaks</p>
          <div className="space-y-1">
            {data.overdueList.slice(0, 4).map((r: any) => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg border border-rose-100 bg-rose-50/40 px-2 py-1">
                <span className="text-xs text-gray-800 flex-1 truncate">{r.name} <span className="text-gray-400">{r.role}</span></span>
                <span className="text-[10px] font-semibold text-rose-600">+{r.overdueMin}m</span>
                {editable && <button onClick={() => move(r.id, "on_break")} disabled={busy === r.id} className="text-[10px] text-teal-700 hover:underline">start</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.onBreakList.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">On break now</p>
          <div className="space-y-1">
            {data.onBreakList.map((r: any) => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/40 px-2 py-1">
                <span className="text-xs text-gray-800 flex-1 truncate">{r.name} <span className="text-gray-400">· since {fmt(r.since)}</span></span>
                {editable && <button onClick={() => move(r.id, "completed")} disabled={busy === r.id} className="text-[10px] text-green-700 hover:underline">end break</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.upcomingList.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Upcoming</p>
          <div className="space-y-1">
            {data.upcomingList.map((r: any) => (
              <div key={r.id} className="flex items-center gap-2 text-xs"><span className="text-gray-700 flex-1 truncate">{r.name}</span><span className="text-gray-400">{fmt(r.at)} · {r.duration}m</span>{editable && <button onClick={() => move(r.id, "on_break")} disabled={busy === r.id} className="text-[10px] text-teal-700 hover:underline">start</button>}</div>
            ))}
          </div>
        </div>
      )}

      {editable && (
        <div className="pt-3 border-t border-gray-100">
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Schedule break</p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={staffId} onChange={e => setStaffId(e.target.value)} className={`${sel} flex-1 min-w-[120px]`}><option value="">Select staff…</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <select value={type} onChange={e => setType(e.target.value)} className={sel}>{BREAK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
            <input type="number" min={5} value={dur} onChange={e => setDur(e.target.value)} className={`${sel} w-16`} title="minutes" />
            <button onClick={schedule} disabled={!staffId || busy === "schedule"} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">{busy === "schedule" ? "…" : "Schedule"}</button>
          </div>
        </div>
      )}
      {err && <p className="text-[11px] text-rose-600 mt-2">{err}</p>}
    </div>
  );
}
