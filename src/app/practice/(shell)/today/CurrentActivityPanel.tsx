"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TodaysPlan } from "@/lib/practice/activity";
import { formatMinuteOfDay } from "@/lib/datetime";

// CPR-V3-001 s4's Current Activity, as the comp draws it: what is running, where, and the one button that
// changes it.
//
// A CLIENT COMPONENT ONLY FOR THE THREE BUTTONS. Everything shown is server-rendered and passed in; this
// wrapper exists to post an action and refresh. The panel never computes state itself -- "running" is
// decided by the engine from timestamps, and a component that recomputed it would eventually disagree.
//
// THE ERROR IS SHOWN, NOT SWALLOWED. Every refusal in ACTIVITY_REFUSES arrives here as a message a
// practitioner can act on ("that activity is not planned for today"), and a button that silently did
// nothing would be indistinguishable from a broken one -- which is exactly the bug class that made the
// availability session menu look like it could not delete.

export default function CurrentActivityPanel({ plan, canPlan }: { plan: TodaysPlan; canPlan: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: "start" | "end", id: string) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/v1/practice/current-activity", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "That did not work."); return; }
      router.refresh();
    } catch {
      setError("That did not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const current = plan.current;
  const next = plan.next;

  return (
    <section className="rounded-2xl border border-[var(--cp-primary-border)] bg-[var(--cp-primary-soft)] p-4"
      aria-labelledby="current-activity-h">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="current-activity-h" className="text-[13px] font-bold text-[var(--cp-primary-deep)]">Current Activity</h2>
        {current && canPlan && (
          <button type="button" disabled={busy} onClick={() => act("end", current.id)}
            className="rounded-lg border border-[var(--cp-primary-border)] bg-white px-2.5 py-1 text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:bg-white/70 disabled:opacity-50">
            End
          </button>
        )}
      </div>

      {current ? (
        <>
          <p className="mt-2.5 text-[17px] font-bold leading-tight text-gray-900">{current.title}</p>
          <p className="mt-0.5 text-[12.5px] text-gray-600">
            {[current.label, current.facilityName, current.room].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-2 text-[12.5px] font-semibold tabular-nums text-[var(--cp-primary-deep)]">
            {formatMinuteOfDay(current.plannedStartMinute)} – {formatMinuteOfDay(current.plannedEndMinute)}
          </p>
          {/* Overrunning is reported, never corrected. A clinic that runs long is a clinic, not an error. */}
          {current.overrunMinutes !== null && (
            <p className="mt-1 text-[11.5px] text-[var(--cmp-text-warning)]">
              Running {current.overrunMinutes} min past its planned end.
            </p>
          )}
        </>
      ) : (
        <p className="mt-2.5 text-[13px] text-gray-600">
          {plan.unavailable
            ? "Could not be read just now."
            : plan.activities.length === 0
              ? "Nothing is planned for today, so there is nothing to be in."
              : "Nothing is running. Start what you are doing so encounters can inherit it."}
        </p>
      )}

      {next && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--cp-primary-border)] pt-2.5">
          <span className="min-w-0">
            <span className="block text-[10.5px] font-bold uppercase tracking-wide text-gray-500">
              {current ? "Next" : "First up"}
            </span>
            <span className="block truncate text-[12.5px] font-semibold text-gray-800">
              {formatMinuteOfDay(next.plannedStartMinute)} · {next.title}
            </span>
          </span>
          {canPlan && (
            <button type="button" disabled={busy} onClick={() => act("start", next.id)}
              className="shrink-0 rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {current ? "Switch" : "Start"}
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2.5 rounded-lg bg-[var(--cmp-surface-danger)] px-3 py-2 text-[12px] text-[var(--cmp-text-danger)]">
          {error}
        </p>
      )}
    </section>
  );
}
