"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { INCIDENT_TYPES, QUALITY_TYPES, QUALITY_TYPE_LABEL } from "@/lib/operations/quality-safety";

// Safety console (SSW-QSE-001) — report an incident/near-miss or create a quality
// action (CAPA / audit / PDSA / RCA / improvement project / policy review).
// Writes through the audited incidents / quality-actions APIs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const SEV = ["low", "medium", "high", "critical"];
const PRIO = ["low", "medium", "high"];

export default function SafetyConsole({ incidentsProvisioned, qaProvisioned }: { incidentsProvisioned: boolean; qaProvisioned: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"incident" | "capa">("incident");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [inc, setInc] = useState({ incident_type: "medication", severity: "medium", near_miss: false, description: "" });
  const [qa, setQa] = useState({ action_type: "capa", title: "", priority: "medium", description: "", due_hours: "" });

  async function post(url: string, payload: any, reset: () => void, label: string) {
    setBusy(true); setErr(null); setOk(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); return; }
      reset(); setOk(label); router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(false); }
  }
  const sel = "text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white";
  const gated = (tab === "incident" && !incidentsProvisioned) || (tab === "capa" && !qaProvisioned);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => { setTab("incident"); setOk(null); setErr(null); }} className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${tab === "incident" ? "bg-rose-600 text-white" : "bg-gray-50 text-gray-600 border border-gray-200"}`}>🚩 Report Incident</button>
        <button onClick={() => { setTab("capa"); setOk(null); setErr(null); }} className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${tab === "capa" ? "bg-teal-600 text-white" : "bg-gray-50 text-gray-600 border border-gray-200"}`}>✅ Create CAPA</button>
      </div>

      {gated ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-4 text-center"><p className="text-sm text-gray-500">Not provisioned</p><p className="text-[11px] text-gray-400 mt-1">Run migration <span className="font-mono">073-quality-safety</span> to enable incidents &amp; quality actions.</p></div>
      ) : tab === "incident" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <select value={inc.incident_type} onChange={e => setInc({ ...inc, incident_type: e.target.value })} className={`${sel} flex-1`}>{INCIDENT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select>
            <select value={inc.severity} onChange={e => setInc({ ...inc, severity: e.target.value })} className={sel}>{SEV.map(s => <option key={s} value={s}>{s}</option>)}</select>
            <label className="flex items-center gap-1 text-[11px] text-gray-600"><input type="checkbox" checked={inc.near_miss} onChange={e => setInc({ ...inc, near_miss: e.target.checked })} /> Near miss</label>
          </div>
          <textarea value={inc.description} onChange={e => setInc({ ...inc, description: e.target.value })} rows={2} placeholder="What happened…" className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none" />
          <button onClick={() => post("/api/operations/incidents", inc, () => setInc({ incident_type: "medication", severity: "medium", near_miss: false, description: "" }), "Incident reported")} disabled={!inc.description.trim() || busy} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">{busy ? "…" : "Report incident"}</button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <select value={qa.action_type} onChange={e => setQa({ ...qa, action_type: e.target.value })} className={`${sel} flex-1`}>{QUALITY_TYPES.map(t => <option key={t} value={t}>{QUALITY_TYPE_LABEL[t]}</option>)}</select>
            <select value={qa.priority} onChange={e => setQa({ ...qa, priority: e.target.value })} className={sel}>{PRIO.map(p => <option key={p} value={p}>{p}</option>)}</select>
            <input type="number" min={0} value={qa.due_hours} onChange={e => setQa({ ...qa, due_hours: e.target.value })} placeholder="Due (h)" className={`${sel} w-20`} />
          </div>
          <input value={qa.title} onChange={e => setQa({ ...qa, title: e.target.value })} placeholder="Action title *" className={`${sel} w-full`} />
          <textarea value={qa.description} onChange={e => setQa({ ...qa, description: e.target.value })} rows={2} placeholder="Description…" className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none" />
          <button onClick={() => post("/api/operations/quality-actions", { ...qa, due_hours: qa.due_hours ? Number(qa.due_hours) : undefined }, () => setQa({ action_type: "capa", title: "", priority: "medium", description: "", due_hours: "" }), "Action created")} disabled={!qa.title.trim() || busy} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">{busy ? "…" : "Create action"}</button>
        </div>
      )}
      {ok && <p className="text-[11px] text-green-600 mt-2">{ok}</p>}
      {err && <p className="text-[11px] text-rose-600 mt-2">{err}</p>}
    </div>
  );
}
