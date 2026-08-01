"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Raise an assessment request from the ward (XWI P2-5).
//
// This sits on the staff board, next to the badge that says a clinician's competency does not hold, because
// that is the moment the supervisor knows. Anywhere else and it becomes a form somebody has to remember to
// go and fill in, which is what the old workaround already was.
//
// The request is OPEN by default -- no assessor named -- so the supervisor is not asked which assessor is
// free, a thing they usually cannot know mid-shift.

export default function RequestAssessment({ staffId, staffName }: { staffId: string; staffName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function submit() {
    setBusy(true); setNote(null);
    try {
      const res = await fetch("/api/competency/assessment-requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nurse_id: staffId, reason: reason.trim() || null, urgency: urgent ? "urgent" : "routine" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A duplicate is not a failure worth alarming anyone about -- it means the ask already exists.
        setNote({ tone: body.duplicate ? "ok" : "error", text: body.duplicate ? "A request for this clinician is already open." : (body.error ?? "Could not raise the request.") });
        return;
      }
      setNote({ tone: "ok", text: "Requested — it is in the assessor queue for this hospital." });
      setReason(""); setUrgent(false); setOpen(false);
      router.refresh();
    } catch {
      setNote({ tone: "error", text: "Network error — nothing was sent." });
    } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <span className="inline-flex flex-col items-end gap-0.5">
        <button onClick={() => setOpen(true)} className="text-[11px] text-teal-700 hover:underline">Request assessment</button>
        {note && <span className={`text-[10px] ${note.tone === "error" ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"}`}>{note.text}</span>}
      </span>
    );
  }

  return (
    <div className="w-full mt-2 rounded-lg border border-gray-200 bg-gray-50/60 p-2.5">
      <p className="text-[11px] font-semibold text-gray-700 mb-1.5">Assessment request — {staffName}</p>
      <textarea
        value={reason} onChange={e => setReason(e.target.value)} rows={2}
        placeholder="What does the ward need them assessed for? (optional)"
        className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30"
      />
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
          <input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} className="rounded border-gray-300" />
          Urgent
        </label>
        <span className="flex items-center gap-2">
          <button onClick={() => { setOpen(false); setNote(null); }} className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="text-[11px] font-semibold px-3 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50">
            {busy ? "Sending…" : "Send to assessors"}
          </button>
        </span>
      </div>
      <p className="text-[10px] text-gray-400 mt-1.5">Goes to the hospital&apos;s assessor queue — any assessor can claim it.</p>
      {note && <p className={`text-[10px] mt-1 ${note.tone === "error" ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"}`}>{note.text}</p>}
    </div>
  );
}
