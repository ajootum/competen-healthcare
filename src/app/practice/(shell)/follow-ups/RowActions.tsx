"use client";

import { useState } from "react";
import Link from "next/link";
import { BUTTON } from "@/lib/practice/palette";

// CPR-FUP-001 s5: "each row provides one-click actions: Open Encounter, Open Patient, Reschedule,
// Complete, Cancel (where permitted). Clinical documentation is not performed here."
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT "WHERE PERMITTED" MEANS HERE, AND WHY THE BUTTONS DIFFER FROM ROW TO ROW:
//
//   Open Encounter  appears only when there IS one. A row raised manually has no consultation behind
//                   it, and a button that opened nothing would be worse than no button.
//   Complete        asks for words before it will submit. The engine refuses a completion with no
//                   encounter behind it and no outcome (a tick that records a click, not a
//                   consultation) -- this just makes the refusal arrive as a disabled button rather
//                   than as a red banner afterwards.
//   Reschedule      is a DATE, not a state change, and it is sent as one. The original date survives in
//                   the obligation's own trail (CPR-FUP-002 s7).
//   Defer           requires the date it comes back. A deferral with no date is an obligation nobody
//                   will be reminded of again.
//
// NO CLINICAL FIELD IS OFFERED ANYWHERE IN HERE. s2 and s7 are explicit that this is not a
// documentation screen and that duplicate clinical entry is the thing to avoid.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

type Mode = "reschedule" | "defer" | "complete" | "cancel" | "missed" | null;

const input = "w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[12.5px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

export default function RowActions({ followUp: f, canManage, today }: {
  followUp: any; canManage: boolean; today: string;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [words, setWords] = useState("");
  const [date, setDate] = useState(f.effectiveDueOn ?? today);

  async function send(payload: unknown) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/v1/practice/follow-ups/${f.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error?.message ?? data?.error ?? "That did not work.");
      setBusy(false); return;
    }
    window.location.reload();
  }

  const quiet = "rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        {f.origin_encounter_id && (
          <Link href={`/practice/encounters/${f.origin_encounter_id}`} className={quiet}>Open encounter</Link>
        )}
        <Link href={`/practice/patients/${f.patient_id}`} className={quiet}>Open patient</Link>
        {canManage && (
          <>
            <button type="button" className={quiet} onClick={() => { setWords(""); setDate(f.effectiveDueOn ?? today); setMode(mode === "reschedule" ? null : "reschedule"); }}>
              Reschedule
            </button>
            <button type="button" className={quiet} onClick={() => { setWords(""); setMode(mode === "complete" ? null : "complete"); }}>
              Complete
            </button>
            <button type="button" className={quiet} onClick={() => { setWords(""); setMode(mode === "cancel" ? null : "cancel"); }}>
              Cancel
            </button>
            <details className="relative">
              <summary className={`${quiet} list-none cursor-pointer`}>More</summary>
              <div className="absolute right-0 z-10 mt-1 flex w-40 flex-col gap-1 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg">
                <button type="button" className={quiet} onClick={() => { setWords(""); setDate(today); setMode("defer"); }}>
                  Defer to a date
                </button>
                <button type="button" className={quiet} onClick={() => { setWords(""); setMode("missed"); }}>
                  Mark missed
                </button>
              </div>
            </details>
          </>
        )}
      </div>

      {error && <p className="max-w-xs text-right text-[11px] text-[var(--cmp-text-critical)]">{error}</p>}

      {mode && (
        <form
          className="w-72 rounded-lg border border-gray-200 bg-gray-50 p-2 text-left"
          onSubmit={e => {
            e.preventDefault();
            if (mode === "reschedule") return send({ dueOn: date, reason: words.trim() || undefined });
            if (mode === "defer") return send({ deferUntil: date, reason: words.trim() || undefined });
            if (mode === "complete") return send({ action: "complete", outcome: words });
            if (mode === "missed") return send({ action: "missed", outcome: words });
            return send({ action: "cancel", outcome: words.trim() || undefined });
          }}
        >
          {(mode === "reschedule" || mode === "defer") && (
            <label className="mb-1.5 flex flex-col gap-0.5">
              <span className="text-[11px] font-semibold text-gray-600">
                {mode === "reschedule" ? "New due date" : "Comes back on"}
              </span>
              <input type="date" required value={date} onChange={e => setDate(e.target.value)} className={input} />
              <span className="text-[10px] text-gray-400">
                {mode === "reschedule"
                  ? `Currently ${f.due_on}. The old date stays in this follow-up's own trail.`
                  : "Required. A deferral with no date is an obligation nobody is reminded of again."}
              </span>
            </label>
          )}
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] font-semibold text-gray-600">
              {mode === "complete" ? "What happened?"
                : mode === "missed" ? "Why is this being marked missed?"
                  : mode === "cancel" ? "Why is this no longer needed? (optional)"
                    : "Why is it moving? (optional)"}
            </span>
            <input autoFocus value={words} onChange={e => setWords(e.target.value)} className={input} />
          </label>
          {mode === "complete" && (
            <p className="mt-1 text-[10px] leading-relaxed text-gray-400">
              Closing from the consultation records the encounter instead. From here, something has to say
              what happened &mdash; otherwise the record shows that somebody clicked, not that anybody was seen.
            </p>
          )}
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="submit"
              disabled={busy || ((mode === "complete" || mode === "missed") && !words.trim())}
              className={`rounded-lg px-2.5 py-1 text-[11.5px] font-semibold ${BUTTON.primary}`}
            >
              Confirm
            </button>
            <button type="button" onClick={() => { setMode(null); setError(null); }}
              className={`rounded-lg px-2.5 py-1 text-[11.5px] font-semibold ${BUTTON.quiet}`}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
