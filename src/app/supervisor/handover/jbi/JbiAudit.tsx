"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// JBI audit checklist (SSW-HC-008). Scores the 8 JBI bedside-handover domains 0–5,
// computes live compliance, and submits through the handover API (jbi_audit), which
// records op_handover_audits + updates the item JBI score. Fully audited.
const DOMAINS: [string, string][] = [
  ["identification", "Patient identification"],
  ["clinical_info", "Clinical information"],
  ["situation_awareness", "Situation awareness"],
  ["background", "Background / relevant history"],
  ["assessment", "Assessment shared"],
  ["recommendation", "Recommendation / plan"],
  ["shared_understanding", "Shared understanding"],
  ["professional", "Professional communication"],
];
const MAX = DOMAINS.length * 5;

export default function JbiAudit({ patientId, patientLabel }: { patientId: string; patientLabel: string }) {
  const router = useRouter();
  const [scores, setScores] = useState<Record<string, number>>(Object.fromEntries(DOMAINS.map(([k]) => [k, 5])));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const total = DOMAINS.reduce((s, [k]) => s + (scores[k] ?? 0), 0);
  const pct = Math.round((total / MAX) * 100);
  const cls = pct >= 85 ? "Excellent" : pct >= 70 ? "Good" : pct >= 60 ? "Fair" : "Needs Improvement";

  async function submit() {
    setBusy(true); setErr(null); setMsg(null);
    const res = await fetch("/api/operations/handover", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "jbi_audit", patient_id: patientId, patient_label: patientLabel, checklist: scores, follow_up_note: note || null }) });
    setBusy(false);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); return; }
    setMsg(`Audit recorded — ${pct}% ${cls}.`); router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1"><h3 className="text-sm font-bold text-gray-900">JBI Checklist · {patientLabel}</h3><span className={`text-sm font-bold ${pct >= 85 ? "text-emerald-600" : pct >= 70 ? "text-amber-600" : "text-rose-600"}`}>{pct}% · {cls}</span></div>
      {DOMAINS.map(([k, label], i) => (
        <div key={k} className="flex items-center justify-between gap-2 py-1 border-b border-gray-50">
          <span className="text-xs text-gray-700 flex-1"><span className="text-gray-400 mr-1.5">{i + 1}</span>{label}</span>
          <div className="flex gap-1">{[0, 1, 2, 3, 4, 5].map(n => (<button key={n} onClick={() => setScores({ ...scores, [k]: n })} className={`w-6 h-6 rounded text-[10px] font-semibold ${scores[k] === n ? (n >= 4 ? "bg-emerald-600 text-white" : n >= 3 ? "bg-amber-500 text-white" : "bg-rose-500 text-white") : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>{n}</button>))}</div>
        </div>
      ))}
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Follow-up note (optional)" className="w-full text-xs rounded-lg border border-gray-200 px-2.5 py-2 mt-2 focus:border-emerald-400 focus:outline-none" />
      <div className="flex items-center justify-between"><span className="text-[11px] text-gray-500">Score: <b>{total}/{MAX}</b></span><button onClick={submit} disabled={busy} className="text-xs font-semibold rounded-lg py-2 px-4 bg-emerald-600 text-white disabled:opacity-50">{busy ? "Recording…" : "Submit Audit"}</button></div>
      {err && <p className="text-[10px] text-rose-600">{err}</p>}
      {msg && <p className="text-[10px] text-emerald-600">{msg}</p>}
    </div>
  );
}
