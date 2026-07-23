"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// SBAR Builder editor (SSW-HC-007). Four editable sections prefilled with the current
// (auto-generated or saved) narrative; Auto Fill resets a section to the operational
// auto-draft; Save / Share persist through the handover API (save_sbar), versioned via
// audit_log. Live quality check counts completed sections against JBI/SBAR criteria.
const SECTIONS: [string, string, string, string][] = [
  ["situation", "S", "Situation", "What is happening with the patient?"],
  ["background", "B", "Background", "What is the clinical background?"],
  ["assessment", "A", "Assessment", "What do I think the problem is?"],
  ["recommendation", "R", "Recommendation", "What needs to happen next?"],
];
const CLR: Record<string, string> = { situation: "bg-emerald-500", background: "bg-violet-500", assessment: "bg-amber-500", recommendation: "bg-rose-500" };

export default function SbarEditor({ patientId, patientLabel, current, auto }: { patientId: string; patientLabel: string; current: Record<string, string>; auto: Record<string, string> }) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>({ ...current });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const complete = SECTIONS.filter(([k]) => (v[k] ?? "").trim().length > 0).length;

  async function save(sbar_status: string, label: string) {
    setBusy(label); setErr(null); setMsg(null);
    const res = await fetch("/api/operations/handover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_sbar", patient_id: patientId, patient_label: patientLabel, situation: v.situation, background: v.background, assessment: v.assessment, recommendation: v.recommendation, sbar_status }) });
    setBusy(null);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); return; }
    setMsg(label === "share" ? "Shared to Incoming Shift & Board." : "Draft saved."); router.refresh();
  }

  return (
    <div className="space-y-3">
      {SECTIONS.map(([k, badge, title, hint]) => (
        <div key={k} className="rounded-lg border border-gray-200 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2"><span className={`w-5 h-5 rounded ${CLR[k]} text-white text-[11px] font-bold flex items-center justify-center`}>{badge}</span><div><p className="text-xs font-semibold text-gray-800">{title}</p><p className="text-[10px] text-gray-400">{hint}</p></div></div>
            <button onClick={() => setV({ ...v, [k]: auto[k] })} className="text-[10px] font-semibold text-emerald-700 border border-emerald-200 rounded px-2 py-1 hover:bg-emerald-50">✨ Auto Fill</button>
          </div>
          <textarea value={v[k] ?? ""} onChange={e => setV({ ...v, [k]: e.target.value })} rows={3} className="w-full text-xs rounded-lg border border-gray-200 px-2.5 py-2 focus:border-emerald-400 focus:outline-none" />
        </div>
      ))}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-gray-500">Quality: <b className={complete === 4 ? "text-emerald-600" : "text-amber-600"}>{complete}/4 sections</b> complete{complete === 4 ? " · SBAR-complete" : ""}.</p>
        <div className="flex gap-2">
          <button onClick={() => save("draft", "draft")} disabled={!!busy} className="text-xs font-semibold rounded-lg py-2 px-3 border border-gray-200 text-gray-600 disabled:opacity-50">{busy === "draft" ? "Saving…" : "Save Draft"}</button>
          <button onClick={() => save("shared", "share")} disabled={!!busy || complete < 4} className="text-xs font-semibold rounded-lg py-2 px-3 bg-emerald-600 text-white disabled:opacity-50" title={complete < 4 ? "Complete all four sections first" : ""}>{busy === "share" ? "Sharing…" : "Share to Incoming Shift"}</button>
        </div>
      </div>
      {err && <p className="text-[10px] text-rose-600">{err}</p>}
      {msg && <p className="text-[10px] text-emerald-600">{msg}</p>}
    </div>
  );
}
