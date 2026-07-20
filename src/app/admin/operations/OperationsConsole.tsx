"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */

const SHIFT_TYPES = ["day", "evening", "night", "long_day", "on_call"];
const BED_TYPES = ["standard", "critical_care", "isolation", "paediatric", "theatre", "recovery", "overflow"];
const ACUITY = ["stable", "moderate", "high", "critical"];
const DEP = ["level_0", "level_1", "level_2", "level_3"];
const ISO = ["none", "contact", "droplet", "airborne", "protective"];
const RISK = ["low", "medium", "high"];
const STAFF_ROLES = ["charge", "nurse", "support", "float", "educator", "assessor", "doctor", "therapist"];
const SAFETY_CATS = ["fall_risk", "medication", "pressure_injury", "infection", "patient_id", "deterioration", "device", "environmental"];
const TABS = ["Command", "Shifts", "Ward", "Assignments", "Safety"] as const;

async function call(method: string, path: string, body?: any) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

const card = "bg-white rounded-xl border border-gray-200 p-5";
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const btn = "px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50";
const btnGhost = "px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50";
const label = "block text-sm";
const lbl = "text-gray-600 text-xs";

type UI = { busy: boolean; setBusy: (b: boolean) => void; toast: (k: "ok" | "err", t: string) => void; refresh: () => void };
type TabProps = { data: any; support: any; ui: UI };

const ACUITY_COLOR: Record<string, string> = { stable: "bg-green-100 text-green-700", moderate: "bg-yellow-100 text-yellow-700", high: "bg-orange-100 text-orange-700", critical: "bg-red-100 text-red-700" };
const LEVEL_COLOR = (l: number) => l >= 4 ? "bg-red-100 text-red-700" : l === 3 ? "bg-orange-100 text-orange-700" : "bg-yellow-100 text-yellow-700";
const SEV_COLOR: Record<string, string> = { low: "bg-yellow-100 text-yellow-700", medium: "bg-orange-100 text-orange-700", high: "bg-red-100 text-red-700" };
const pretty = (s: string) => (s ?? "").replace(/_/g, " ");

function Stat({ n, label, tone }: { n: number | string; label: string; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{n}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

// ── Command board ─────────────────────────────────────────────────────────────
function CommandTab({ data }: TabProps) {
  const bed = (s: string) => data.beds.filter((b: any) => b.status === s).length;
  const totalBeds = data.beds.length;
  const occ = bed("occupied");
  const occPct = totalBeds ? Math.round((occ / totalBeds) * 100) : 0;
  const activeShifts = data.shifts.filter((s: any) => s.status === "active").length;
  const onDuty = data.shiftStaff.filter((s: any) => s.status === "on_duty" || s.status === "confirmed" || s.status === "assigned").length;
  const critical = data.patients.filter((p: any) => p.acuity_level === "critical").length;
  const l45 = data.escalations.filter((e: any) => e.level >= 4).length;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat n={activeShifts} label="Active shifts" tone="text-teal-700" />
        <Stat n={onDuty} label="Staff deployed" />
        <Stat n={data.patients.length} label="Operational patients" />
        <Stat n={critical} label="Critical acuity" tone={critical ? "text-red-600" : undefined} />
        <Stat n={`${occPct}%` as any} label={`Bed occupancy (${occ}/${totalBeds})`} tone={occPct >= 90 ? "text-red-600" : occPct >= 75 ? "text-orange-600" : "text-green-700"} />
        <Stat n={bed("available")} label="Beds available" tone="text-green-700" />
        <Stat n={data.escalations.length} label="Open escalations" tone={l45 ? "text-red-600" : undefined} />
        <Stat n={data.alerts.length} label="Active safety alerts" tone={data.alerts.length ? "text-orange-600" : undefined} />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Capacity by status</h3>
          {totalBeds === 0 && <p className="text-sm text-gray-400">No beds registered yet (add them in the Ward tab).</p>}
          {totalBeds > 0 && (
            <div className="flex h-6 rounded-md overflow-hidden border border-gray-200 mb-2">
              {[["occupied", "#ef4444"], ["reserved", "#f59e0b"], ["cleaning", "#3b82f6"], ["out_of_service", "#9ca3af"], ["available", "#22c55e"]].map(([s, col]) => {
                const w = totalBeds ? (bed(s as string) / totalBeds) * 100 : 0;
                return w ? <div key={s} style={{ width: `${w}%`, background: col as string }} title={`${pretty(s as string)}: ${bed(s as string)}`} /> : null;
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            {["available", "occupied", "reserved", "cleaning", "out_of_service"].map(s => <span key={s}>{pretty(s)}: <b className="text-gray-800">{bed(s)}</b></span>)}
          </div>
        </div>

        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Priority escalations</h3>
          {data.escalations.length === 0 && <p className="text-sm text-gray-400">No open escalations.</p>}
          <div className="space-y-1.5">
            {data.escalations.slice(0, 6).map((e: any) => (
              <div key={e.id} className="flex items-center gap-2 text-sm">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${LEVEL_COLOR(e.level)}`}>L{e.level}</span>
                <span className="text-gray-800 truncate">{e.summary}</span>
                {e.op_patients?.label && <span className="text-xs text-gray-400">· {e.op_patients.label}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shifts ────────────────────────────────────────────────────────────────────
function ShiftsTab({ data, support, ui }: TabProps) {
  const [deptId, setDeptId] = useState(""); const [type, setType] = useState("day"); const [date, setDate] = useState(""); const [supervisor, setSupervisor] = useState("");
  const [selShift, setSelShift] = useState<string>(data.shifts[0]?.id ?? "");
  const [staffId, setStaffId] = useState(""); const [staffRole, setStaffRole] = useState("nurse");
  const deptName = (id: string) => support.departments.find((d: any) => d.id === id)?.name ?? "—";
  const staffName = (id: string) => support.staff.find((s: any) => s.id === id)?.full_name ?? "—";
  const onShift = data.shiftStaff.filter((s: any) => s.shift_id === selShift);

  async function openShift() {
    ui.setBusy(true);
    const r = await call("POST", "/api/operations/shifts", { department_id: deptId || undefined, shift_type: type, shift_date: date || undefined, supervisor_id: supervisor || undefined });
    ui.setBusy(false);
    if (r.ok) { ui.toast("ok", "Shift opened"); ui.refresh(); } else ui.toast("err", r.data?.error || "Failed");
  }
  async function setStatus(id: string, status: string) {
    ui.setBusy(true); const r = await call("PATCH", `/api/operations/shifts?id=${id}`, { status }); ui.setBusy(false);
    if (r.ok) { ui.toast("ok", `Shift ${status}`); ui.refresh(); } else ui.toast("err", r.data?.error || "Failed");
  }
  async function deploy() {
    if (!selShift || !staffId) { ui.toast("err", "Pick a shift and a staff member"); return; }
    ui.setBusy(true); const r = await call("POST", "/api/operations/shift-staff", { shift_id: selShift, staff_id: staffId, role: staffRole }); ui.setBusy(false);
    if (r.ok) { ui.toast("ok", "Staff deployed"); ui.refresh(); } else ui.toast("err", r.data?.error || "Failed");
  }
  async function undeploy(id: string) {
    ui.setBusy(true); const r = await call("DELETE", `/api/operations/shift-staff?id=${id}`); ui.setBusy(false);
    if (r.ok) { ui.toast("ok", "Removed"); ui.refresh(); } else ui.toast("err", r.data?.error || "Failed");
  }

  return (
    <div className="grid md:grid-cols-2 gap-5">
      <div className="space-y-5">
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Open a shift</h3>
          <div className="grid grid-cols-2 gap-2">
            <label className={label}><span className={lbl}>Department</span><select className={input} value={deptId} onChange={e => setDeptId(e.target.value)}><option value="">Select…</option>{support.departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            <label className={label}><span className={lbl}>Shift type</span><select className={input} value={type} onChange={e => setType(e.target.value)}>{SHIFT_TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
            <label className={label}><span className={lbl}>Date</span><input type="date" className={input} value={date} onChange={e => setDate(e.target.value)} /></label>
            <label className={label}><span className={lbl}>Supervisor</span><select className={input} value={supervisor} onChange={e => setSupervisor(e.target.value)}><option value="">—</option>{support.staff.map((s: any) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label>
          </div>
          <button className={`${btn} mt-3`} disabled={ui.busy} onClick={openShift}>Open shift</button>
        </div>

        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Deploy staff onto a shift</h3>
          <div className="space-y-2">
            <label className={label}><span className={lbl}>Shift</span><select className={input} value={selShift} onChange={e => setSelShift(e.target.value)}><option value="">Select shift…</option>{data.shifts.map((s: any) => <option key={s.id} value={s.id}>{deptName(s.department_id)} · {s.shift_type} · {s.shift_date}</option>)}</select></label>
            <div className="grid grid-cols-2 gap-2">
              <label className={label}><span className={lbl}>Staff</span><select className={input} value={staffId} onChange={e => setStaffId(e.target.value)}><option value="">Select…</option>{support.staff.map((s: any) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label>
              <label className={label}><span className={lbl}>Role on shift</span><select className={input} value={staffRole} onChange={e => setStaffRole(e.target.value)}>{STAFF_ROLES.map(r => <option key={r}>{r}</option>)}</select></label>
            </div>
            <button className={btn} disabled={ui.busy} onClick={deploy}>Deploy</button>
          </div>
          {selShift && (
            <div className="mt-3 divide-y">
              {onShift.length === 0 && <p className="text-sm text-gray-400 pt-2">No staff on this shift yet.</p>}
              {onShift.map((s: any) => (
                <div key={s.id} className="py-2 flex items-center gap-2 text-sm">
                  <span className="text-gray-800">{s.profiles?.full_name ?? staffName(s.staff_id)}</span>
                  <span className="text-xs text-gray-400">{s.role} · {s.status}</span>
                  <button className={`${btnGhost} ml-auto`} disabled={ui.busy} onClick={() => undeploy(s.id)}>Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Shifts ({data.shifts.length})</h3>
        <div className="divide-y">
          {data.shifts.length === 0 && <p className="text-sm text-gray-400">No shifts yet.</p>}
          {data.shifts.map((s: any) => {
            const cnt = data.shiftStaff.filter((x: any) => x.shift_id === s.id).length;
            return (
              <div key={s.id} className="py-2.5 flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-800">{s.departments?.name ?? "—"}</span>
                <span className="text-xs text-gray-400">{s.shift_type} · {s.shift_date} · {cnt} staff{s.profiles?.full_name ? ` · ${s.profiles.full_name}` : ""}</span>
                <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full ${s.status === "active" ? "bg-teal-100 text-teal-700" : s.status === "completed" ? "bg-gray-100 text-gray-500" : s.status === "cancelled" ? "bg-red-50 text-red-600" : "bg-yellow-100 text-yellow-700"}`}>{s.status}</span>
                {s.status === "planned" && <button className={btnGhost} disabled={ui.busy} onClick={() => setStatus(s.id, "active")}>Activate</button>}
                {s.status === "active" && <button className={btnGhost} disabled={ui.busy} onClick={() => setStatus(s.id, "completed")}>Complete</button>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Ward (beds & patients) ────────────────────────────────────────────────────
function WardTab({ data, support, ui }: TabProps) {
  const [bLabel, setBLabel] = useState(""); const [bDept, setBDept] = useState(""); const [bType, setBType] = useState("standard");
  const [pLabel, setPLabel] = useState(""); const [pDept, setPDept] = useState(""); const [pBed, setPBed] = useState(""); const [pAcuity, setPAcuity] = useState("stable"); const [pDepy, setPDepy] = useState("level_1"); const [pIso, setPIso] = useState("none"); const [pRisk, setPRisk] = useState("low");
  const availableBeds = data.beds.filter((b: any) => b.status === "available");

  async function addBed() {
    if (!bLabel.trim()) return;
    ui.setBusy(true); const r = await call("POST", "/api/operations/beds", { label: bLabel, department_id: bDept || undefined, bed_type: bType }); ui.setBusy(false);
    if (r.ok) { setBLabel(""); ui.toast("ok", "Bed added"); ui.refresh(); } else ui.toast("err", r.data?.error || "Failed");
  }
  async function bedStatus(id: string, status: string) {
    ui.setBusy(true); const r = await call("PATCH", `/api/operations/beds?id=${id}`, { status }); ui.setBusy(false);
    if (r.ok) ui.refresh(); else ui.toast("err", r.data?.error || "Failed");
  }
  async function registerPatient() {
    if (!pLabel.trim()) { ui.toast("err", "Operational label required"); return; }
    ui.setBusy(true);
    const r = await call("POST", "/api/operations/patients", { label: pLabel, department_id: pDept || undefined, bed_id: pBed || undefined, acuity_level: pAcuity, dependency_level: pDepy, isolation_status: pIso, risk_level: pRisk });
    ui.setBusy(false);
    if (r.ok) { setPLabel(""); setPBed(""); ui.toast("ok", "Patient registered"); ui.refresh(); } else ui.toast("err", r.data?.error || "Failed");
  }
  async function discharge(id: string) {
    ui.setBusy(true); const r = await call("PATCH", `/api/operations/patients?id=${id}`, { operational_status: "discharged" }); ui.setBusy(false);
    if (r.ok) { ui.toast("ok", "Discharged"); ui.refresh(); } else ui.toast("err", r.data?.error || "Failed");
  }

  return (
    <div className="grid md:grid-cols-2 gap-5">
      <div className="space-y-5">
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Add bed</h3>
          <div className="grid grid-cols-3 gap-2">
            <input className={input} placeholder="Label (Bay A-3)" value={bLabel} onChange={e => setBLabel(e.target.value)} />
            <select className={input} value={bDept} onChange={e => setBDept(e.target.value)}><option value="">Dept…</option>{support.departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            <select className={input} value={bType} onChange={e => setBType(e.target.value)}>{BED_TYPES.map(t => <option key={t}>{pretty(t)}</option>)}</select>
          </div>
          <button className={`${btn} mt-3`} disabled={ui.busy} onClick={addBed}>Add bed</button>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.beds.map((b: any) => (
              <button key={b.id} disabled={ui.busy} title={`${pretty(b.bed_type)} · ${b.departments?.name ?? ""}`}
                onClick={() => bedStatus(b.id, b.status === "available" ? "out_of_service" : "available")}
                className={`text-xs px-2 py-1 rounded border ${b.status === "occupied" ? "bg-red-50 border-red-200 text-red-700" : b.status === "available" ? "bg-green-50 border-green-200 text-green-700" : b.status === "cleaning" ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-gray-100 border-gray-200 text-gray-500"}`}>
                {b.label}
              </button>
            ))}
            {data.beds.length === 0 && <span className="text-xs text-gray-400">No beds yet.</span>}
          </div>
        </div>

        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Register operational patient</h3>
          <p className="text-xs text-gray-500 mb-2">Operational identifier only (initials / bed alias) — not clinical records.</p>
          <div className="grid grid-cols-2 gap-2">
            <input className={input} placeholder="Label (e.g. Bay 3 · J.M.)" value={pLabel} onChange={e => setPLabel(e.target.value)} />
            <select className={input} value={pDept} onChange={e => setPDept(e.target.value)}><option value="">Dept…</option>{support.departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            <select className={input} value={pBed} onChange={e => setPBed(e.target.value)}><option value="">Bed (optional)…</option>{availableBeds.map((b: any) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
            <select className={input} value={pAcuity} onChange={e => setPAcuity(e.target.value)}>{ACUITY.map(a => <option key={a} value={a}>acuity: {a}</option>)}</select>
            <select className={input} value={pDepy} onChange={e => setPDepy(e.target.value)}>{DEP.map(a => <option key={a} value={a}>dep: {pretty(a)}</option>)}</select>
            <select className={input} value={pIso} onChange={e => setPIso(e.target.value)}>{ISO.map(a => <option key={a} value={a}>iso: {a}</option>)}</select>
            <select className={input} value={pRisk} onChange={e => setPRisk(e.target.value)}>{RISK.map(a => <option key={a} value={a}>risk: {a}</option>)}</select>
          </div>
          <button className={`${btn} mt-3`} disabled={ui.busy} onClick={registerPatient}>Register</button>
        </div>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Operational patients ({data.patients.length})</h3>
        <div className="divide-y">
          {data.patients.length === 0 && <p className="text-sm text-gray-400">No patients registered.</p>}
          {data.patients.map((p: any) => (
            <div key={p.id} className="py-2.5 flex items-center gap-2 text-sm">
              <span className="font-medium text-gray-800">{p.label}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${ACUITY_COLOR[p.acuity_level]}`}>{p.acuity_level}</span>
              <span className="text-xs text-gray-400">{p.op_beds?.label ?? "no bed"}{p.isolation_status !== "none" ? ` · ${p.isolation_status}` : ""}{p.departments?.name ? ` · ${p.departments.name}` : ""}</span>
              <button className={`${btnGhost} ml-auto`} disabled={ui.busy} onClick={() => discharge(p.id)}>Discharge</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Assignments ───────────────────────────────────────────────────────────────
function AssignmentsTab({ data, support, ui }: TabProps) {
  const [patientId, setPatientId] = useState(""); const [staffId, setStaffId] = useState(""); const [type, setType] = useState("primary");
  const [override, setOverride] = useState(""); const [needOverride, setNeedOverride] = useState(false);
  const assignedFor = (pid: string) => data.assignments.filter((a: any) => a.patient_id === pid);

  async function assign() {
    if (!patientId || !staffId) { ui.toast("err", "Pick a patient and a clinician"); return; }
    ui.setBusy(true);
    const r = await call("POST", "/api/operations/assignments", { patient_id: patientId, staff_id: staffId, assignment_type: type, override_reason: override || undefined });
    ui.setBusy(false);
    if (r.ok) { setOverride(""); setNeedOverride(false); ui.toast("ok", r.data?.competency_validated ? "Assigned (competency validated)" : "Assigned with override"); ui.refresh(); }
    else if (r.status === 422 && r.data?.requires_override) { setNeedOverride(true); ui.toast("err", "Clinician not competency-validated — enter an override reason to proceed."); }
    else ui.toast("err", r.data?.error || "Failed");
  }
  async function end(id: string) {
    ui.setBusy(true); const r = await call("PATCH", `/api/operations/assignments?id=${id}`); ui.setBusy(false);
    if (r.ok) { ui.toast("ok", "Assignment ended"); ui.refresh(); } else ui.toast("err", r.data?.error || "Failed");
  }

  return (
    <div className="grid md:grid-cols-2 gap-5">
      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-1">Assign patient to clinician</h3>
        <p className="text-xs text-gray-500 mb-3">Competency-validated automatically; an override reason is required for a non-validated clinician (emergency override).</p>
        <div className="space-y-2">
          <label className={label}><span className={lbl}>Patient</span><select className={input} value={patientId} onChange={e => setPatientId(e.target.value)}><option value="">Select…</option>{data.patients.map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2">
            <label className={label}><span className={lbl}>Clinician</span><select className={input} value={staffId} onChange={e => setStaffId(e.target.value)}><option value="">Select…</option>{support.staff.map((s: any) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label>
            <label className={label}><span className={lbl}>Type</span><select className={input} value={type} onChange={e => setType(e.target.value)}><option value="primary">primary</option><option value="supporting">supporting</option></select></label>
          </div>
          {needOverride && <input className={`${input} border-amber-300`} placeholder="Emergency override reason (required)" value={override} onChange={e => setOverride(e.target.value)} />}
          <button className={btn} disabled={ui.busy} onClick={assign}>{needOverride ? "Assign with override" : "Assign"}</button>
        </div>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Live roster ({data.assignments.length})</h3>
        <div className="divide-y">
          {data.assignments.length === 0 && <p className="text-sm text-gray-400">No active assignments.</p>}
          {data.patients.map((p: any) => {
            const rows = assignedFor(p.id);
            if (!rows.length) return null;
            return (
              <div key={p.id} className="py-2.5">
                <p className="text-sm font-medium text-gray-800">{p.label} <span className={`text-[10px] px-2 py-0.5 rounded-full ${ACUITY_COLOR[p.acuity_level]}`}>{p.acuity_level}</span></p>
                {rows.map((a: any) => (
                  <div key={a.id} className="flex items-center gap-2 text-sm mt-1 pl-2">
                    <span className="text-gray-600">{a.assignment_type === "primary" ? "▸" : "·"} {a.profiles?.full_name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${a.competency_validated ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{a.competency_validated ? "validated" : "override"}</span>
                    <button className={`${btnGhost} ml-auto`} disabled={ui.busy} onClick={() => end(a.id)}>End</button>
                  </div>
                ))}
              </div>
            );
          })}
          {data.assignments.length > 0 && data.patients.every((p: any) => assignedFor(p.id).length === 0) && <p className="text-xs text-gray-400">Assignments exist for discharged/unlisted patients.</p>}
        </div>
      </div>
    </div>
  );
}

// ── Safety (escalations + safety alerts) ──────────────────────────────────────
function SafetyTab({ data, support, ui }: TabProps) {
  const [eLevel, setELevel] = useState("2"); const [eSummary, setESummary] = useState(""); const [ePatient, setEPatient] = useState(""); const [eResponder, setEResponder] = useState("");
  const [aCat, setACat] = useState("deterioration"); const [aSev, setASev] = useState("medium"); const [aPatient, setAPatient] = useState(""); const [aNote, setANote] = useState("");

  async function raiseEsc() {
    if (!eSummary.trim()) { ui.toast("err", "Summary required"); return; }
    ui.setBusy(true); const r = await call("POST", "/api/operations/escalations", { level: Number(eLevel), summary: eSummary, patient_id: ePatient || undefined, assigned_responder: eResponder || undefined }); ui.setBusy(false);
    if (r.ok) { setESummary(""); ui.toast("ok", "Escalation raised"); ui.refresh(); } else ui.toast("err", r.data?.error || "Failed");
  }
  async function escStatus(id: string, status: string) {
    ui.setBusy(true); const r = await call("PATCH", `/api/operations/escalations?id=${id}`, { status }); ui.setBusy(false);
    if (r.ok) ui.refresh(); else ui.toast("err", r.data?.error || "Failed");
  }
  async function raiseAlert() {
    ui.setBusy(true); const r = await call("POST", "/api/operations/safety-alerts", { category: aCat, severity: aSev, patient_id: aPatient || undefined, note: aNote }); ui.setBusy(false);
    if (r.ok) { setANote(""); ui.toast("ok", "Safety alert raised"); ui.refresh(); } else ui.toast("err", r.data?.error || "Failed");
  }
  async function resolveAlert(id: string) {
    ui.setBusy(true); const r = await call("PATCH", `/api/operations/safety-alerts?id=${id}`, {}); ui.setBusy(false);
    if (r.ok) ui.refresh(); else ui.toast("err", r.data?.error || "Failed");
  }

  return (
    <div className="grid md:grid-cols-2 gap-5">
      <div className="space-y-5">
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Raise escalation</h3>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className={label}><span className={lbl}>Level (1–5)</span><select className={input} value={eLevel} onChange={e => setELevel(e.target.value)}>{[1, 2, 3, 4, 5].map(l => <option key={l} value={l}>L{l} · {["routine", "urgent", "high", "emergency", "critical"][l - 1]}</option>)}</select></label>
              <label className={label}><span className={lbl}>Patient</span><select className={input} value={ePatient} onChange={e => setEPatient(e.target.value)}><option value="">—</option>{data.patients.map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
            </div>
            <input className={input} placeholder="Summary" value={eSummary} onChange={e => setESummary(e.target.value)} />
            <label className={label}><span className={lbl}>Assign responder</span><select className={input} value={eResponder} onChange={e => setEResponder(e.target.value)}><option value="">—</option>{support.staff.map((s: any) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label>
            <button className={btn} disabled={ui.busy} onClick={raiseEsc}>Raise escalation</button>
          </div>
        </div>
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Raise safety alert</h3>
          <div className="grid grid-cols-2 gap-2">
            <select className={input} value={aCat} onChange={e => setACat(e.target.value)}>{SAFETY_CATS.map(cat => <option key={cat} value={cat}>{pretty(cat)}</option>)}</select>
            <select className={input} value={aSev} onChange={e => setASev(e.target.value)}>{RISK.map(s => <option key={s} value={s}>sev: {s}</option>)}</select>
            <select className={input} value={aPatient} onChange={e => setAPatient(e.target.value)}><option value="">Patient (optional)…</option>{data.patients.map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
            <input className={input} placeholder="Note" value={aNote} onChange={e => setANote(e.target.value)} />
          </div>
          <button className={`${btn} mt-3`} disabled={ui.busy} onClick={raiseAlert}>Raise alert</button>
        </div>
      </div>

      <div className="space-y-5">
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Open escalations ({data.escalations.length})</h3>
          <div className="divide-y">
            {data.escalations.length === 0 && <p className="text-sm text-gray-400">None open.</p>}
            {data.escalations.map((e: any) => (
              <div key={e.id} className="py-2.5 flex items-center gap-2 text-sm">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${LEVEL_COLOR(e.level)}`}>L{e.level}</span>
                <span className="text-gray-800 truncate">{e.summary}</span>
                <span className="text-xs text-gray-400">{e.status}</span>
                <span className="ml-auto flex gap-1">
                  {e.status === "open" && <button className={btnGhost} disabled={ui.busy} onClick={() => escStatus(e.id, "acknowledged")}>Ack</button>}
                  <button className={btnGhost} disabled={ui.busy} onClick={() => escStatus(e.id, "resolved")}>Resolve</button>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Active safety alerts ({data.alerts.length})</h3>
          <div className="divide-y">
            {data.alerts.length === 0 && <p className="text-sm text-gray-400">None active.</p>}
            {data.alerts.map((a: any) => (
              <div key={a.id} className="py-2.5 flex items-center gap-2 text-sm">
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${SEV_COLOR[a.severity]}`}>{pretty(a.category)}</span>
                <span className="text-gray-600 text-xs truncate">{a.op_patients?.label ?? ""} {a.note ?? ""}</span>
                <button className={`${btnGhost} ml-auto`} disabled={ui.busy} onClick={() => resolveAlert(a.id)}>Resolve</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OperationsConsole({ ready, data, support }: { ready: boolean; data: any; support: any }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Command");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const ui: UI = { busy, setBusy, toast: (kind, text) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 6000); }, refresh: () => router.refresh() };

  if (!ready) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Clinical Operations Centre</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <p className="font-semibold text-amber-900">⚙️ One setup step remaining</p>
          <p className="text-sm text-amber-800 mt-2">The Clinical Operations Engine needs its database tables. Apply migration <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">038-clinical-operations.sql</code> in the Supabase SQL editor, then reload this page.</p>
        </div>
      </div>
    );
  }

  const props: TabProps = { data, support, ui };
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Clinical Operations Centre</h1>
        <p className="text-sm text-gray-500 mt-1">Live shift, ward, patient-assignment and safety coordination for your facility.</p>
      </div>
      {msg && <div className={`text-sm rounded-lg px-4 py-2.5 ${msg.kind === "ok" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>{msg.text}</div>}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${tab === t ? "border-teal-600 text-teal-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{t}</button>
        ))}
      </div>
      {tab === "Command" && <CommandTab {...props} />}
      {tab === "Shifts" && <ShiftsTab {...props} />}
      {tab === "Ward" && <WardTab {...props} />}
      {tab === "Assignments" && <AssignmentsTab {...props} />}
      {tab === "Safety" && <SafetyTab {...props} />}
    </div>
  );
}
