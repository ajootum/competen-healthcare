"use client";

import { useState } from "react";
import type { ClarifyPrompt } from "@/lib/individual/ai-availability";

// AI OPERATING MODES (Supervised Pilot): the question put to the learner INSTEAD of a refusal, when a request on a
// clinical topic could be a study question or a question about a real patient. Nothing has been sent to a model.
//   - "For my studies" resends the SAME question with purpose "education" (the caller does that).
//   - "A real patient" shows the answer locally: no request is made, and nothing is recorded about the choice.
// The words come from the server (operating-mode.ts CLARIFY). A live region, so the question and the answer are
// announced; the buttons are full-width rows on a touch device.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

export default function ClarifyPurpose({ clarify, busy = false, onEducation, onPatient, accent, className = "" }: {
  clarify: ClarifyPrompt; busy?: boolean; onEducation: () => void; accent: string; className?: string;
  /** SCHOLAR-RISK-01: the learner said it is about a patient they are caring for (the caller stops treating the conversation as study). */
  onPatient?: () => void;
}) {
  const [patient, setPatient] = useState(false);
  return (
    <div role="status" aria-live="polite" className={`rounded-xl border border-gray-200 bg-gray-50 p-3.5 ${className}`}>
      <p className="text-[14px] font-semibold text-gray-900">{clarify.question}</p>
      <div className="mt-2.5 flex flex-wrap gap-2 pointer-coarse:flex-col">
        <button type="button" disabled={busy} onClick={onEducation} style={{ background: accent }}
          className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:w-full ${focusRing}`}>
          {busy ? "Working…" : clarify.education}
        </button>
        <button type="button" disabled={busy} onClick={() => { setPatient(true); onPatient?.(); }} aria-expanded={patient}
          className={`inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:w-full ${focusRing}`}>
          {clarify.patient}
        </button>
      </div>
      {patient && <p className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13.5px] leading-relaxed text-gray-800">{clarify.patientAnswer}</p>}
    </div>
  );
}
