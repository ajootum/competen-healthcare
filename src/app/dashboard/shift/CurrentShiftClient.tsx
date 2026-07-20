"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// Current Shift (HWW-012) — the healthcare worker's personal operational
// dashboard. Everything shown is real op_* data; fields the operational schema
// does not hold (patient age/diagnosis, allocated break times, supervisor DMs)
// are handled honestly rather than fabricated. Actions (record observation,
// request assistance = escalation, report incident = safety alert, complete
// task) hit the existing /api/operations/* endpoints.
/* eslint-disable @typescript-eslint/no-explicit-any */

const OBS_TYPES = ["vital_signs", "neuro", "respiratory", "cardiovascular", "fluid_balance", "pain", "sedation", "pews", "gcs", "specialty"];
const SAFETY_CATS = ["fall_risk", "medication", "pressure_injury", "infection", "patient_id", "deterioration", "device", "environmental"];
const pretty = (s: string) => (s ?? "").replace(/_/g, " ");
const titleCase = (s: string) => pretty(s).split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

async function call(method: string, path: string, body?: any) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

const card = "bg-white rounded-xl border border-gray-200 p-5";
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const btn = "px-3.5 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50";
const btnGhost = "px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const RISK: Record<string, string> = { low: "bg-green-100 text-green-700", medium: "bg-amber-100 text-amber-700", high: "bg-red-100 text-red-700" };
const ACUITY: Record<string, string> = { stable: "bg-green-100 text-green-700", moderate: "bg-yellow-100 text-yellow-700", high: "bg-orange-100 text-orange-700", critical: "bg-red-100 text-red-700" };
const ewsColor = (n: number | null) => n == null ? "text-gray-400" : n >= 7 ? "text-red-600" : n >= 5 ? "text-orange-600" : n >= 3 ? "text-yellow-600" : "text-green-600";
const PRIO: Record<string, string> = { urgent: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700", normal: "bg-gray-100 text-gray-500", low: "bg-gray-100 text-gray-400" };

const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--";
const fmtDateLong = (d: string | null) => d ? new Date(d + "T00:00:00").toLocaleDateString([], { weekday: "short", day: "numeric", month: "long", year: "numeric" }) : "";
function remaining(ends: string | null, now: number) {
  if (!ends) return null;
  const ms = new Date(ends).getTime() - now;
  if (ms <= 0) return "ended";
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
  return `${h}h ${m}m`;
}

const SHIFT_REMINDERS = [
  "Perform hourly rounding",
  "Ensure hand hygiene compliance",
  "Monitor PEWS and escalate as needed",
  "Verify patient & medication before administration",
  "Document care in real time",
  "Report incidents & deterioration immediately",
];

export default function CurrentShiftClient({ ready }: { ready: boolean }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(ready);
  const [now, setNow] = useState<number>(() => Date.now());
  const [sel, setSel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 6000); };

  // record-obs form
  const [oType, setOType] = useState("vital_signs"); const [oEws, setOEws] = useState(""); const [oConcern, setOConcern] = useState(false); const [oNote, setONote] = useState("");
  // raise concern / safety
  const [showRaise, setShowRaise] = useState(false); const [eLevel, setELevel] = useState("2"); const [eSummary, setESummary] = useState("");
  const [showSafety, setShowSafety] = useState(false); const [aCat, setACat] = useState("deterioration"); const [aNote, setANote] = useState("");

  const refetch = useCallback(async () => {
    const r = await call("GET", "/api/operations/my-shift");
    setData(r.ok ? r.data : { shift: null, patients: [], tasks: [], observations: [], safetyAlerts: [], escalations: [], notifications: [] });
  }, []);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    (async () => { await refetch(); if (active) setLoading(false); })();
    // Auto-refresh every 45s (HWW-012 §9: 30–60s) and tick the countdown each minute.
    const poll = setInterval(() => { refetch(); }, 45000);
    const tick = setInterval(() => setNow(Date.now()), 60000);
    return () => { active = false; clearInterval(poll); clearInterval(tick); };
  }, [ready, refetch]);

  if (!ready) return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Current Shift</h1>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
        <p className="font-semibold text-amber-900">⚙️ Coming online</p>
        <p className="text-sm text-amber-800 mt-2">The operational shift module needs migration <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">039-clinical-observations.sql</code> applied. Check back shortly.</p>
      </div>
    </div>
  );

  const shift = data?.shift ?? null;
  const patients = data?.patients ?? [];
  const tasks = data?.tasks ?? [];
  const observations = data?.observations ?? [];
  const safetyAlerts = data?.safetyAlerts ?? [];
  const escalations = data?.escalations ?? [];
  const notifications = data?.notifications ?? [];
  const selected = patients.find((p: any) => p.op_patients.id === sel) ?? null;
  const selPatient = selected?.op_patients ?? null;
  const patientObs = (pid: string) => observations.filter((o: any) => o.patient_id === pid);
  const latestEws = (pid: string) => {
    const w = observations.filter((o: any) => o.patient_id === pid && o.ews_score != null);
    if (!w.length) return null;
    return w.sort((a: any, b: any) => new Date(b.recorded_at ?? b.created_at ?? 0).getTime() - new Date(a.recorded_at ?? a.created_at ?? 0).getTime())[0].ews_score;
  };
  const dueObs = (pid: string) => observations.filter((o: any) => o.patient_id === pid && (o.status === "due" || o.status === "overdue")).length;
  const patientAlerts = (pid: string) => safetyAlerts.filter((a: any) => a.patient_id === pid).length;

  const onDuty = !!shift && (shift.duty_status === "on_duty" || shift.status === "active");
  const shiftName = shift?.shift_type ? titleCase(shift.shift_type) + (/(shift|call)/i.test(shift.shift_type) ? "" : " Shift") : null;
  const lengthH = shift?.starts_at && shift?.ends_at ? (new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime()) / 3.6e6 : null;

  // Important Alerts — a single severity-ranked feed from real signals.
  const alertItems: { sev: "high" | "med" | "low"; label: string; note?: string | null }[] = [
    ...safetyAlerts.map((a: any) => ({ sev: (a.severity === "high" ? "high" : a.severity === "medium" ? "med" : "low") as any, label: `${titleCase(a.category)} — ${a.op_patients?.label ?? "patient"}`, note: a.note })),
    ...patients.filter((a: any) => a.op_patients.acuity_level === "critical" || a.op_patients.risk_level === "high").map((a: any) => ({ sev: (a.op_patients.acuity_level === "critical" ? "high" : "med") as any, label: `${a.op_patients.label} — ${a.op_patients.acuity_level === "critical" ? "Critical acuity" : "High clinical risk"}`, note: a.op_patients.op_beds?.label ?? null })),
    ...escalations.map((e: any) => ({ sev: (e.level >= 4 ? "high" : e.level >= 2 ? "med" : "low") as any, label: `Escalation L${e.level} — ${e.op_patients?.label ?? ""}`, note: e.summary })),
    ...observations.filter((o: any) => o.status === "overdue").map((o: any) => ({ sev: "med" as any, label: `Observation overdue — ${o.op_patients?.label ?? ""}`, note: titleCase(o.observation_type) })),
  ];
  const sevRank = { high: 0, med: 1, low: 2 };
  alertItems.sort((a, b) => sevRank[a.sev] - sevRank[b.sev]);

  async function act(fn: () => Promise<any>) { setBusy(true); const r = await fn(); setBusy(false); if (r.ok) await refetch(); return r; }
  function openPatientPanel(sub?: "obs" | "assist" | "incident") {
    const first = selPatient ? sel : patients[0]?.op_patients?.id;
    if (!first) { toast("err", "You have no assigned patients right now."); return; }
    setSel(first);
    setShowRaise(sub === "assist"); setShowSafety(sub === "incident");
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  async function recordObs() {
    if (!selPatient) return;
    const ews = oEws === "" ? undefined : Number(oEws);
    const r = await act(() => call("POST", "/api/operations/observations", { mode: "record", patient_id: selPatient.id, observation_type: oType, ews_score: ews, concern: oConcern, findings: oNote ? { note: oNote } : {} }));
    if (r.ok) { setOEws(""); setOConcern(false); setONote(""); toast(r.data?.escalation_triggered ? "err" : "ok", r.data?.escalation_triggered ? "Recorded — ⚠ deterioration auto-escalated to your coordinator." : "Observation recorded"); }
    else toast("err", r.data?.error || "Failed");
  }
  async function raiseEsc() {
    if (!selPatient || !eSummary.trim()) { toast("err", "Add a short summary"); return; }
    const r = await act(() => call("POST", "/api/operations/escalations", { level: Number(eLevel), summary: eSummary, patient_id: selPatient.id }));
    if (r.ok) { setESummary(""); setShowRaise(false); toast("ok", "Assistance requested — escalation raised"); } else toast("err", r.data?.error || "Failed");
  }
  async function raiseSafety() {
    if (!selPatient) return;
    const r = await act(() => call("POST", "/api/operations/safety-alerts", { category: aCat, severity: "medium", patient_id: selPatient.id, note: aNote }));
    if (r.ok) { setANote(""); setShowSafety(false); toast("ok", "Incident reported — safety alert raised"); } else toast("err", r.data?.error || "Failed");
  }
  async function taskAction(id: string, status: string) {
    const r = await act(() => call("PATCH", `/api/operations/tasks?id=${id}`, { status }));
    if (!r.ok) toast("err", r.data?.error || "Failed"); else toast("ok", `Task ${status.replace("_", " ")}`);
  }

  const QUICK = [
    { key: "obs",       label: "Record Observations", icon: "📝", real: true,  sub: undefined as ("obs"|"assist"|"incident"|undefined) },
    { key: "document",  label: "Document Care",       icon: "🗒️", real: true,  sub: undefined },
    { key: "medication",label: "Medication",          icon: "💊", real: false, sub: undefined },
    { key: "patient",   label: "Open Patient",        icon: "🧑‍⚕️", real: true,  sub: undefined },
    { key: "assist",    label: "Request Assistance",  icon: "🆘", real: true,  sub: "assist" as const },
    { key: "incident",  label: "Report Incident",     icon: "⚠️", real: true,  sub: "incident" as const },
  ];

  const cardHead = "flex items-center gap-2 mb-3";
  const label = "text-[11px] font-semibold text-gray-400 uppercase tracking-wider";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Current Shift</h1>
          <p className="text-sm text-gray-500 mt-1">Your live assignment and tasks for today.</p>
        </div>
        {shift && (
          <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-2.5">
            <span className="text-lg">🗓️</span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-gray-800">{fmtDateLong(shift.shift_date)}</p>
              <p className="text-xs text-gray-500">{shiftName ?? "Shift"} {shift.starts_at ? `${fmtTime(shift.starts_at)} – ${fmtTime(shift.ends_at)}` : ""}</p>
            </div>
            <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${onDuty ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{onDuty ? "On Duty" : "Off Duty"}</span>
          </div>
        )}
      </div>

      {msg && <div className={`text-sm rounded-lg px-4 py-2.5 ${msg.kind === "ok" ? "bg-green-50 text-green-800 border border-green-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>{msg.text}</div>}

      {loading && <div className={card}><p className="text-sm text-gray-400">Loading your shift…</p></div>}

      {!loading && !shift && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <p className="font-semibold text-gray-800">You are not currently deployed on an active shift.</p>
          <p className="text-sm text-gray-500 mt-1">When your supervisor rosters you onto a shift in the Shift Operations Centre, your unit, supervisor and break details will appear here. Any patients or tasks already assigned to you are shown below.</p>
        </div>
      )}

      {/* Row 1 — Shift context cards */}
      {shift && (
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* Today's Roster */}
          <div className={card}>
            <div className={cardHead}><span className="text-lg">🗓️</span><span className={label}>Today&apos;s Roster</span></div>
            <p className="text-sm text-gray-500">{shiftName ?? "Shift"}</p>
            <p className="text-xl font-bold text-gray-900 tabular-nums mt-0.5">{shift.starts_at ? `${fmtTime(shift.starts_at)} – ${fmtTime(shift.ends_at)}` : "—"}</p>
            {shift.ends_at && <p className="text-xs text-gray-500 mt-1">⏱ {remaining(shift.ends_at, now)} remaining</p>}
            <span className={`inline-block mt-2 text-[11px] font-semibold px-2 py-0.5 rounded-full ${onDuty ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{onDuty ? "On Duty" : "Off Duty"}</span>
          </div>

          {/* Assigned Unit */}
          <div className={card}>
            <div className={cardHead}><span className="text-lg">🏥</span><span className={label}>Assigned Unit</span></div>
            <p className="text-lg font-bold text-gray-900 leading-tight">{shift.unit ?? shift.department ?? "Unit"}</p>
            {shift.department && shift.unit && <p className="text-sm text-gray-500 mt-0.5">{shift.department}</p>}
            {shift.hospital && <p className="text-xs text-gray-400 mt-1">{shift.hospital}</p>}
          </div>

          {/* Supervisor */}
          <div className={card}>
            <div className={cardHead}><span className="text-lg">🧑‍✈️</span><span className={label}>Supervisor</span></div>
            {shift.supervisor ? (
              <>
                <p className="text-base font-bold text-gray-900 leading-tight">{shift.supervisor}</p>
                <p className="text-xs text-gray-500 mt-0.5">Shift Supervisor</p>
                <button className={`${btnGhost} mt-3`} onClick={() => openPatientPanel("assist")}>🆘 Request assistance</button>
              </>
            ) : (
              <p className="text-sm text-gray-400">No supervisor assigned to this shift yet.</p>
            )}
          </div>

          {/* Breaks — honest: entitlement guidance, not fabricated allocated times */}
          <div className={card}>
            <div className={cardHead}><span className="text-lg">☕</span><span className={label}>Breaks</span></div>
            {lengthH && lengthH >= 6 ? (
              <ul className="text-sm text-gray-600 space-y-0.5">
                <li>1× 30-min meal break</li>
                <li>2× 15-min rest breaks</li>
              </ul>
            ) : (
              <p className="text-sm text-gray-600">1× 15-min rest break</p>
            )}
            <p className="text-[11px] text-gray-400 mt-2">Entitlement for this shift length. Exact break times are coordinated on the ward by your supervisor.</p>
          </div>
        </div>
      )}

      {/* Row 2 — Patients / Tasks / Messages */}
      <div className="grid lg:grid-cols-3 gap-5">
        {/* Assigned Patients */}
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">👥 Assigned Patients <span className="text-gray-400 font-normal">({patients.length})</span></h3>
          </div>
          {patients.length === 0 ? (
            <p className="text-sm text-gray-400">No patients assigned. Your coordinator allocates patients in the Clinical Operations Centre.</p>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    <th className="py-1.5 pr-2 font-medium">Patient</th>
                    <th className="py-1.5 px-1 font-medium">Bed</th>
                    <th className="py-1.5 px-1 font-medium">PEWS</th>
                    <th className="py-1.5 px-1 font-medium">Risk</th>
                    <th className="py-1.5 pl-1 font-medium">Alerts</th>
                  </tr>
                </thead>
                <tbody>
                  {patients.map((a: any) => {
                    const p = a.op_patients; const ews = latestEws(p.id); const due = dueObs(p.id); const al = patientAlerts(p.id);
                    return (
                      <tr key={p.id} onClick={() => { setSel(p.id); setShowRaise(false); setShowSafety(false); setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }}
                        className={`border-b border-gray-50 cursor-pointer transition-colors ${sel === p.id ? "bg-teal-50/60" : "hover:bg-gray-50"}`}>
                        <td className="py-2 pr-2">
                          <span className="font-medium text-gray-800">{p.label}</span>
                          {a.assignment_type === "primary" && <span className="ml-1.5 text-[9px] text-teal-600 uppercase">primary</span>}
                        </td>
                        <td className="py-2 px-1 text-gray-500">{p.op_beds?.label ?? "—"}</td>
                        <td className={`py-2 px-1 font-semibold tabular-nums ${ewsColor(ews)}`}>{ews ?? "—"}{due > 0 && <span className="ml-1 text-[9px] text-orange-500 font-normal">{due} due</span>}</td>
                        <td className="py-2 px-1"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${RISK[p.risk_level] ?? RISK.low}`}>{titleCase(p.risk_level)}</span></td>
                        <td className="py-2 pl-1">
                          {p.isolation_status !== "none" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 mr-1">{titleCase(p.isolation_status)}</span>}
                          {al > 0 ? <span className="text-red-500">●</span> : (p.isolation_status === "none" ? <span className="text-gray-300">—</span> : null)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-[10px] text-gray-400 mt-2 flex items-center gap-3">
                <span>High: {patients.filter((a: any) => a.op_patients.risk_level === "high").length}</span>
                <span>Medium: {patients.filter((a: any) => a.op_patients.risk_level === "medium").length}</span>
                <span>Low: {patients.filter((a: any) => a.op_patients.risk_level === "low").length}</span>
              </p>
              <p className="text-[10px] text-gray-400 mt-1">Age &amp; diagnosis are held in the clinical record, not the operational roster. Select a patient to record care.</p>
            </div>
          )}
        </div>

        {/* Outstanding Tasks */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">✅ Outstanding Tasks <span className="text-gray-400 font-normal">({tasks.length})</span></h3>
          <div className="divide-y divide-gray-50">
            {tasks.length === 0 && <p className="text-sm text-gray-400">No open tasks. Tasks are assigned by your supervisor, care plans and medication schedules.</p>}
            {tasks.map((t: any) => (
              <div key={t.id} className="py-2 flex items-start gap-2 text-sm">
                <span className="text-xs text-gray-500 tabular-nums w-11 shrink-0 mt-0.5">{t.due_at ? fmtTime(t.due_at) : "--:--"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-gray-800 leading-tight">{t.description}</p>
                  <p className="text-[11px] text-gray-400">{t.op_patients?.label ? `${t.op_patients.label} · ` : ""}{pretty(t.status)}</p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${PRIO[t.priority] ?? PRIO.normal}`}>{titleCase(t.priority)}</span>
                {t.status !== "completed" && <button className={btnGhost} disabled={busy} onClick={() => taskAction(t.id, "completed")}>Done</button>}
              </div>
            ))}
          </div>
        </div>

        {/* Messages & Notifications (real notifications feed) */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">💬 Messages &amp; Notifications <span className="text-gray-400 font-normal">({notifications.length})</span></h3>
          <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
            {notifications.length === 0 && <p className="text-sm text-gray-400">No new messages. Supervisor updates and system alerts arrive here.</p>}
            {notifications.map((n: any) => (
              <div key={n.id} className="py-2.5">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-800 truncate">{n.title}</p>
                  {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0" />}
                  <span className="ml-auto text-[10px] text-gray-400 shrink-0">{n.created_at ? new Date(n.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : ""}</span>
                </div>
                {n.body && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 3 — Reminders / Quick Actions / Important Alerts */}
      <div className="grid lg:grid-cols-3 gap-5">
        {/* Shift Reminders */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">🔔 Shift Reminders</h3>
          <ul className="space-y-2">
            {SHIFT_REMINDERS.map(r => (
              <li key={r} className="flex items-start gap-2 text-sm text-gray-600"><span className="text-teal-500 mt-0.5">✓</span>{r}</li>
            ))}
          </ul>
        </div>

        {/* Quick Actions */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">⚡ Quick Actions</h3>
          <div className="grid grid-cols-3 gap-2">
            {QUICK.map(q => q.real ? (
              <button key={q.key} onClick={() => openPatientPanel(q.sub)}
                className="flex flex-col items-center gap-1.5 rounded-lg border border-gray-200 hover:border-teal-300 hover:bg-teal-50/40 py-3 px-1 text-center transition-colors">
                <span className="text-xl">{q.icon}</span>
                <span className="text-[11px] text-gray-600 leading-tight">{q.label}</span>
              </button>
            ) : (
              <div key={q.key} title="Medication administration module — coming soon"
                className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-gray-200 py-3 px-1 text-center opacity-60 cursor-default">
                <span className="text-xl grayscale">{q.icon}</span>
                <span className="text-[11px] text-gray-400 leading-tight">{q.label}</span>
                <span className="text-[8px] font-bold uppercase tracking-wider bg-gray-100 text-gray-400 rounded px-1">soon</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Actions apply to your selected patient. Nurses complete assigned tasks and document care; rosters and staffing are managed by the Shift Supervisor.</p>
        </div>

        {/* Important Alerts */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">⚠️ Important Alerts <span className="text-gray-400 font-normal">({alertItems.length})</span></h3>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {alertItems.length === 0 && <p className="text-sm text-gray-400">No active alerts for your patients.</p>}
            {alertItems.slice(0, 12).map((a, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${a.sev === "high" ? "bg-red-500" : a.sev === "med" ? "bg-amber-500" : "bg-gray-300"}`} />
                <div className="min-w-0">
                  <p className="text-gray-700 leading-tight">{a.label}</p>
                  {a.note && <p className="text-[11px] text-gray-400 truncate">{a.note}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Selected-patient action panel — record observation / request assistance / report incident */}
      {selPatient && (
        <div ref={panelRef} className={card}>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h3 className="font-semibold text-gray-900">{selPatient.label}</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${ACUITY[selPatient.acuity_level] ?? ACUITY.stable}`}>{titleCase(selPatient.acuity_level)}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${RISK[selPatient.risk_level] ?? RISK.low}`}>{titleCase(selPatient.risk_level)} risk</span>
            <span className="text-xs text-gray-400">{selPatient.op_beds?.label ?? "no bed"}{selPatient.isolation_status !== "none" ? ` · ${titleCase(selPatient.isolation_status)} isolation` : ""}</span>
            <span className="ml-auto flex gap-1">
              <button className={btnGhost} onClick={() => { setShowRaise(!showRaise); setShowSafety(false); }}>🆘 Request assistance</button>
              <button className={btnGhost} onClick={() => { setShowSafety(!showSafety); setShowRaise(false); }}>⚠️ Report incident</button>
              <button className={btnGhost} onClick={() => setSel("")}>Close</button>
            </span>
          </div>

          {showRaise && (
            <div className="bg-red-50/50 border border-red-100 rounded-lg p-3 mb-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                <select className={`${input} sm:w-48`} value={eLevel} onChange={e => setELevel(e.target.value)}>{[1, 2, 3, 4, 5].map(l => <option key={l} value={l}>L{l} · {["routine", "urgent", "high", "emergency", "critical"][l - 1]}</option>)}</select>
                <input className={`${input} flex-1`} placeholder="What do you need help with?" value={eSummary} onChange={e => setESummary(e.target.value)} />
              </div>
              <button className={btn} disabled={busy} onClick={raiseEsc}>Send request</button>
            </div>
          )}
          {showSafety && (
            <div className="bg-orange-50/50 border border-orange-100 rounded-lg p-3 mb-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                <select className={`${input} sm:w-48`} value={aCat} onChange={e => setACat(e.target.value)}>{SAFETY_CATS.map(cat => <option key={cat} value={cat}>{titleCase(cat)}</option>)}</select>
                <input className={`${input} flex-1`} placeholder="Note (optional)" value={aNote} onChange={e => setANote(e.target.value)} />
              </div>
              <button className={btn} disabled={busy} onClick={raiseSafety}>Report incident</button>
            </div>
          )}

          <h4 className="text-sm font-medium text-gray-700 mb-2">Record observation</h4>
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="text-sm"><span className="text-gray-600 text-xs">Type</span><select className={input} value={oType} onChange={e => setOType(e.target.value)}>{OBS_TYPES.map(t => <option key={t} value={t}>{titleCase(t)}</option>)}</select></label>
            <label className="text-sm"><span className="text-gray-600 text-xs">PEWS / EWS score (0–20)</span><input type="number" min={0} max={20} className={input} value={oEws} onChange={e => setOEws(e.target.value)} /></label>
          </div>
          <input className={`${input} mt-2`} placeholder="Findings note (e.g. RR 22, SpO2 94%)" value={oNote} onChange={e => setONote(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-gray-600 mt-2"><input type="checkbox" checked={oConcern} onChange={e => setOConcern(e.target.checked)} /> Cause for concern (auto-escalates)</label>
          <button className={`${btn} mt-3`} disabled={busy} onClick={recordObs}>Record observation</button>
          <p className="text-xs text-gray-400 mt-2">A PEWS ≥ 5 or a concern flag automatically raises an escalation to your coordinator.</p>

          <div className="mt-5 pt-4 border-t border-gray-100">
            <h4 className="font-semibold text-gray-900 mb-2 text-sm">Observation history</h4>
            <div className="divide-y divide-gray-50">
              {patientObs(selPatient.id).length === 0 && <p className="text-sm text-gray-400">No observations recorded yet.</p>}
              {patientObs(selPatient.id).map((o: any) => (
                <div key={o.id} className="py-2 flex items-center gap-2 text-sm">
                  <span className="text-gray-700">{titleCase(o.observation_type)}</span>
                  {o.ews_score != null && <span className={`font-medium ${ewsColor(o.ews_score)}`}>PEWS {o.ews_score}</span>}
                  {o.escalation_triggered && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">escalated</span>}
                  <span className="ml-auto text-xs text-gray-400">{o.status === "due" ? "due" : o.recorded_at ? new Date(o.recorded_at).toLocaleString() : ""}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <p className="text-center text-[11px] text-gray-400 pt-1">All times are local to your timezone · Data refreshes automatically every 45 seconds</p>
    </div>
  );
}
