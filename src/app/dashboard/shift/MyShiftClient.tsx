"use client";

import { useState, useEffect, useCallback } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

const OBS_TYPES = ["vital_signs", "neuro", "respiratory", "cardiovascular", "fluid_balance", "pain", "sedation", "pews", "gcs", "specialty"];
const SAFETY_CATS = ["fall_risk", "medication", "pressure_injury", "infection", "patient_id", "deterioration", "device", "environmental"];
const pretty = (s: string) => (s ?? "").replace(/_/g, " ");

async function call(method: string, path: string, body?: any) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

const card = "bg-white rounded-xl border border-gray-200 p-5";
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const btn = "px-3.5 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50";
const btnGhost = "px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const ACUITY_COLOR: Record<string, string> = { stable: "bg-green-100 text-green-700", moderate: "bg-yellow-100 text-yellow-700", high: "bg-orange-100 text-orange-700", critical: "bg-red-100 text-red-700" };
const ewsColor = (n: number | null) => n == null ? "text-gray-400" : n >= 7 ? "text-red-600" : n >= 5 ? "text-orange-600" : n >= 3 ? "text-yellow-600" : "text-green-600";

export default function MyShiftClient({ ready }: { ready: boolean }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(ready);
  const [sel, setSel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 6000); };

  // record-obs form
  const [oType, setOType] = useState("vital_signs"); const [oEws, setOEws] = useState(""); const [oConcern, setOConcern] = useState(false); const [oNote, setONote] = useState("");
  // raise concern
  const [showRaise, setShowRaise] = useState(false); const [eLevel, setELevel] = useState("2"); const [eSummary, setESummary] = useState("");
  const [showSafety, setShowSafety] = useState(false); const [aCat, setACat] = useState("deterioration"); const [aNote, setANote] = useState("");
  // log task
  const [taskDesc, setTaskDesc] = useState("");

  const refetch = useCallback(async () => {
    const r = await call("GET", "/api/operations/my-shift");
    setData(r.ok ? r.data : { shift: null, patients: [], tasks: [], observations: [] });
  }, []);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    (async () => { await refetch(); if (active) setLoading(false); })();
    return () => { active = false; };
  }, [ready, refetch]);

  if (!ready) return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">My Shift</h1>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
        <p className="font-semibold text-amber-900">⚙️ Coming online</p>
        <p className="text-sm text-amber-800 mt-2">The operational shift module needs migration <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">039-clinical-observations.sql</code> applied. Check back shortly.</p>
      </div>
    </div>
  );

  const patients = data?.patients ?? [];
  const tasks = data?.tasks ?? [];
  const observations = data?.observations ?? [];
  const selected = patients.find((p: any) => p.op_patients.id === sel) ?? null;
  const selPatient = selected?.op_patients ?? null;
  const patientObs = (pid: string) => observations.filter((o: any) => o.patient_id === pid);

  async function act(fn: () => Promise<any>) { setBusy(true); const r = await fn(); setBusy(false); if (r.ok) await refetch(); return r; }

  async function recordObs() {
    if (!selPatient) return;
    const ews = oEws === "" ? undefined : Number(oEws);
    const r = await act(() => call("POST", "/api/operations/observations", { mode: "record", patient_id: selPatient.id, observation_type: oType, ews_score: ews, concern: oConcern, findings: oNote ? { note: oNote } : {} }));
    if (r.ok) {
      setOEws(""); setOConcern(false); setONote("");
      toast(r.data?.escalation_triggered ? "err" : "ok", r.data?.escalation_triggered ? "Recorded — ⚠ deterioration auto-escalated to your coordinator." : "Observation recorded");
    } else toast("err", r.data?.error || "Failed");
  }
  async function raiseEsc() {
    if (!selPatient || !eSummary.trim()) { toast("err", "Add a summary"); return; }
    const r = await act(() => call("POST", "/api/operations/escalations", { level: Number(eLevel), summary: eSummary, patient_id: selPatient.id }));
    if (r.ok) { setESummary(""); setShowRaise(false); toast("ok", "Escalation raised"); } else toast("err", r.data?.error || "Failed");
  }
  async function raiseSafety() {
    if (!selPatient) return;
    const r = await act(() => call("POST", "/api/operations/safety-alerts", { category: aCat, severity: "medium", patient_id: selPatient.id, note: aNote }));
    if (r.ok) { setANote(""); setShowSafety(false); toast("ok", "Safety alert raised"); } else toast("err", r.data?.error || "Failed");
  }
  async function taskAction(id: string, status: string) {
    const r = await act(() => call("PATCH", `/api/operations/tasks?id=${id}`, { status }));
    if (!r.ok) toast("err", r.data?.error || "Failed"); else toast("ok", `Task ${status.replace("_", " ")}`);
  }
  async function logTask() {
    if (!taskDesc.trim()) return;
    const r = await act(() => call("POST", "/api/operations/tasks", { description: taskDesc, patient_id: selPatient?.id }));
    if (r.ok) { setTaskDesc(""); toast("ok", "Task logged"); } else toast("err", r.data?.error || "Failed");
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Shift</h1>
        {loading ? <p className="text-sm text-gray-400 mt-1">Loading…</p> : data?.shift
          ? <p className="text-sm text-gray-500 mt-1">On shift · <span className="font-medium text-gray-700">{data.shift.departments?.name ?? "Unit"} · {data.shift.shift_type}</span> · {data.shift.shift_date} · <span className={data.shift.status === "active" ? "text-teal-600" : "text-gray-400"}>{data.shift.status}</span></p>
          : <p className="text-sm text-gray-400 mt-1">You are not currently deployed on an active shift. Your assigned patients and tasks still appear below.</p>}
      </div>

      {msg && <div className={`text-sm rounded-lg px-4 py-2.5 ${msg.kind === "ok" ? "bg-green-50 text-green-800 border border-green-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>{msg.text}</div>}

      {!loading && patients.length === 0 && tasks.length === 0 && (
        <div className={card}><p className="text-sm text-gray-400">No assigned patients or tasks right now. When a coordinator assigns you patients or tasks in the Clinical Operations Centre, they will appear here.</p></div>
      )}

      <div className="grid md:grid-cols-5 gap-5">
        {/* Left: patients + tasks */}
        <div className="md:col-span-2 space-y-5">
          <div className={card}>
            <h3 className="font-semibold text-gray-900 mb-3">My patients ({patients.length})</h3>
            <div className="space-y-1.5">
              {patients.map((a: any) => {
                const p = a.op_patients; const obs = patientObs(p.id); const lastEws = obs.find((o: any) => o.ews_score != null)?.ews_score ?? null;
                const dueCount = obs.filter((o: any) => o.status === "due" || o.status === "overdue").length;
                return (
                  <button key={p.id} onClick={() => setSel(p.id)}
                    className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${sel === p.id ? "border-teal-500 bg-teal-50/50" : "border-gray-200 hover:border-teal-300"}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800 text-sm">{p.label}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${ACUITY_COLOR[p.acuity_level]}`}>{p.acuity_level}</span>
                      {a.assignment_type === "primary" && <span className="text-[10px] text-teal-600">primary</span>}
                      <span className="ml-auto text-xs flex items-center gap-2">
                        {lastEws != null && <span className={ewsColor(lastEws)}>EWS {lastEws}</span>}
                        {dueCount > 0 && <span className="text-orange-500">{dueCount} due</span>}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{p.op_beds?.label ?? "no bed"}{p.isolation_status !== "none" ? ` · ${p.isolation_status} isolation` : ""}</div>
                  </button>
                );
              })}
              {patients.length === 0 && <p className="text-sm text-gray-400">No patients assigned.</p>}
            </div>
          </div>

          <div className={card}>
            <h3 className="font-semibold text-gray-900 mb-3">My tasks ({tasks.length})</h3>
            <div className="divide-y">
              {tasks.map((t: any) => (
                <div key={t.id} className="py-2 flex items-start gap-2 text-sm">
                  <span className={`mt-0.5 text-[10px] px-1.5 py-0.5 rounded ${t.priority === "urgent" ? "bg-red-100 text-red-700" : t.priority === "high" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-500"}`}>{t.priority}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-800">{t.description}</p>
                    <p className="text-xs text-gray-400">{t.op_patients?.label ? `${t.op_patients.label} · ` : ""}{t.status}</p>
                  </div>
                  <span className="flex gap-1 shrink-0">
                    {t.status === "assigned" && <button className={btnGhost} disabled={busy} onClick={() => taskAction(t.id, "accepted")}>Accept</button>}
                    {(t.status === "accepted" || t.status === "assigned") && <button className={btnGhost} disabled={busy} onClick={() => taskAction(t.id, "in_progress")}>Start</button>}
                    {t.status !== "completed" && <button className={btnGhost} disabled={busy} onClick={() => taskAction(t.id, "completed")}>Done</button>}
                  </span>
                </div>
              ))}
              {tasks.length === 0 && <p className="text-sm text-gray-400">No open tasks.</p>}
            </div>
            <div className="flex gap-2 mt-3">
              <input className={input} placeholder="Log a task…" value={taskDesc} onChange={e => setTaskDesc(e.target.value)} />
              <button className={btnGhost} disabled={busy} onClick={logTask}>Add</button>
            </div>
          </div>
        </div>

        {/* Right: selected patient */}
        <div className="md:col-span-3">
          {!selPatient && <div className={card}><p className="text-sm text-gray-400">Select a patient to record observations and raise concerns.</p></div>}
          {selPatient && (
            <div className="space-y-5">
              <div className={card}>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="font-semibold text-gray-900">{selPatient.label}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${ACUITY_COLOR[selPatient.acuity_level]}`}>{selPatient.acuity_level}</span>
                  <span className="text-xs text-gray-400">{selPatient.op_beds?.label ?? "no bed"}{selPatient.isolation_status !== "none" ? ` · ${selPatient.isolation_status}` : ""}</span>
                  <span className="ml-auto flex gap-1">
                    <button className={btnGhost} onClick={() => { setShowRaise(!showRaise); setShowSafety(false); }}>⚠ Escalate</button>
                    <button className={btnGhost} onClick={() => { setShowSafety(!showSafety); setShowRaise(false); }}>Safety</button>
                  </span>
                </div>

                {showRaise && (
                  <div className="bg-red-50/50 border border-red-100 rounded-lg p-3 mb-3 space-y-2">
                    <div className="flex gap-2">
                      <select className={input} value={eLevel} onChange={e => setELevel(e.target.value)}>{[1, 2, 3, 4, 5].map(l => <option key={l} value={l}>L{l} · {["routine", "urgent", "high", "emergency", "critical"][l - 1]}</option>)}</select>
                      <input className={input} placeholder="What's the concern?" value={eSummary} onChange={e => setESummary(e.target.value)} />
                    </div>
                    <button className={btn} disabled={busy} onClick={raiseEsc}>Raise escalation</button>
                  </div>
                )}
                {showSafety && (
                  <div className="bg-orange-50/50 border border-orange-100 rounded-lg p-3 mb-3 space-y-2">
                    <div className="flex gap-2">
                      <select className={input} value={aCat} onChange={e => setACat(e.target.value)}>{SAFETY_CATS.map(cat => <option key={cat} value={cat}>{pretty(cat)}</option>)}</select>
                      <input className={input} placeholder="Note (optional)" value={aNote} onChange={e => setANote(e.target.value)} />
                    </div>
                    <button className={btn} disabled={busy} onClick={raiseSafety}>Raise safety alert</button>
                  </div>
                )}

                <h4 className="text-sm font-medium text-gray-700 mb-2">Record observation</h4>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-sm"><span className="text-gray-600 text-xs">Type</span><select className={input} value={oType} onChange={e => setOType(e.target.value)}>{OBS_TYPES.map(t => <option key={t} value={t}>{pretty(t)}</option>)}</select></label>
                  <label className="text-sm"><span className="text-gray-600 text-xs">EWS score (0–20)</span><input type="number" min={0} max={20} className={input} value={oEws} onChange={e => setOEws(e.target.value)} /></label>
                </div>
                <input className={`${input} mt-2`} placeholder="Findings note (e.g. RR 22, SpO2 94%)" value={oNote} onChange={e => setONote(e.target.value)} />
                <label className="flex items-center gap-2 text-sm text-gray-600 mt-2"><input type="checkbox" checked={oConcern} onChange={e => setOConcern(e.target.checked)} /> Cause for concern (auto-escalates)</label>
                <button className={`${btn} mt-3`} disabled={busy} onClick={recordObs}>Record observation</button>
                <p className="text-xs text-gray-400 mt-2">An EWS ≥ 5 or a concern flag automatically raises an escalation to your coordinator.</p>
              </div>

              <div className={card}>
                <h4 className="font-semibold text-gray-900 mb-3">Observation history</h4>
                <div className="divide-y">
                  {patientObs(selPatient.id).length === 0 && <p className="text-sm text-gray-400">No observations recorded yet.</p>}
                  {patientObs(selPatient.id).map((o: any) => (
                    <div key={o.id} className="py-2 flex items-center gap-2 text-sm">
                      <span className="text-gray-700">{pretty(o.observation_type)}</span>
                      {o.ews_score != null && <span className={`font-medium ${ewsColor(o.ews_score)}`}>EWS {o.ews_score}</span>}
                      {o.escalation_triggered && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">escalated</span>}
                      <span className="ml-auto text-xs text-gray-400">{o.status === "due" ? "due" : o.recorded_at ? new Date(o.recorded_at).toLocaleString() : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
