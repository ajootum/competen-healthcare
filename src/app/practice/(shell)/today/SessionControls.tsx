"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import SessionHeader from "./SessionHeader";
import { BUTTON, QUEUE_SWATCH } from "@/lib/practice/palette";

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

/**
 * Minutes as the header prints them. MIRRORS SessionHeader's own minutesLabel, which is not
 * exported and sits outside CPR-MOB-001 Phase 3b's file set -- restated rather than reached for.
 * Formatting only; the number itself is never adjusted.
 */
const minutesLabel = (m: number) => {
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
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
      {/* ══ CPR-MOB-001 s7 row 1: THE COMPACT STICKY HEADER (below md only) ═══════════════════════
          The same session, the same handlers, a second FACE: activity, place, state, the running
          clock, and Pause/End at thumb size, pinned to the top of the scroll. STICKY, never fixed:
          it takes its place in the flow first, so it can never sit on top of content (s17). It lives
          HERE rather than inside SessionHeader because a sticky element cannot escape its parent --
          the page mounts SessionControls as a direct child of the full-height root exactly so this
          bar can pin for the whole scroll. -mx-5 bleeds it across main's p-5 to the screen edges;
          z-30 keeps it under the bottom navigation's z-40. At md and up it is display:none and the
          desktop card below is the header, unchanged. */}
      <div className="sticky top-0 z-30 -mx-5 border-b border-gray-200 bg-white/95 px-4 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.06)] backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[14px] font-bold leading-tight text-gray-900">{header.title}</span>
              {/* s19/s4: the state is a WORD in a chip, never colour alone. Only the two states a
                  running SessionControls can be in are spelt here. */}
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold ${
                header.state === "PAUSED" ? QUEUE_SWATCH.PAUSED.chip
                  : "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"}`}>
                {header.state === "PAUSED" ? "Paused" : "Running"}
              </span>
            </p>
            <p className="truncate text-[10.5px] tabular-nums text-gray-500">
              {/* A missing place is SAID, same sentence as the desktop card. */}
              {[header.activityLabel, header.facilityName, header.room].filter(Boolean).join(" · ")
                || "No activity, place or room recorded"}
              {" · "}
              {/* A null clock is an em dash, never 0m -- the reason renders below in visible words,
                  because hover does not exist on this face (s4). */}
              {header.elapsedMinutes === null ? "running for —" : `running ${minutesLabel(header.elapsedMinutes)}`}
              {header.overrunMinutes !== null && (
                <span className="font-semibold text-[var(--cmp-text-warning)]">
                  {" · "}{minutesLabel(header.overrunMinutes)} over
                </span>
              )}
            </p>
          </div>
          {header.canControl && (header.state === "RUNNING" || header.state === "PAUSED") && (
            <div className="flex shrink-0 items-center gap-1.5">
              {header.state === "RUNNING" ? (
                <button type="button" disabled={busy} onClick={() => void act("pause")}
                  className={`min-h-[var(--cp-touch)] rounded-lg px-3 text-[12.5px] font-semibold ${BUTTON.quiet}`}>
                  Pause
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => void act("resume")}
                  className={`min-h-[var(--cp-touch)] rounded-lg px-3 text-[12.5px] font-semibold ${BUTTON.primary}`}>
                  Resume
                </button>
              )}
              {/* The SAME intercepting onEnd as the desktop button -- the pre-finish check is one
                  implementation with two doors, never a mobile bypass. */}
              <button type="button" disabled={busy} onClick={onEnd}
                className={`min-h-[var(--cp-touch)] rounded-lg px-3 text-[12.5px] font-semibold ${BUTTON.danger}`}>
                End
              </button>
            </div>
          )}
        </div>
        {(header.elapsedReason || header.elapsedMinutes === null) && (
          <p className="mt-0.5 text-[9.5px] leading-tight text-gray-500">
            {header.elapsedReason ?? "No figure available."}
          </p>
        )}
        {/* The refusal is shown WHERE THE TAP HAPPENED. The desktop card that normally carries it is
            display:none below md, and an error only a hidden element shows is a button that silently
            did nothing. */}
        {error && (
          <p role="alert" className="mt-1 rounded-lg bg-[var(--cmp-surface-danger)] px-2.5 py-1.5 text-[11.5px] text-[var(--cmp-text-danger)]">
            {error}
          </p>
        )}
      </div>

      {/* The mt-4 wrapper the page used to provide, moved in here byte-for-byte (see the page's
          mounting comment); max-md:hidden on the card wrapper is the conditional split's other
          half. Both are no-ops at md and up. */}
      <div className="mt-4">
        <div className="max-md:hidden">
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
        </div>

      {/* Below md the acknowledgement ANCHORS ABOVE THE BOTTOM NAV instead of rendering in place:
          the End tap can come from the sticky bar while the reader is scrolled deep in the queue,
          and a panel that appears offscreen at the top of the document is a button that looks
          broken -- the walkthrough's ninth defect, in new clothes. Fixed inside the viewport, over
          nothing interactive, offset by the same two tokens the bottom bar occupies. */}
      {confirmingEnd && (
        <div role="alertdialog" aria-labelledby="prefinish-h"
          className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-4 max-md:fixed max-md:inset-x-3 max-md:bottom-[calc(var(--cp-bottomnav-h)_+_var(--cp-safe-bottom)_+_12px)] max-md:z-50 max-md:shadow-xl">
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
              className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold max-md:min-h-[var(--cp-touch)] max-md:flex-1 ${BUTTON.danger}`}>
              End session anyway
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirmingEnd(false)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold max-md:min-h-[var(--cp-touch)] max-md:flex-1 ${BUTTON.quiet}`}>
              Keep running
            </button>
          </div>
        </div>
      )}
      </div>
    </>
  );
}
