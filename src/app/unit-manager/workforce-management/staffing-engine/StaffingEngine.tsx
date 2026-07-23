"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import { useRouter } from "next/navigation";

// Staffing Engine controls (UMW-WFM-000 §Staffing Engine) — deploy staff onto the active
// shift, change deployment status, and stand a worker down, all through the audited
// /api/operations/shift-staff route. Fill-vacancy pre-selects a role. Thin client.
type RosterRow = { id: string; name: string; role: string; status: string };
type Staff = { id: string; name: string; role: string };
const ROLES = ["nurse", "charge", "support", "float", "doctor", "therapist", "educator", "assessor"];
const STATUS_BADGE: Record<string, string> = { on_duty: "bg-emerald-50 text-emerald-700", confirmed: "bg-blue-50 text-blue-700", assigned: "bg-gray-100 text-gray-600", off_duty: "bg-amber-50 text-amber-700", absent: "bg-rose-50 text-rose-700" };
const cap = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

async function api(method: string, body: Record<string, unknown>, id?: string) {
  const res = await fetch(`/api/operations/shift-staff${id ? `?id=${id}` : ""}`, { method, headers: { "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(body) });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? "Failed"); }
}

export default function StaffingEngine({ shiftId, roster, available, presetRole }: { shiftId: string | null; roster: RosterRow[]; available: Staff[]; presetRole?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const [role, setRole] = useState(presetRole && ROLES.includes(presetRole) ? presetRole : "nurse");

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setErr(null);
    try { await fn(); router.refresh(); } catch (e: any) { setErr(e.message); }
    setBusy(null);
  }

  if (!shiftId) return <div className="border border-dashed border-gray-200 rounded-lg p-6 text-center"><p className="text-sm text-gray-500">No active shift is running for this unit.</p><p className="text-[11px] text-gray-400 mt-1">Staff deployment activates once an operational shift is open.</p></div>;

  return (
    <div className="space-y-4">
      {/* Deploy */}
      <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
        <p className="text-xs font-bold text-gray-800 mb-2">Deploy staff to shift</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={pick} onChange={e => setPick(e.target.value)} className="text-xs rounded-lg border border-gray-200 px-2 py-2 min-w-[180px]"><option value="">Select staff…</option>{available.map(s => <option key={s.id} value={s.id}>{s.name}{s.role ? ` · ${cap(s.role)}` : ""}</option>)}</select>
          <select value={role} onChange={e => setRole(e.target.value)} className="text-xs rounded-lg border border-gray-200 px-2 py-2">{ROLES.map(r => <option key={r} value={r}>{cap(r)}</option>)}</select>
          <button disabled={!pick || !!busy} onClick={() => run("deploy", async () => { await api("POST", { shift_id: shiftId, staff_id: pick, role, status: "assigned" }); setPick(""); })} className="text-xs font-semibold rounded-lg py-2 px-3 bg-emerald-600 text-white disabled:opacity-50">{busy === "deploy" ? "Deploying…" : "+ Deploy"}</button>
          {available.length === 0 && <span className="text-[11px] text-gray-400">All hospital staff already on this shift.</span>}
        </div>
      </div>

      {/* Roster */}
      {roster.length === 0 ? <p className="text-sm text-gray-400">No staff deployed on this shift yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 font-medium">Deployment actions</th></tr></thead>
            <tbody>
              {roster.map(r => (
                <tr key={r.id} className="border-b border-gray-50">
                  <td className="py-2 pr-3 text-gray-800 font-medium">{r.name}</td>
                  <td className="py-2 pr-3 text-gray-600">{cap(r.role)}</td>
                  <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_BADGE[r.status] ?? "bg-gray-100 text-gray-600"}`}>{cap(r.status)}</span></td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {([["confirmed", "Confirm"], ["on_duty", "On duty"], ["off_duty", "Off"], ["absent", "Absent"]] as [string, string][]).filter(([s]) => s !== r.status).map(([s, lbl]) => (
                        <button key={s} disabled={!!busy} onClick={() => run(`${r.id}-${s}`, () => api("PATCH", { status: s }, r.id))} className="text-[10px] rounded border border-gray-200 px-1.5 py-1 text-gray-600 hover:border-emerald-300 disabled:opacity-50">{lbl}</button>
                      ))}
                      <button disabled={!!busy} onClick={() => run(`${r.id}-del`, () => api("DELETE", {}, r.id))} className="text-[10px] rounded border border-rose-200 px-1.5 py-1 text-rose-600 hover:bg-rose-50 disabled:opacity-50" title="Stand down / remove from shift">✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {err && <p className="text-[11px] text-rose-600">{err}</p>}
      <p className="text-[10px] text-gray-400">Every deployment change is written to the audit log. Roster templates, recurring patterns and shift approval workflows are next-phase.</p>
    </div>
  );
}
