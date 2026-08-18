"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
// ⚠ FROM THE CONSTANTS FILE, NOT FROM THE ENGINE, AND THAT IS LOAD-BEARING RATHER THAN TIDY.
// booking-request-unverified.ts reaches evaluateBooking, audit and node:crypto. Importing one label from
// it here would pull that whole graph into the browser bundle -- it type-checks, it lints, it passes
// every harness, and it kills the page at runtime. That is exactly how the Follow-ups board died.
import { HANDLED_OUTCOMES, type QueuedRequest } from "@/lib/practice/booking-request-constants";
import { formatDateTime } from "@/lib/datetime";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE MARK IS THE FIRST THING ON EVERY ROW, AND IT IS NOT A SUBTLE ONE.
//
// A practice ringing to confirm needs to know which kind of row it is holding before it reads the name.
// An unverified request and a verified one rendering the same way -- same border, same weight, a small
// grey word somewhere -- is the failure this whole screen exists to prevent: a stranger's typed details
// read as a patient's.
//
// ⚠ AND THE LABEL AND THE SENTENCE COME FROM THE ENGINE, WHICH READ THEM FROM THE ROW'S OWN GENERATED
// COLUMN. This component does not decide which mark a row gets and has nothing it could decide it from.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function RequestQueueBoard({ requests, listIncomplete, includeHandled }: {
  requests: QueuedRequest[];
  listIncomplete: boolean;
  includeHandled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function close(id: string, outcome: string) {
    setBusy(id); setProblem(null);
    const res = await fetch("/api/v1/practice/booking-requests", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: id, outcome, note: note.trim() || null }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    // ⚠ THE SERVER'S SENTENCE. A rewrite loses the only part that says what to do.
    if (!res.ok) { setProblem(data.error ?? `That did not work (${res.status}).`); return; }
    setOpen(null); setNote("");
    router.refresh();
  }

  if (requests.length === 0)
    return (
      <p className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-[12.5px] leading-relaxed text-gray-600">
        {includeHandled
          ? "Nobody has asked for an appointment through your booking page."
          : "Nothing is waiting. Requests you have already closed are hidden — use the link above to see them."}
      </p>
    );

  return (
    <div className="mt-4 space-y-2.5">
      {listIncomplete && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
          There are more requests than this page reads at once, so this list is not the whole of them.
        </p>
      )}
      {problem && (
        <p className="rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2 text-[12px] text-rose-800">{problem}</p>
      )}

      {requests.map(r => {
        const unverified = r.verificationState === "unverified";
        return (
          <article key={r.id}
            className={`rounded-xl border p-4 ${unverified ? "border-amber-300 bg-amber-50/50" : "border-gray-200 bg-white"}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                unverified ? "bg-amber-200 text-amber-950" : "bg-emerald-100 text-emerald-800"}`}>
                {r.verificationLabel}
              </span>
              <h2 className="text-[13.5px] font-bold text-gray-900">{r.name}</h2>
              <span className="text-[11px] text-gray-500">{r.reference}</span>
              {r.handledAt && (
                <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                  closed
                </span>
              )}
            </div>

            {/* ⚠ THE SENTENCE, NOT ONLY THE BADGE. A word somebody has stopped noticing is not a warning. */}
            <p className={`mt-1 text-[11.5px] leading-relaxed ${unverified ? "text-amber-900" : "text-gray-500"}`}>
              {r.verificationSentence}
            </p>

            <dl className="mt-2 grid gap-x-4 gap-y-1 text-[12px] text-gray-700 sm:grid-cols-2">
              <div><dt className="inline font-semibold">Asked for: </dt>
                <dd className="inline">{formatDateTime(r.requestedStart)} ({r.requestedMinutes} min)</dd></div>
              <div><dt className="inline font-semibold">Kind: </dt>
                <dd className="inline">{r.appointmentType.replace(/_/g, " ")}</dd></div>
              {r.contactPhone && <div><dt className="inline font-semibold">Phone: </dt><dd className="inline">{r.contactPhone}</dd></div>}
              {r.contactEmail && <div><dt className="inline font-semibold">Email: </dt><dd className="inline">{r.contactEmail}</dd></div>}
            </dl>

            {r.reasonForVisit && (
              <p className="mt-2 text-[12px] leading-relaxed text-gray-700">
                <span className="font-semibold">Reason given: </span>{r.reasonForVisit}
              </p>
            )}
            {/* ⚠ THE `stated_` PREFIX IS THE LABEL AND IT IS DRAWN AS ONE. A patient saying they have
                diabetes is a patient saying so, and this screen must never read as a diagnosis. */}
            {r.statedDiagnosis && (
              <p className="mt-1 text-[12px] leading-relaxed text-gray-700">
                <span className="font-semibold">Diagnosis as the patient states it: </span>{r.statedDiagnosis}
              </p>
            )}
            {r.statedTreatment && (
              <p className="mt-1 text-[12px] leading-relaxed text-gray-700">
                <span className="font-semibold">Treatment as the patient states it: </span>{r.statedTreatment}
              </p>
            )}

            {r.handledAt ? (
              <p className="mt-2 text-[11.5px] text-gray-500">
                Closed {formatDateTime(r.handledAt)}
                {r.handledOutcome ? ` — ${HANDLED_OUTCOMES.find(o => o.code === r.handledOutcome)?.label ?? r.handledOutcome}` : ""}
                {r.handledNote ? `. ${r.handledNote}` : ""}
              </p>
            ) : open === r.id ? (
              <div className="mt-3 border-t border-black/5 pt-3">
                <label className="flex flex-col text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">
                  A note, if you want one
                  <input value={note} onChange={e => setNote(e.target.value)} maxLength={500}
                    className="mt-0.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800" />
                </label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {HANDLED_OUTCOMES.map(o => (
                    <button key={o.code} type="button" disabled={busy === r.id}
                      onClick={() => close(r.id, o.code)}
                      className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-gray-700 disabled:opacity-50">
                      {o.label}
                    </button>
                  ))}
                  <button type="button" onClick={() => { setOpen(null); setNote(""); }}
                    className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold text-gray-500">
                    Cancel
                  </button>
                </div>
                {/* ⚠ SAID WHERE THE DECISION IS MADE. Closing a request is not booking one, and somebody
                    pressing "Spoke to them" must not believe an appointment now exists. */}
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-gray-500">
                  Closing a request records what you did. It does not book anybody &mdash; book them in the
                  planner.
                </p>
              </div>
            ) : (
              <button type="button" onClick={() => setOpen(r.id)}
                className="mt-3 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-gray-700">
                Close this request
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
