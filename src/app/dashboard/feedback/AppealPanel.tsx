"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Appeal an assessment outcome (Appeals workflow). The learner picks one of
// their recent scored assessments, gives a reason, and staff review it in the
// Assessment Quality module. Existing appeals show their live status.

export type AppealableAssessment = { id: string; label: string };
export type MyAppeal = { id: string; competency: string | null; status: string; at: string; note: string | null };

const STATUS_CLS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700", under_review: "bg-amber-100 text-amber-700",
  upheld: "bg-gray-100 text-gray-600", overturned: "bg-green-100 text-green-700", withdrawn: "bg-gray-100 text-gray-400",
};

export default function AppealPanel({ assessments, appeals }: {
  assessments: AppealableAssessment[]; appeals: MyAppeal[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [assessmentId, setAssessmentId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!assessmentId || !reason.trim()) { setError("Pick the assessment and explain your reason."); return; }
    setBusy(true); setError(null);
    const res = await fetch("/api/appeals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessment_id: assessmentId, reason }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { setDone(true); setOpen(false); setReason(""); setAssessmentId(""); router.refresh(); }
    else setError(d.error ?? "Could not submit the appeal");
    setBusy(false);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">⚖️ Appeals</h2>
        {assessments.length > 0 && !done && (
          <button onClick={() => setOpen(v => !v)}
            className="text-[11px] font-semibold text-indigo-600 border border-indigo-200 rounded-lg px-2.5 py-1 hover:bg-indigo-50 transition-colors">
            {open ? "Cancel" : "Appeal an outcome"}
          </button>
        )}
      </div>
      <p className="text-[11px] text-gray-400 mb-3">
        Disagree with an assessment outcome? Raise an appeal — a senior colleague reviews it and you&apos;re notified of the decision. Overturned appeals lead to reassessment; historical scores aren&apos;t edited.
      </p>

      {done && <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3">✓ Appeal submitted — reviewers have been notified.</p>}

      {open && (
        <div className="border border-indigo-100 rounded-lg p-3 mb-3 space-y-2">
          <select value={assessmentId} onChange={e => setAssessmentId(e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-600 focus:outline-none focus:border-indigo-400">
            <option value="">Which assessment outcome?…</option>
            {assessments.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={2000}
            placeholder="Why do you believe this outcome is wrong? Be specific — what was demonstrated, witnessed by whom…"
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 text-gray-600 focus:outline-none focus:border-indigo-400" />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button onClick={submit} disabled={busy}
            className="text-xs font-bold text-white bg-indigo-600 rounded-lg px-4 py-2 hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {busy ? "Submitting…" : "Submit appeal"}
          </button>
        </div>
      )}

      {appeals.length > 0 ? (
        <div className="space-y-1.5">
          {appeals.map(a => (
            <div key={a.id} className="flex items-center gap-2 text-[11px] border border-gray-50 rounded-lg px-2.5 py-1.5">
              <span className="text-gray-700 flex-1 truncate">{a.competency ?? "Assessment"}</span>
              <span className="text-gray-300" suppressHydrationWarning>{new Date(a.at).toLocaleDateString()}</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${STATUS_CLS[a.status] ?? ""}`}>{a.status.replace("_", " ")}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-gray-300">No appeals raised.</p>
      )}
    </div>
  );
}
