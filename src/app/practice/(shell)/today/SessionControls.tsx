"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import SessionHeader from "./SessionHeader";

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

type Props = {
  activityId: string;
  /** Everything SessionHeader renders, resolved on the server. */
  header: Omit<React.ComponentProps<typeof SessionHeader>, "busy" | "error" | "onPause" | "onResume" | "onEnd">;
};

export default function SessionControls({ activityId, header }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <SessionHeader
      {...header}
      busy={busy}
      error={error}
      // Handlers are passed only where the state allows the move, so the header does not have to know
      // the lifecycle -- it renders a button when it is given one to render.
      onPause={header.state === "RUNNING" ? () => act("pause") : undefined}
      onResume={header.state === "PAUSED" ? () => act("resume") : undefined}
      onEnd={header.state === "RUNNING" || header.state === "PAUSED" ? () => act("end") : undefined}
    />
  );
}
