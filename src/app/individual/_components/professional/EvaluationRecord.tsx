"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { focusRing, primaryBtn, secondaryBtn } from "../chrome";
import { inputCls } from "./forms";
import { AiNoticeText, aiNotice, type AiNotice } from "./ai-refusal";
import { AiGate } from "../ai/AiGate";

// Record an evaluation snapshot (COMPETEN-PROFESSIONAL-EVALUATION-01 E5), optionally with a labelled AI summary.
// The server RECOMPUTES the evaluation from the person's records: only the scope travels from here. AI text travels
// only if the person asked for it and ticked "include", and the server keeps it only when it can match it to the AI
// route's own record. A correction names the evaluation it corrects and says why.

type Scope = { scope: string; ref: string | null; outcome: string | null; from: string | null; to: string | null };
type Ai = { text: string; model: string; policyVersion: string };

export default function EvaluationRecord({ scope, accent, aiOn, correcting, aiLabel }: {
  scope: Scope; accent: string; aiOn: boolean; correcting: { id: string; label: string } | null; aiLabel: string;
}) {
  const router = useRouter();
  const [ai, setAi] = useState<Ai | null>(null);
  const [include, setInclude] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<AiNotice | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; id?: string } | null>(null);
  const [note, setNote] = useState("");

  async function ask() {
    setAsking(true); setNotice(null);
    try {
      const res = await fetch("/api/individual/professional/evaluation-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scope) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice(aiNotice(j, "The assistant could not answer just now.")); return; }
      setAi({ text: j.text, model: j.model, policyVersion: j.policyVersion });
    } catch { setNotice({ text: "The assistant could not be reached. Check your connection.", continuity: false }); } finally { setAsking(false); }
  }

  async function record() {
    setBusy(true); setMsg(null);
    try {
      const body = { ...scope, ...(ai && include ? { ai } : {}), ...(correcting ? { supersedesId: correcting.id, correctionNote: note } : {}) };
      const res = await fetch("/api/individual/professional/evaluations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: typeof j?.error === "string" ? j.error : "The evaluation could not be recorded. Try again shortly." }); return; }
      setMsg({ ok: true, text: "Recorded. It is private to you and will never change.", id: j.id });
      router.push(`?eval=${encodeURIComponent(j.id)}`);
      router.refresh();
    } catch { setMsg({ ok: false, text: "The evaluation could not be recorded. Check your connection." }); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      {aiOn && (
        <div>
          <AiGate activity="assistant" experience="professional">{g => (<button type="button" onClick={ask} disabled={asking || g.off} aria-describedby={g.describedBy} className={secondaryBtn} style={{ color: accent }}>{asking ? "Thinking…" : "✦ Summarise with the personal AI (optional)"}</button>)}</AiGate>
          {notice && <AiNoticeText notice={notice} className="mt-2" />}
          {ai && (
            <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3" aria-live="polite">
              <p className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-gray-500">{aiLabel}</p>
              <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-gray-800">{ai.text}</p>
              <p className="mt-1 text-[12px] text-gray-500">Model: {ai.model}</p>
              <label className="mt-2 flex min-h-[44px] items-center gap-2 text-[13px] text-gray-800">
                <input type="checkbox" checked={include} onChange={e => setInclude(e.target.checked)} className={focusRing} />
                Keep this AI summary with the evaluation, labelled as AI
              </label>
            </div>
          )}
        </div>
      )}
      {correcting && (
        <div>
          <label htmlFor="correction-note" className="block text-[13.5px] font-semibold text-gray-800">What are you correcting in &ldquo;{correcting.label}&rdquo;?</label>
          <textarea id="correction-note" rows={3} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} className={`mt-1 ${inputCls}`} />
          <p className="mt-1 text-[12px] text-gray-500">The original stays as it was. This records a new evaluation that names it.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={record} disabled={busy} className={primaryBtn} style={{ background: accent }}>
          {busy ? "Recording…" : correcting ? "Record the corrected evaluation" : "Record this evaluation"}
        </button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13.5px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
