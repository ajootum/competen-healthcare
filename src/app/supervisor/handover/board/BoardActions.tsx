"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Patient Handover Board actions (SSW-HC-006 §5) over the handover API. Mark Reviewed
// transfers review; Ask Clarification raises a question to the outgoing supervisor.
// Thin client — persistence + audit are server-side.
const BTN = "text-xs font-semibold rounded-lg py-2 px-3 disabled:opacity-50";

export default function BoardActions({ patientId, patientLabel, reviewed }: { patientId: string; patientLabel: string; reviewed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function post(url: string, method: string, body: Record<string, unknown>, label: string) {
    setBusy(label); setErr(null); setMsg(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); return false; }
    return true;
  }

  async function review() {
    if (await post("/api/operations/handover", "POST", { action: "review", patient_id: patientId, patient_label: patientLabel }, "review")) router.refresh();
  }
  async function clarify() {
    const q = window.prompt("Clarification question for the outgoing supervisor:", "");
    if (q === null || !q.trim()) return;
    if (await post("/api/operations/handover", "PATCH", { action: "clarify", patient_id: patientId, question: q }, "clarify")) { setMsg("Clarification sent."); router.refresh(); }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button onClick={clarify} disabled={!!busy} className={`${BTN} border border-gray-200 text-gray-600`}>💬 Ask Clarification</button>
        {reviewed
          ? <span className={`${BTN} bg-emerald-50 text-emerald-700 cursor-default`}>✓ Reviewed</span>
          : <button onClick={review} disabled={!!busy} className={`${BTN} bg-emerald-600 text-white`}>{busy === "review" ? "Saving…" : "Mark as Reviewed"}</button>}
      </div>
      {err && <p className="text-[10px] text-rose-600">{err}</p>}
      {msg && <p className="text-[10px] text-emerald-600">{msg}</p>}
      <p className="text-[10px] text-gray-400">By reviewing, you confirm you have received handover and will accept responsibility for this patient.</p>
    </div>
  );
}
