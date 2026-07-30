"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Frontline raise actions (HWW-SAF-001 5-step pathway, steps 1-2): request
// assistance (escalation L1-5), raise a safety alert, or report an incident —
// all against the existing nurse-permitted POST routes.

const SAFETY_CATS = ["fall_risk", "medication", "pressure_injury", "infection", "patient_id", "deterioration", "device", "environmental"];
const INCIDENT_TYPES = ["medication", "falls", "equipment", "pressure_injury", "infection", "behaviour", "documentation", "other"];
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const btn = "px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50";
const tab = (on: boolean) => `px-3 py-1.5 rounded-lg text-xs font-medium ${on ? "bg-emerald-600 text-white" : "bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"}`;

export default function RaiseSafety({ patients }: { patients: { id: string; label: string }[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<"" | "escalation" | "alert" | "incident">("");
  const [patientId, setPatientId] = useState(patients[0]?.id ?? "");
  const [level, setLevel] = useState("2");
  const [cat, setCat] = useState("deterioration");
  const [incType, setIncType] = useState("other");
  const [nearMiss, setNearMiss] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "Failed"); return false; }
    setText(""); setKind("");
    router.refresh();
    return true;
  }

  if (patients.length === 0 && kind === "") {
    return <p className="text-xs text-gray-400">Raise actions unlock with an active patient assignment.</p>;
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-gray-900">Raise</h3>
        <button className={tab(kind === "escalation")} onClick={() => setKind(kind === "escalation" ? "" : "escalation")}>🆘 Request assistance</button>
        <button className={tab(kind === "alert")} onClick={() => setKind(kind === "alert" ? "" : "alert")}>🛡️ Safety alert</button>
        <button className={tab(kind === "incident")} onClick={() => setKind(kind === "incident" ? "" : "incident")}>🚩 Incident report</button>
      </div>
      {msg && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{msg}</p>}
      {kind !== "" && (
        <div className="space-y-2">
          <div className="grid sm:grid-cols-3 gap-2">
            <label className="text-sm"><span className="text-gray-600 text-xs">Patient</span>
              <select className={input} value={patientId} onChange={e => setPatientId(e.target.value)}>
                {patients.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            {kind === "escalation" && (
              <label className="text-sm"><span className="text-gray-600 text-xs">Level</span>
                <select className={input} value={level} onChange={e => setLevel(e.target.value)}>
                  {[1, 2, 3, 4, 5].map(l => <option key={l} value={l}>L{l} · {["routine", "urgent", "high", "emergency", "critical"][l - 1]}</option>)}
                </select>
              </label>
            )}
            {kind === "alert" && (
              <label className="text-sm"><span className="text-gray-600 text-xs">Category</span>
                <select className={input} value={cat} onChange={e => setCat(e.target.value)}>
                  {SAFETY_CATS.map(x => <option key={x} value={x}>{titleCase(x)}</option>)}
                </select>
              </label>
            )}
            {kind === "incident" && (
              <label className="text-sm"><span className="text-gray-600 text-xs">Type</span>
                <select className={input} value={incType} onChange={e => setIncType(e.target.value)}>
                  {INCIDENT_TYPES.map(x => <option key={x} value={x}>{titleCase(x)}</option>)}
                </select>
              </label>
            )}
            {kind === "incident" && (
              <label className="flex items-end gap-2 text-sm text-gray-600 pb-2"><input type="checkbox" checked={nearMiss} onChange={e => setNearMiss(e.target.checked)} /> Near miss</label>
            )}
          </div>
          <textarea className={`${input} min-h-[60px]`}
            placeholder={kind === "escalation" ? "What do you need help with?" : kind === "alert" ? "Safety note" : "What happened? (operational description)"}
            value={text} onChange={e => setText(e.target.value)} />
          <button className={btn} disabled={busy || (kind !== "alert" && !text.trim())} onClick={() => {
            if (kind === "escalation") post("/api/operations/escalations", { level: Number(level), summary: text, patient_id: patientId });
            else if (kind === "alert") post("/api/operations/safety-alerts", { category: cat, severity: "medium", patient_id: patientId, note: text });
            else post("/api/operations/incidents", { incident_type: incType, severity: "medium", near_miss: nearMiss, patient_id: patientId, description: text });
          }}>{busy ? "Sending…" : "Submit"}</button>
        </div>
      )}
    </div>
  );
}
