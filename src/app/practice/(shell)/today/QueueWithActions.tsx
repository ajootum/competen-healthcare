"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import WaitingQueueCard, { type QueuePerson } from "./WaitingQueueCard";

// CPR-ADOPT-001 s2 -- the client half of Capture Later.
//
// ⚠ THIS EXISTS BECAUSE A SERVER COMPONENT CANNOT HAND A FUNCTION TO A CLIENT ONE. WaitingQueueCard has
// carried an optional `onStartEncounter` for as long as it has existed and NOBODY has ever passed it: the
// only caller is /practice/today, which is a server component, so the button has never once been drawn.
// An optional handler prop on a client component that only a server renders is a feature that cannot
// happen. This wrapper is the missing half.
//
// ⚠ AND IT IS NOT THE CONTROL. The Seen action posts to /api/v1/practice/day-close, which gates on
// encounter.edit through requirePracticeContext. `canCapture` decides what is DRAWN; the route decides
// what is ALLOWED.

export default function QueueWithActions({ people, unavailableReason, truncatedNotice, href, canCapture }: {
  people: QueuePerson[];
  unavailableReason: string | null;
  /** Passed straight through: this wrapper adds handlers, it does not decide what the card may say. */
  truncatedNotice?: string | null;
  href: string | null;
  canCapture: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function markSeen(patientId: string) {
    const row = people.find(p => p.patientId === patientId);
    setBusyId(row?.id ?? patientId);
    setError(null);
    try {
      const res = await fetch("/api/v1/practice/day-close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "seen", patientId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error ?? "That could not be recorded."); return; }
      // ⚠ REFRESH RATHER THAN MUTATE LOCALLY. The encounter this created belongs in the To Complete queue
      // and in the day's figures, and both are computed on the server. Editing the list in place would
      // show a tick while every other number on the screen still disagreed.
      router.refresh();
    } catch {
      setError("That could not be recorded.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <WaitingQueueCard
      people={people}
      unavailableReason={unavailableReason}
      truncatedNotice={truncatedNotice ?? null}
      href={href}
      busyId={busyId}
      error={error}
      onMarkSeen={canCapture ? markSeen : undefined}
    />
  );
}
