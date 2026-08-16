"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import SessionHeader from "./SessionHeader";
import { BUTTON } from "@/lib/practice/palette";

// The client half of CPR-V5-004's session header: it owns the three lifecycle calls and nothing else.
//
// ⚠ SessionHeader IS DELIBERATELY DUMB, AND THIS FILE EXISTS TO KEEP IT THAT WAY. Everything it renders
// arrives as a prop; the only thing it cannot be given is a fetch. Splitting them means the header can be
// rendered on the server with real figures and this wrapper carries the one piece of state a button
// needs -- which of the three is in flight.
//
// ⚠ THE ANSWER IS RE-READ, NOT PATCHED. Pausing changes the elapsed minutes, the progress bar, the
// projected finish and the session's own state, and every one of those is computed on the server from
// the pause ledger. Applying the change optimistically here would be a second implementation of the
// arithmetic migration 235 exists to centralise -- and it would be the one nobody can test. So the
// action posts, and the page re-renders from the engine.
//
// ── CPR-CUR-001 s13.2: THE PRE-FINISH CHECK ─────────────────────────────────────────────────────────
//
// "Finish Session performs a pre-finish check: patients still waiting, encounter(s) in
// progress/unfinished, unresolved arrivals and other deterministic operational exceptions."
//
// The figures arrive as PROPS, computed by the same engines the rest of the screen reads (metrics.ts
// waiting, session.ts flow) -- this wrapper counts nothing itself. When any figure is non-zero, or
// could not be read, End becomes a two-step: the exceptions are listed and the practitioner
// acknowledges them explicitly. When everything is clear, End acts at once -- friction is spent only
// where there is something to acknowledge.
//
// ⚠ ACKNOWLEDGEMENT, NOT PREVENTION. s13.2 blocks the finish only "where safety/data-integrity rules
// require it", and NO SUCH RULE IS STORED anywhere in this product -- no table names a condition that
// must forbid closure. Inventing one would strand a practitioner in a session the product refuses to
// end over a rule nobody wrote. If such rules ever exist in configuration, the blocking branch plugs
// in here.

type Unresolved = {
  /** Each is the owning engine's own figure. Null means it could not be read -- said, never hidden. */
  waiting: number | null;
  openEncounters: number | null;
  unregisteredArrivals: number | null;
  expected: number | null;
};

type Props = {
  activityId: string;
  /** Everything SessionHeader renders, resolved on the server. */
  header: Omit<React.ComponentProps<typeof SessionHeader>, "busy" | "error" | "onPause" | "onResume" | "onEnd">;
  /** Null for non-clinical sessions, which have no patient flow to check (s15). */
  unresolved: Unresolved | null;
};

/** The sentences of the pre-finish check. Exported shape kept simple so the harness can read them here. */
function unresolvedSentences(u: Unresolved): string[] {
  const out: string[] = [];
  const n = (x: number, one: string, many: string) => (x === 1 ? one : many.replace("{n}", String(x)));
  if (u.waiting !== null && u.waiting > 0)
    out.push(n(u.waiting, "1 patient is still waiting.", "{n} patients are still waiting."));
  if (u.openEncounters !== null && u.openEncounters > 0)
    out.push(n(u.openEncounters, "1 consultation is still open and unfinished.", "{n} consultations are still open and unfinished."));
  if (u.unregisteredArrivals !== null && u.unregisteredArrivals > 0)
    out.push(n(u.unregisteredArrivals, "1 arrival has no patient record attached.", "{n} arrivals have no patient record attached."));
  if (u.expected !== null && u.expected > 0)
    out.push(n(u.expected, "1 booked patient never arrived and has not been marked.", "{n} booked patients never arrived and have not been marked."));
  if (u.waiting === null || u.openEncounters === null || u.unregisteredArrivals === null || u.expected === null)
    out.push("Some of these figures could not be read just now, so this check is incomplete.");
  return out;
}

export default function SessionControls({ activityId, header, unresolved }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The pre-finish acknowledgement panel is open. */
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  const act = async (action: "pause" | "resume" | "end") => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/v1/practice/current-activity", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id: activityId }),
      });
      const j = await r.json().catch(() => ({}));
      // THE REFUSAL IS SHOWN. Every code the engine can return -- ALREADY_PAUSED, NOT_PAUSED,
      // ALREADY_ENDED, NOT_STARTED -- is a sentence a practitioner can act on, and a button that
      // silently did nothing would be indistinguishable from a broken one.
      if (!r.ok) { setError(j.error ?? "That did not work."); return; }
      // HFE-001 v1.1 s6: ending a session is a TRANSITION, not a disappearance -- the closure state
      // shows what the session amounted to before returning to Today.
      if (action === "end") { router.push(`/practice/today/complete?activity=${activityId}`); return; }
      router.refresh();
    } catch {
      setError("That did not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const sentences = unresolved ? unresolvedSentences(unresolved) : [];

  // End is intercepted exactly when there is something to acknowledge; otherwise it acts directly.
  const onEnd = () => {
    if (sentences.length > 0 && !confirmingEnd) { setConfirmingEnd(true); return; }
    void act("end");
  };

  return (
    <>
      <SessionHeader
        {...header}
        busy={busy}
        error={error}
        // Handlers are passed only where the state allows the move, so the header does not have to know
        // the lifecycle -- it renders a button when it is given one to render.
        onPause={header.state === "RUNNING" ? () => act("pause") : undefined}
        onResume={header.state === "PAUSED" ? () => act("resume") : undefined}
        onEnd={header.state === "RUNNING" || header.state === "PAUSED" ? onEnd : undefined}
      />

      {confirmingEnd && (
        <div role="alertdialog" aria-labelledby="prefinish-h"
          className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 id="prefinish-h" className="text-[13px] font-bold text-amber-900">
            Before this session ends
          </h3>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {sentences.map(s => (
              <li key={s} className="text-[12.5px] text-amber-900">{s}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11.5px] text-amber-800">
            Ending now leaves these as they are -- nothing is completed or discarded on your behalf.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {/* s19: no double activation -- both act buttons share the one busy flag. */}
            <button type="button" disabled={busy} onClick={() => void act("end")}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${BUTTON.danger}`}>
              End session anyway
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirmingEnd(false)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${BUTTON.quiet}`}>
              Keep running
            </button>
          </div>
        </div>
      )}
    </>
  );
}
