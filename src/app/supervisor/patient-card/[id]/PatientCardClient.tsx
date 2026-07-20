"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Patient Card client (SSW-PO-001 §4) — header + operational actions + tabbed
// record (Overview / Timeline / Notes / Tasks / Alerts). Every write goes through
// the existing /api/operations/* endpoints and then router.refresh() re-pulls the
// server component, so the card never holds stale local copies of the record.
/* eslint-disable @typescript-eslint/no-explicit-any */

const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const fmtT = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const tc = (s: string) => (s ?? "").replace(/_/g, " ").split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const ewsColor = (n: number | null) => n == null ? "text-gray-400" : n >= 7 ? "text-red-600" : n >= 5 ? "text-orange-600" : n >= 3 ? "text-yellow-600" : "text-green-600";
const STAGES = ["expected_admission", "awaiting_bed", "admitted", "in_care", "assessment", "treatment", "theatre", "recovery", "transfer_pending", "discharge_ready", "discharged"];
const STATUSES = ["expected", "admitted", "transfer_pending", "discharge_pending", "discharged"];
const SAFETY_CATS = ["deterioration", "fall_risk", "pressure_injury", "medication", "infection", "device", "environmental", "patient_id"];
const ACUITY_TONE: Record<string, string> = { stable: "bg-green-100 text-green-700", moderate: "bg-yellow-100 text-yellow-700", high: "bg-orange-100 text-orange-700", critical: "bg-red-100 text-red-700" };

const card = "bg-white rounded-xl border border-gray-200 p-5";
const input = "w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const btn = "px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50";
const chip = "text-[11px] font-medium px-2 py-0.5 rounded-full";

async function call(method: string, path: string, body?: any) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

function Row({ k, v }: { k: string; v: any }) {
  return <div className="flex items-center justify-between py-1.5 border-b border-gray-50 text-sm"><span className="text-gray-500">{k}</span><span className="text-gray-800 font-medium text-right">{v ?? "—"}</span></div>;
}
function Tab({ active, onClick, label, n }: { active: boolean; onClick: () => void; label: string; n?: number }) {
  return <button onClick={onClick} className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${active ? "border-teal-600 text-teal-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{label}{n != null && <span className="ml-1 text-[10px] text-gray-400">{n}</span>}</button>;
}

export default function PatientCardClient(props: any) {
  const { patient, nurse, latestEws, pewsTrend, lastObs, nextReview, notes, movement, tasks, alerts, escalations, canEdit } = props;
  const router = useRouter();
  const [tab, setTab] = useState<"overview" | "timeline" | "notes" | "tasks" | "alerts">("overview");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 4000); };
  const [note, setNote] = useState(""); const [taskDesc, setTaskDesc] = useState(""); const [taskPrio, setTaskPrio] = useState("normal");
  const [escLevel, setEscLevel] = useState("2"); const [escSummary, setEscSummary] = useState("");
  const [alCat, setAlCat] = useState("deterioration"); const [alNote, setAlNote] = useState("");
  const pid = patient.id;

  async function act(fn: () => Promise<any>, okText: string) {
    setBusy(true); const r = await fn(); setBusy(false);
    if (r.ok) { toast("ok", okText); router.refresh(); } else toast("err", r.data?.error || "Failed");
    return r.ok;
  }
  const setField = (field: string, value: string) => act(() => call("PATCH", `/api/operations/patients?id=${pid}`, { [field]: value }), "Updated");
  const highRisk = patient.acuity === "critical" || patient.acuity === "high" || patient.risk === "high" || (latestEws != null && latestEws >= 5);

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/supervisor/patient-list" className="text-sm text-teal-600 hover:underline">← Patient Census</Link>

      {/* Header */}
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900">{patient.label}</h1>
              {highRisk && <span className={`${chip} bg-red-100 text-red-700`}>⚠ High risk</span>}
              <span className={`${chip} ${ACUITY_TONE[patient.acuity] ?? "bg-gray-100 text-gray-600"}`}>{tc(patient.acuity)}</span>
              {patient.stage && <span className={`${chip} bg-teal-100 text-teal-700`}>{tc(patient.stage)}</span>}
              {patient.isolation && patient.isolation !== "none" && <span className={`${chip} bg-purple-100 text-purple-700`}>{tc(patient.isolation)} isolation</span>}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {[patient.bed ?? "no bed", patient.unit, patient.age != null ? `${patient.age}y` : null, patient.diagnosis].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="text-gray-500">PEWS <span className={`font-bold tabular-nums ${ewsColor(latestEws)}`}>{latestEws ?? "—"}</span></p>
            <p className="text-gray-500">Nurse <span className="text-gray-800 font-medium">{nurse ?? "Unassigned"}</span></p>
            <p className="text-gray-500">Consultant <span className="text-gray-800 font-medium">{patient.consultant ?? "—"}</span></p>
          </div>
        </div>
      </div>

      {msg && <div className={`text-sm rounded-lg px-4 py-2.5 ${msg.kind === "ok" ? "bg-green-50 text-green-800 border border-green-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>{msg.text}</div>}

      {/* Operational actions */}
      {canEdit && (
        <div className={card}>
          <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Operational actions</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="text-xs text-gray-500">Stage<select disabled={busy} className={input} value={patient.stage ?? ""} onChange={e => setField("current_stage", e.target.value)}><option value="" disabled>Set stage…</option>{STAGES.map(s => <option key={s} value={s}>{tc(s)}</option>)}</select></label>
            <label className="text-xs text-gray-500">Operational status<select disabled={busy} className={input} value={patient.opStatus} onChange={e => setField("operational_status", e.target.value)}>{STATUSES.map(s => <option key={s} value={s}>{tc(s)}</option>)}</select></label>
            <label className="text-xs text-gray-500">Acuity<select disabled={busy} className={input} value={patient.acuity} onChange={e => setField("acuity_level", e.target.value)}>{["stable", "moderate", "high", "critical"].map(s => <option key={s} value={s}>{tc(s)}</option>)}</select></label>
            <div className="flex items-end gap-2 lg:col-span-2">
              <Link href="/supervisor/patient-flow" className="text-xs text-teal-700 hover:underline">Transfer / discharge in Patient Flow →</Link>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className={card + " p-0"}>
        <div className="flex gap-1 px-4 border-b border-gray-100 overflow-x-auto">
          <Tab active={tab === "overview"} onClick={() => setTab("overview")} label="Overview" />
          <Tab active={tab === "timeline"} onClick={() => setTab("timeline")} label="Timeline" n={movement.length} />
          <Tab active={tab === "notes"} onClick={() => setTab("notes")} label="Notes" n={notes.length} />
          <Tab active={tab === "tasks"} onClick={() => setTab("tasks")} label="Tasks" n={tasks.length} />
          <Tab active={tab === "alerts"} onClick={() => setTab("alerts")} label="Alerts" n={alerts.length + escalations.length} />
        </div>
        <div className="p-5">
          {tab === "overview" && (
            <div className="grid sm:grid-cols-2 gap-x-8">
              <div>
                <Row k="Operational status" v={tc(patient.opStatus)} />
                <Row k="Current stage" v={patient.stage ? tc(patient.stage) : "—"} />
                <Row k="Acuity" v={tc(patient.acuity)} />
                <Row k="Latest PEWS" v={<span className={ewsColor(latestEws)}>{latestEws ?? "—"}</span>} />
                <Row k="Risk level" v={tc(patient.risk)} />
              </div>
              <div>
                <Row k="Assigned nurse" v={nurse ?? "Unassigned"} />
                <Row k="Consultant" v={patient.consultant} />
                <Row k="Bed" v={patient.bed} />
                <Row k="Last observation" v={fmt(lastObs)} />
                <Row k="Next review" v={fmt(nextReview)} />
              </div>
              {pewsTrend.length > 1 && (
                <div className="sm:col-span-2 mt-4">
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">PEWS trend</p>
                  <svg width={pewsTrend.length * 22} height={40} className={ewsColor(latestEws)}>
                    {pewsTrend.map((v: number, i: number) => { const h = Math.max(2, (v / Math.max(...pewsTrend, 8)) * 34); return <rect key={i} x={i * 22 + 2} y={38 - h} width={16} height={h} rx={2} fill="currentColor" opacity={i === pewsTrend.length - 1 ? 1 : 0.4} />; })}
                  </svg>
                </div>
              )}
            </div>
          )}

          {tab === "timeline" && (
            <div className="space-y-2">
              {movement.length === 0 && <p className="text-sm text-gray-400">No movement events recorded{" "}<span className="text-gray-300">(needs migration 050)</span>.</p>}
              {movement.map((m: any) => (
                <div key={m.id} className="flex items-start gap-2.5 text-sm">
                  <span className="text-xs text-gray-400 tabular-nums w-24 shrink-0">{fmt(m.created_at)}</span>
                  <span className="w-2 h-2 rounded-full bg-teal-500 mt-1.5 shrink-0" />
                  <span className="min-w-0"><span className="font-medium text-gray-800">{tc(m.event_type)}</span>{m.detail ? <span className="text-gray-500"> — {m.detail}</span> : null}{m.profiles?.full_name ? <span className="text-[11px] text-gray-400"> · {m.profiles.full_name}</span> : null}</span>
                </div>
              ))}
            </div>
          )}

          {tab === "notes" && (
            <div className="space-y-3">
              {canEdit && (
                <div className="flex gap-2">
                  <input className={input} placeholder="Add operational note (e.g. Awaiting CT scan)…" value={note} onChange={e => setNote(e.target.value)} />
                  <button className={btn} disabled={busy || !note.trim()} onClick={async () => { if (await act(() => call("POST", "/api/operations/notes", { patient_id: pid, note }), "Note added")) setNote(""); }}>Add</button>
                </div>
              )}
              {notes.length === 0 && <p className="text-sm text-gray-400">No operational notes{" "}<span className="text-gray-300">(needs migration 050)</span>.</p>}
              {notes.map((n: any) => (
                <div key={n.id} className="border-b border-gray-50 py-2">
                  <p className="text-sm text-gray-800">{n.note}</p>
                  <p className="text-[11px] text-gray-400">{n.profiles?.full_name ?? "Staff"} · {fmt(n.created_at)}</p>
                </div>
              ))}
            </div>
          )}

          {tab === "tasks" && (
            <div className="space-y-3">
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <input className={`${input} flex-1 min-w-[10rem]`} placeholder="New patient task…" value={taskDesc} onChange={e => setTaskDesc(e.target.value)} />
                  <select className={`${input} w-28`} value={taskPrio} onChange={e => setTaskPrio(e.target.value)}>{["low", "normal", "high", "urgent"].map(p => <option key={p} value={p}>{tc(p)}</option>)}</select>
                  <button className={btn} disabled={busy || !taskDesc.trim()} onClick={async () => { if (await act(() => call("POST", "/api/operations/tasks", { description: taskDesc, patient_id: pid, priority: taskPrio }), "Task added")) setTaskDesc(""); }}>Add</button>
                </div>
              )}
              {tasks.length === 0 && <p className="text-sm text-gray-400">No open tasks.</p>}
              {tasks.map((t: any) => (
                <div key={t.id} className="flex items-center gap-2 border-b border-gray-50 py-2 text-sm">
                  <span className={`${chip} ${t.priority === "urgent" ? "bg-red-100 text-red-700" : t.priority === "high" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-500"}`}>{tc(t.priority)}</span>
                  <span className="flex-1 text-gray-800">{t.description}</span>
                  <span className="text-xs text-gray-400 tabular-nums">{t.due_at ? fmtT(t.due_at) : ""}</span>
                  <span className="text-[11px] text-gray-400">{tc(t.status)}</span>
                </div>
              ))}
            </div>
          )}

          {tab === "alerts" && (
            <div className="space-y-3">
              {canEdit && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="flex gap-2">
                    <select className={`${input} w-40`} value={alCat} onChange={e => setAlCat(e.target.value)}>{SAFETY_CATS.map(cat => <option key={cat} value={cat}>{tc(cat)}</option>)}</select>
                    <input className={input} placeholder="Alert note (optional)" value={alNote} onChange={e => setAlNote(e.target.value)} />
                    <button className={btn} disabled={busy} onClick={async () => { if (await act(() => call("POST", "/api/operations/safety-alerts", { category: alCat, severity: "medium", patient_id: pid, note: alNote }), "Safety alert added")) setAlNote(""); }}>Flag</button>
                  </div>
                  <div className="flex gap-2">
                    <select className={`${input} w-40`} value={escLevel} onChange={e => setEscLevel(e.target.value)}>{[1, 2, 3, 4, 5].map(l => <option key={l} value={l}>L{l} · {["routine", "urgent", "high", "emergency", "critical"][l - 1]}</option>)}</select>
                    <input className={input} placeholder="Escalation summary" value={escSummary} onChange={e => setEscSummary(e.target.value)} />
                    <button className={btn} disabled={busy || !escSummary.trim()} onClick={async () => { if (await act(() => call("POST", "/api/operations/escalations", { level: Number(escLevel), summary: escSummary, patient_id: pid }), "Escalation raised")) setEscSummary(""); }}>Escalate</button>
                  </div>
                </div>
              )}
              {alerts.length === 0 && escalations.length === 0 && <p className="text-sm text-gray-400">No active alerts or escalations.</p>}
              {escalations.map((e: any) => (
                <div key={e.id} className="flex items-center gap-2 border-b border-gray-50 py-2 text-sm">
                  <span className={`${chip} bg-red-100 text-red-700`}>Escalation L{e.level}</span>
                  <span className="flex-1 text-gray-800">{e.summary}</span>
                  <span className="text-[11px] text-gray-400">{tc(e.status)} · {fmt(e.created_at)}</span>
                </div>
              ))}
              {alerts.map((a: any) => (
                <div key={a.id} className="flex items-center gap-2 border-b border-gray-50 py-2 text-sm">
                  <span className={`${chip} ${a.severity === "high" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>{tc(a.category)}</span>
                  <span className="flex-1 text-gray-700">{a.note ?? tc(a.category)}</span>
                  <span className="text-[11px] text-gray-400">{a.active ? "active" : "resolved"} · {fmt(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
