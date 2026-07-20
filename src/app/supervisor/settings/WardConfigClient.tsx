"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Ward Configuration client (SSW-001) — Director of Nursing setup for beds,
// staffing standards and the round schedule. After every write it calls
// router.refresh() to re-pull the server component's data (single source of
// truth), so no local list state can drift.
/* eslint-disable @typescript-eslint/no-explicit-any */

const SHIFTS = ["any", "day", "evening", "night", "long_day", "on_call"];
const ROLES = ["charge", "nurse", "support", "float", "educator", "assessor", "doctor", "therapist"];
const BED_TYPES = ["standard", "critical_care", "isolation", "paediatric", "theatre", "recovery", "overflow"];
const BED_STATUS = ["available", "occupied", "reserved", "cleaning", "out_of_service"];
const titleCase = (s: string) => (s ?? "").replace(/_/g, " ").split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

const card = "bg-white rounded-xl border border-gray-200 p-5";
const input = "border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const btn = "px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50";
const btnGhost = "px-2 py-1 rounded-lg border border-gray-300 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50";

async function call(method: string, path: string, body?: any) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, data };
}

export default function WardConfigClient({ canEdit, configReady, beds, departments, standards, rounds }: {
  canEdit: boolean; configReady: boolean; beds: any[]; departments: any[]; standards: any[]; rounds: any[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 5000); };
  async function act(method: string, path: string, body?: any, okText?: string) {
    setBusy(true);
    const r = await call(method, path, body);
    setBusy(false);
    if (r.ok) { toast("ok", okText ?? "Saved"); router.refresh(); } else toast("err", r.data?.error || "Failed");
    return r.ok;
  }

  // ── forms ──
  const [bLabel, setBLabel] = useState(""); const [bDept, setBDept] = useState(""); const [bType, setBType] = useState("standard");
  const [sDept, setSDept] = useState(""); const [sShift, setSShift] = useState("any"); const [sRole, setSRole] = useState("nurse"); const [sMin, setSMin] = useState(""); const [sRatio, setSRatio] = useState("");
  const [rDept, setRDept] = useState(""); const [rShift, setRShift] = useState("day"); const [rTime, setRTime] = useState(""); const [rLabel, setRLabel] = useState("");

  const deptName = (d: any) => d.departments?.name ?? "All units";

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ward Configuration</h1>
        <p className="text-sm text-gray-500 mt-1">Bed capacity, mandatory staffing standards and the clinical round schedule for your ward.</p>
      </div>

      {!canEdit && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
          👀 You&apos;re viewing ward configuration in read-only mode. Changes are made by the <b>Director of Nursing</b>.
        </div>
      )}
      {msg && <div className={`text-sm rounded-lg px-4 py-2.5 ${msg.kind === "ok" ? "bg-green-50 text-green-800 border border-green-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>{msg.text}</div>}

      {/* ── Beds ────────────────────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">🛏️ Beds <span className="text-gray-400 font-normal text-sm">({beds.length})</span></h2>
        <p className="text-xs text-gray-500 mt-1">Beds define the ward&apos;s capacity and drive the Ward Map. Retire a bed to take it out of service.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="py-1.5 pr-2 font-medium">Bed</th><th className="py-1.5 px-2 font-medium">Unit</th><th className="py-1.5 px-2 font-medium">Type</th><th className="py-1.5 px-2 font-medium">Status</th>{canEdit && <th />}
            </tr></thead>
            <tbody>
              {beds.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-400">No beds configured yet.</td></tr>}
              {beds.map((b: any) => (
                <tr key={b.id} className="border-b border-gray-50">
                  <td className="py-2 pr-2 font-medium text-gray-800">{b.label}</td>
                  <td className="py-2 px-2 text-gray-500">{b.departments?.name ?? "—"}</td>
                  <td className="py-2 px-2 text-gray-500">{titleCase(b.bed_type)}</td>
                  <td className="py-2 px-2">
                    {canEdit ? (
                      <select disabled={busy} value={b.status} onChange={e => act("PATCH", `/api/operations/beds?id=${b.id}`, { status: e.target.value }, "Bed updated")} className={input}>
                        {BED_STATUS.map(s => <option key={s} value={s}>{titleCase(s)}</option>)}
                      </select>
                    ) : <span className="text-gray-600">{titleCase(b.status)}</span>}
                  </td>
                  {canEdit && <td className="py-2 text-right">{b.status !== "out_of_service" && <button className={btnGhost} disabled={busy} onClick={() => act("PATCH", `/api/operations/beds?id=${b.id}`, { status: "out_of_service" }, "Bed retired")}>Retire</button>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs text-gray-500">Label<br /><input className={input} placeholder="e.g. Bed 14" value={bLabel} onChange={e => setBLabel(e.target.value)} /></label>
            <label className="text-xs text-gray-500">Unit<br /><select className={input} value={bDept} onChange={e => setBDept(e.target.value)}><option value="">All units</option>{departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            <label className="text-xs text-gray-500">Type<br /><select className={input} value={bType} onChange={e => setBType(e.target.value)}>{BED_TYPES.map(t => <option key={t} value={t}>{titleCase(t)}</option>)}</select></label>
            <button className={btn} disabled={busy || !bLabel.trim()} onClick={async () => { if (await act("POST", "/api/operations/beds", { label: bLabel, department_id: bDept || null, bed_type: bType }, "Bed added")) setBLabel(""); }}>Add bed</button>
          </div>
        )}
      </section>

      {/* ── Staffing standards ──────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">👥 Mandatory Staffing Standards <span className="text-gray-400 font-normal text-sm">({standards.length})</span></h2>
        <p className="text-xs text-gray-500 mt-1">Required staff per role, by unit and shift type. The Command Centre compares these to who&apos;s on duty for a live mandatory-ratio compliance figure.</p>
        {!configReady ? (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">Apply migration <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">046-ward-config.sql</code> to enable staffing standards.</div>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="py-1.5 pr-2 font-medium">Unit</th><th className="py-1.5 px-2 font-medium">Shift</th><th className="py-1.5 px-2 font-medium">Role</th><th className="py-1.5 px-2 font-medium">Min staff</th><th className="py-1.5 px-2 font-medium">Target ratio</th>{canEdit && <th />}
                </tr></thead>
                <tbody>
                  {standards.length === 0 && <tr><td colSpan={6} className="py-3 text-gray-400">No standards set. Add the required staffing below.</td></tr>}
                  {standards.map((s: any) => (
                    <tr key={s.id} className="border-b border-gray-50">
                      <td className="py-2 pr-2 text-gray-700">{deptName(s)}</td>
                      <td className="py-2 px-2 text-gray-500">{titleCase(s.shift_type)}</td>
                      <td className="py-2 px-2 text-gray-700">{titleCase(s.role)}</td>
                      <td className="py-2 px-2 font-semibold tabular-nums">{s.min_count}</td>
                      <td className="py-2 px-2 text-gray-500 tabular-nums">{s.target_ratio ? `1:${s.target_ratio}` : "—"}</td>
                      {canEdit && <td className="py-2 text-right"><button className={btnGhost} disabled={busy} onClick={() => act("DELETE", `/api/operations/staffing-standards?id=${s.id}`, undefined, "Removed")}>Remove</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canEdit && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="text-xs text-gray-500">Unit<br /><select className={input} value={sDept} onChange={e => setSDept(e.target.value)}><option value="">All units</option>{departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                <label className="text-xs text-gray-500">Shift<br /><select className={input} value={sShift} onChange={e => setSShift(e.target.value)}>{SHIFTS.map(t => <option key={t} value={t}>{titleCase(t)}</option>)}</select></label>
                <label className="text-xs text-gray-500">Role<br /><select className={input} value={sRole} onChange={e => setSRole(e.target.value)}>{ROLES.map(t => <option key={t} value={t}>{titleCase(t)}</option>)}</select></label>
                <label className="text-xs text-gray-500">Min staff<br /><input type="number" min={0} className={`${input} w-20`} value={sMin} onChange={e => setSMin(e.target.value)} /></label>
                <label className="text-xs text-gray-500">Target ratio 1:<br /><input type="number" min={1} className={`${input} w-20`} placeholder="opt." value={sRatio} onChange={e => setSRatio(e.target.value)} /></label>
                <button className={btn} disabled={busy} onClick={async () => { if (await act("POST", "/api/operations/staffing-standards", { department_id: sDept || null, shift_type: sShift, role: sRole, min_count: sMin || 0, target_ratio: sRatio || null }, "Standard saved")) { setSMin(""); setSRatio(""); } }}>Save standard</button>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Round schedule ──────────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">🕑 Clinical Round Schedule <span className="text-gray-400 font-normal text-sm">({rounds.length})</span></h2>
        <p className="text-xs text-gray-500 mt-1">Planned rounds (ward round, medication round, observations…) by shift type. These appear on the Command Centre&apos;s Shift Timeline as scheduled milestones.</p>
        {!configReady ? (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">Apply migration <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">046-ward-config.sql</code> to enable the round schedule.</div>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="py-1.5 pr-2 font-medium">Time</th><th className="py-1.5 px-2 font-medium">Round</th><th className="py-1.5 px-2 font-medium">Unit</th><th className="py-1.5 px-2 font-medium">Shift</th>{canEdit && <th />}
                </tr></thead>
                <tbody>
                  {rounds.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-400">No rounds scheduled. Add the ward&apos;s routine below.</td></tr>}
                  {rounds.map((r: any) => (
                    <tr key={r.id} className="border-b border-gray-50">
                      <td className="py-2 pr-2 font-semibold tabular-nums text-gray-800">{r.at_time}</td>
                      <td className="py-2 px-2 text-gray-700">{r.label}</td>
                      <td className="py-2 px-2 text-gray-500">{deptName(r)}</td>
                      <td className="py-2 px-2 text-gray-500">{titleCase(r.shift_type)}</td>
                      {canEdit && <td className="py-2 text-right"><button className={btnGhost} disabled={busy} onClick={() => act("DELETE", `/api/operations/round-schedule?id=${r.id}`, undefined, "Removed")}>Remove</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canEdit && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="text-xs text-gray-500">Time<br /><input type="time" className={input} value={rTime} onChange={e => setRTime(e.target.value)} /></label>
                <label className="text-xs text-gray-500">Round<br /><input className={input} placeholder="e.g. Ward Round" value={rLabel} onChange={e => setRLabel(e.target.value)} /></label>
                <label className="text-xs text-gray-500">Unit<br /><select className={input} value={rDept} onChange={e => setRDept(e.target.value)}><option value="">All units</option>{departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                <label className="text-xs text-gray-500">Shift<br /><select className={input} value={rShift} onChange={e => setRShift(e.target.value)}>{SHIFTS.map(t => <option key={t} value={t}>{titleCase(t)}</option>)}</select></label>
                <button className={btn} disabled={busy || !rTime || !rLabel.trim()} onClick={async () => { if (await act("POST", "/api/operations/round-schedule", { department_id: rDept || null, shift_type: rShift, at_time: rTime, label: rLabel }, "Round added")) { setRTime(""); setRLabel(""); } }}>Add round</button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
