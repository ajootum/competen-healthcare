"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Patient Shift Management client — the per-patient shift worklist + summary +
// exceptions. Review / Mark updated / Complete handover post to
// /api/operations/shift-updates, then router.refresh() re-pulls server state.
/* eslint-disable @typescript-eslint/no-explicit-any */
const ewsColor = (n: number | null) => n == null ? "text-gray-400" : n >= 7 ? "text-red-600" : n >= 5 ? "text-orange-600" : n >= 3 ? "text-yellow-600" : "text-green-600";
const card = "bg-white rounded-xl border border-gray-200 p-5";
const chip = "text-[10px] px-2 py-0.5 rounded-full";
const U_TONE: Record<string, string> = { due: "bg-gray-100 text-gray-500", updated: "bg-green-100 text-green-700", overdue: "bg-red-100 text-red-700" };

async function call(path: string, body: any) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return <div className={card + " py-4"}><p className={`text-3xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{n}</p><p className="text-xs text-gray-500 mt-1">{label}</p></div>;
}

export default function ShiftManagementClient({ rows, configReady, shiftLabel }: { rows: any[]; configReady: boolean; shiftLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 4000); };
  async function act(patient_id: string, patch: any, okText: string) {
    setBusy(true); const r = await call("/api/operations/shift-updates", { patient_id, ...patch }); setBusy(false);
    if (r.ok) { toast("ok", okText); router.refresh(); } else toast("err", r.data?.error || "Failed");
  }

  const reviewed = rows.filter(r => r.reviewed).length;
  const updated = rows.filter(r => r.updateStatus === "updated").length;
  const due = rows.filter(r => r.updateStatus === "due").length;
  const overdue = rows.filter(r => r.updateStatus === "overdue").length;
  const handovers = rows.filter(r => r.handoverStatus === "completed").length;

  const exceptions = [
    { label: "No nurse assigned", list: rows.filter(r => !r.nurseId) },
    { label: "Review incomplete", list: rows.filter(r => !r.reviewed) },
    { label: "Update overdue", list: rows.filter(r => r.updateStatus === "overdue") },
    { label: "High-risk not updated", list: rows.filter(r => r.highRisk && r.updateStatus !== "updated") },
    { label: "Handover incomplete", list: rows.filter(r => r.handoverStatus !== "completed") },
  ].filter(e => e.list.length > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Patient Shift Management</h1>
          <p className="text-sm text-gray-500 mt-1">Start-of-shift review · during-shift updates · handover — {shiftLabel}</p>
        </div>
        <Link href="/supervisor/patient-list" className="text-sm text-teal-700 hover:underline">Open Patient Census →</Link>
      </div>

      {!configReady && <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">Apply migration <code className="bg-amber-100 px-1 rounded font-mono">051-patient-shift-updates.sql</code> to record reviews, updates and handovers. The worklist below is live now.</div>}
      {msg && <div className={`text-sm rounded-lg px-4 py-2.5 ${msg.kind === "ok" ? "bg-green-50 text-green-800 border border-green-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>{msg.text}</div>}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat n={rows.length} label="Patients" />
        <Stat n={reviewed} label="Reviewed" tone="text-teal-600" />
        <Stat n={updated} label="Updated" tone="text-green-600" />
        <Stat n={due} label="Updates due" tone={due ? "text-amber-600" : "text-gray-400"} />
        <Stat n={overdue} label="Overdue" tone={overdue ? "text-red-600" : "text-gray-400"} />
        <Stat n={handovers} label="Handovers done" tone="text-teal-600" />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Worklist */}
        <div className={`${card} lg:col-span-2 p-0 overflow-hidden`}>
          <h3 className="font-semibold text-gray-900 px-5 pt-5 pb-3">Shift worklist</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="px-5 py-2 font-medium">Patient</th><th className="px-2 py-2 font-medium">Nurse</th><th className="px-2 py-2 font-medium">PEWS</th>
                <th className="px-2 py-2 font-medium">Review</th><th className="px-2 py-2 font-medium">Update</th><th className="px-2 py-2 font-medium">Handover</th><th className="px-5 py-2 font-medium text-right">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {rows.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-400">No patients on the census.</td></tr>}
                {rows.map((r: any) => (
                  <tr key={r.id} className="hover:bg-gray-50/60">
                    <td className="px-5 py-2 whitespace-nowrap"><Link href={`/supervisor/patient-card/${r.id}`} className="font-medium text-teal-700 hover:underline">{r.label}</Link><span className="text-gray-400 text-xs"> {r.bed ? `· ${r.bed}` : ""}</span></td>
                    <td className="px-2 py-2 text-gray-500 whitespace-nowrap">{r.nurse ? r.nurse.split(" ")[0] : <span className="text-red-600">Unassigned</span>}</td>
                    <td className={`px-2 py-2 font-semibold tabular-nums ${ewsColor(r.pews)}`}>{r.pews ?? "—"}</td>
                    <td className="px-2 py-2">{r.reviewed ? <span className={`${chip} bg-teal-100 text-teal-700`}>Reviewed</span> : <span className={`${chip} bg-gray-100 text-gray-500`}>Pending</span>}</td>
                    <td className="px-2 py-2"><span className={`${chip} ${U_TONE[r.updateStatus]}`}>{r.updateStatus}</span></td>
                    <td className="px-2 py-2">{r.handoverStatus === "completed" ? <span className={`${chip} bg-green-100 text-green-700`}>Done</span> : <span className={`${chip} bg-gray-100 text-gray-500`}>Pending</span>}</td>
                    <td className="px-5 py-2 whitespace-nowrap text-right">
                      {configReady ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-teal-700">
                          {!r.reviewed && <button disabled={busy} onClick={() => act(r.id, { reviewed: true }, "Reviewed")} className="hover:underline">Review</button>}
                          {r.updateStatus !== "updated" && <button disabled={busy} onClick={() => act(r.id, { update_status: "updated" }, "Marked updated")} className="hover:underline">Update</button>}
                          {r.handoverStatus !== "completed" && <button disabled={busy} onClick={() => act(r.id, { handover_status: "completed" }, "Handover complete")} className="hover:underline">Handover</button>}
                        </span>
                      ) : <span className="text-[11px] text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Exceptions */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Exceptions</h3>
          <div className="space-y-2">
            {exceptions.length === 0 && <p className="text-sm text-gray-400">No exceptions — the shift is on track.</p>}
            {exceptions.map(e => (
              <div key={e.label} className="rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-800">{e.label}</span>
                  <span className="text-sm font-semibold text-amber-600 tabular-nums">{e.list.length}</span>
                </div>
                <p className="text-[11px] text-gray-500 truncate">{e.list.slice(0, 4).map((r: any) => r.label).join(", ")}{e.list.length > 4 ? "…" : ""}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
