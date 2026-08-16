"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Walkthrough 2026-08-16, request #4 -- ONE CLICK FROM BOOKED TO ARRIVED.
//
// The expected strip used to be a sentence pointing at the Planner, which meant checking a patient in
// cost a navigation, a scan of the day view, and a click. The owner asked for the click alone. So the
// strip now lists the expected people with the ONE action an expected person has: check in. The button
// fires the same `arrive` transition the Planner uses -- the SERVER stamps the arrival moment when it
// creates the queue entry, so the timestamp is the moment of the click, not anything this device claims.
//
// ⚠ THESE ARE NOT QUEUE ROWS. s7's rule stands: an expected person is not in the corridor, and putting
// them in the waiting list would corrupt "waiting". They live in their own strip, labelled as not yet
// arrived, and cross into the queue only when the transition succeeds.
//
// ⚠ REFRESH RATHER THAN MUTATE LOCALLY (same rule as QueueWithActions): the queue row this creates, its
// arrival time, and the Arrived tile are all computed on the server. Editing lists in place would show
// a person in two places at once while every figure on the screen still disagreed.

export default function ExpectedCheckIn({ people, total }: {
  people: { appointmentId: string; name: string; timeLabel: string | null }[];
  /** The full expected count -- may exceed the rows shown when the engine capped the list. */
  total: number | null;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkIn(appointmentId: string) {
    setBusyId(appointmentId);
    setError(null);
    try {
      const res = await fetch(`/api/v1/practice/appointments/${appointmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "arrive" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error?.message ?? body?.error ?? "That check-in could not be recorded.");
        return;
      }
      router.refresh();
    } catch {
      setError("That check-in could not be recorded.");
    } finally {
      setBusyId(null);
    }
  }

  const overflow = total !== null && total > people.length ? total - people.length : 0;

  return (
    <section className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        Expected -- booked, not yet arrived
      </p>
      <ul className="mt-1 divide-y divide-gray-100">
        {people.map(p => (
          <li key={p.appointmentId} className="flex items-center gap-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-gray-800">{p.name}</span>
            {p.timeLabel && (
              <span className="shrink-0 text-[10px] tabular-nums text-gray-400">b. {p.timeLabel}</span>
            )}
            <button type="button" disabled={busyId !== null}
              onClick={() => checkIn(p.appointmentId)}
              className="shrink-0 rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {busyId === p.appointmentId ? "Checking in..." : "Check in"}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      <p className="mt-1 text-[11px] text-gray-500">
        {overflow > 0 && <>And {overflow} more later in the day.{" "}</>}
        <Link href="/practice/calendar" className="font-semibold text-[var(--cp-primary)] hover:underline">
          Full book in the Planner &rarr;
        </Link>
      </p>
    </section>
  );
}
