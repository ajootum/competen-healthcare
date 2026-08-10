"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// CPR-GROWTH-001 s2 -- "Act on this".
//
// ⚠ IT RAISES WORK, IT DOES NOT NAVIGATE, and that is the entire reason it exists. Every other control on
// this surface is a link, so there was nothing on the intelligence page a practitioner could DO -- which is
// why intelligence.first_action had no honest emitter. Emitting from a link would have marked every
// practice that ever opened the page as having reached the top of the adoption ladder.
//
// ⚠ THE TITLE COMES FROM THE SERVER. This posts a tile KEY and nothing else. Accepting a title here would
// let arbitrary text be written into a practice work item through an endpoint about intelligence, and a
// task reads as something the practice decided.

export default function InsightAction({ insightKey, disabled }: {
  insightKey: string;
  /** True when the tile could not be computed. Acting on a figure nobody could read is not acting. */
  disabled?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function act() {
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/v1/practice/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: insightKey }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "That could not be raised.");
        setState("idle");
        return;
      }
      setState("done");
      // The task list and any task count on screen are server-computed, so a local tick alone would leave
      // the rest of the page disagreeing with it.
      router.refresh();
    } catch {
      setError("That could not be raised.");
      setState("idle");
    }
  }

  if (disabled) return null;

  return (
    <div className="mt-2">
      {state === "done" ? (
        // ⚠ SAYS WHAT HAPPENED, not "done". A practitioner needs to know a task now exists and where it is,
        // or they will do the work twice.
        <p className="text-[10px] font-semibold text-[var(--cmp-text-success)]">
          Raised as a task assigned to you.
        </p>
      ) : (
        <button type="button" onClick={act} disabled={state === "busy"}
          className="rounded-md border border-gray-300 bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-gray-700 hover:bg-white disabled:opacity-50">
          {state === "busy" ? "Raising…" : "Act on this"}
        </button>
      )}
      {error && <p className="mt-1 text-[10px] text-[var(--cmp-text-error)]">{error}</p>}
    </div>
  );
}
