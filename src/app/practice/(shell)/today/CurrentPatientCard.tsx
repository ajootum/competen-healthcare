"use client";

import { useState } from "react";
import Link from "next/link";
import { BUTTON, QUEUE_SWATCH } from "@/lib/practice/palette";
import AttachRecordInline from "./AttachRecordInline";
import { waitLabel } from "./WaitingQueueCard";
import { startEncounterFor } from "@/lib/practice/encounter-start";

// CPR-CUR-001 s5.2 zone C -- THE CURRENT PATIENT, the dominant card of the running clinical session.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// "Desktop composition should prioritise the current patient and the next patient rather than
// analytics" (s5.2), and s19: "current patient identity must be visually unmistakable from
// next/waiting patients". So the card is LABELLED in words -- CURRENT PATIENT / NEXT PATIENT -- never
// distinguished by colour alone, and the name is the largest text in the main column.
//
// WHO DECIDED WHO IS CURRENT: the session engine's flow projection (session.ts), not this card. The
// open encounter outranks the queue's IN_CONSULTATION row because launchEncounter does not touch the
// queue -- the reasoning lives beside the projection. This card renders what it is handed.
//
// THE HANDOFF (s8): Continue Encounter is a plain link to the canonical Encounter workspace when an
// open encounter is already known; Start Encounter goes through startEncounterFor(), the ONE
// implementation of the resume-before-create rule, so this card cannot file a returning patient as a
// first visit -- and an unfinished encounter is resumed, never duplicated.
//
// s19 "prevent double activation": the busy flag disables the button while the launch is in flight,
// and the refusal is SHOWN -- a control that silently did nothing is indistinguishable from a broken
// one.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type FlowPerson = {
  role: "current" | "next";
  name: string;
  patientId: string | null;
  /** #18: the queue entry behind this person, so a record-less arrival can attach one IN PLACE. */
  queueEntryId: string | null;
  /** Identity fields (s8: "sufficiently strong to prevent wrong-patient selection"). Null when absent. */
  patientNumber: string | null;
  birthDate: string | null;
  ageEstimateYears: number | null;
  sex: string | null;
  /** Queue context. Null when the patient reached the room without a queue entry. */
  queueStatus: string | null;
  waitingMinutes: number | null;
  arrivedTimeLabel: string | null;
  /** Appointment context. All null for a walk-in. */
  bookedTimeLabel: string | null;
  appointmentType: string | null;
  appointmentReason: string | null;
  /** The open encounter, when one exists. Continue links straight to it. */
  encounterId: string | null;
  encounterStatus: string | null;
};

const card = "rounded-xl border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

/** The encounter state, in words a practitioner reads -- s19: never colour alone. */
const ENCOUNTER_STATE: Record<string, string> = {
  ACTIVE: "Consultation in progress",
  PAUSED: "Consultation paused",
};

export default function CurrentPatientCard({ person, canStartEncounter, canAttach, unavailableReason }: {
  person: FlowPerson | null;
  /** Decides what is DRAWN. The encounter API re-checks the capability, which is the actual control. */
  canStartEncounter: boolean;
  /** #18: whether the attach-in-place affordance is drawn for a record-less arrival. */
  canAttach: boolean;
  unavailableReason: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(patientId: string) {
    if (busy) return; // s19: no double activation.
    setBusy(true); setError(null);
    try {
      const r = await startEncounterFor(patientId);
      if (!r.ok) { setError(r.message); return; }
      window.location.assign(`/practice/encounters/${r.encounterId}`);
    } finally {
      setBusy(false);
    }
  }

  if (unavailableReason) {
    return (
      <section className={`${card} border-gray-200`} aria-labelledby="current-patient-h">
        <h2 id="current-patient-h" className="text-[13px] font-bold text-gray-900">Current patient</h2>
        <p className="mt-1 text-[12px] text-gray-500">{unavailableReason}</p>
      </section>
    );
  }

  if (!person) {
    return (
      <section className={`${card} border-gray-200`} aria-labelledby="current-patient-h">
        <h2 id="current-patient-h" className="text-[13px] font-bold text-gray-900">Current patient</h2>
        {/* An empty room is a REAL state, not an error -- and it is not padded out with zero-value
            figures. The queue card below is where the next arrival appears.

            ⚠ AND THAT IS EXACTLY WHY THIS NO LONGER SAYS "nobody is waiting". This card is fed
            `flow.current ?? flow.next`, both SESSION-scoped. The queue rendered directly beneath it is
            DAY-scoped. Walking the product found this card saying "nobody is waiting" with four people
            listed under it, each badged waiting -- they had arrived on an earlier day, so they were
            outside the session window and invisible to this card while plainly visible below it.
            A card that cannot see the queue must not make a claim about the queue. */}
        <p className="mt-1 text-[12.5px] text-gray-600">
          Nobody is with you. New arrivals appear here as they are checked in.
        </p>
      </section>
    );
  }

  const isCurrent = person.role === "current";
  const identity = [
    person.patientNumber,
    person.sex,
    person.birthDate ? `born ${person.birthDate}`
      : person.ageEstimateYears !== null ? `about ${person.ageEstimateYears} years` : null,
  ].filter(Boolean).join(" · ");
  const visit = [
    person.bookedTimeLabel ? `Booked ${person.bookedTimeLabel}` : "Walk-in",
    person.appointmentType && person.appointmentType !== "walk_in"
      ? person.appointmentType.replace(/_/g, " ") : null,
    person.arrivedTimeLabel ? `arrived ${person.arrivedTimeLabel}` : null,
    person.waitingMinutes !== null ? `waiting ${waitLabel(person.waitingMinutes)}` : null,
  ].filter(Boolean).join(" · ");

  const stateLabel = person.encounterStatus
    ? (ENCOUNTER_STATE[person.encounterStatus] ?? person.encounterStatus)
    : person.queueStatus === "IN_CONSULTATION" ? "With you -- no encounter open yet"
    : "Encounter not started";

  return (
    <section
      // The accent border is REINFORCEMENT of the word label above the name, never a substitute for it.
      className={`${card} ${isCurrent ? "border-[var(--cp-primary)]/40" : "border-gray-200"}`}
      aria-labelledby="current-patient-h"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p id="current-patient-h"
            className={`text-[10px] font-bold uppercase tracking-wider ${isCurrent ? "text-[var(--cp-primary-deep)]" : "text-gray-500"}`}>
            {isCurrent ? "Current patient" : "Next patient"}
          </p>
          <h2 className="mt-0.5 truncate text-[19px] font-bold leading-tight text-gray-900">{person.name}</h2>
          {/* Identity is SAID even when thin: a card with only a name says so, so nobody assumes the
              register holds more than it does. */}
          <p className="mt-0.5 text-[12px] text-gray-600">
            {identity || "No identifying details on the record beyond the name."}
          </p>
          <p className="mt-1 text-[12px] tabular-nums text-gray-500">{visit}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
          person.encounterStatus ? (QUEUE_SWATCH.IN_CONSULTATION?.chip ?? "bg-gray-100 text-gray-600")
            : "bg-gray-100 text-gray-600"}`}>
          {stateLabel}
        </span>
      </div>

      {/* ── THE ONE PRIMARY ACTION (s19: Continue/Start Encounter before anything administrative) ── */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* CPR-MOB-001 s7 row 3: below md the one primary action grows to full width at
            touch-primary size -- THE dominant control of the cockpit viewport (s4 allows exactly
            one). max-md:* only; at md and up both render exactly as before. */}
        {person.encounterId ? (
          <Link href={`/practice/encounters/${person.encounterId}`}
            className={`rounded-lg px-4 py-2 text-[13px] font-semibold max-md:flex max-md:min-h-[var(--cp-touch-primary)] max-md:w-full max-md:items-center max-md:justify-center max-md:text-[14px] ${BUTTON.primary}`}>
            Continue encounter →
          </Link>
        ) : person.patientId && canStartEncounter ? (
          <button type="button" disabled={busy} onClick={() => void start(person.patientId!)}
            className={`rounded-lg px-4 py-2 text-[13px] font-semibold max-md:flex max-md:min-h-[var(--cp-touch-primary)] max-md:w-full max-md:items-center max-md:justify-center max-md:text-[14px] ${BUTTON.primary} disabled:opacity-50`}>
            {busy ? "Opening the consultation…" : "Start encounter"}
          </button>
        ) : !person.patientId ? (
          // No dead controls: the button that cannot work is ABSENT and the reason is a sentence with
          // the route to fixing it.
          <div className="flex flex-col gap-1.5">
            <p className="text-[12px] text-amber-800">
              This arrival has no patient record attached, so an encounter cannot be started.
            </p>
            {/* #18: the cure lives on the card, not across the product. One search, one pick, and
                Start appears by the guard that was always here. The register link survives inside
                the component for the genuinely new. */}
            {canAttach && person.queueEntryId ? (
              <AttachRecordInline entryId={person.queueEntryId} prefillName={person.name} />
            ) : (
              <p className="text-[12px] text-amber-800">
                <Link href="/practice/patients" className="font-semibold underline">Find or register them first →</Link>
              </p>
            )}
          </div>
        ) : (
          <p className="text-[12px] text-gray-500">
            Starting an encounter needs a permission you do not hold here.
          </p>
        )}
        {person.patientId && (
          <Link href={`/practice/encounters/record/${person.patientId}`}
            className="text-[12px] font-semibold text-[var(--cp-primary)] hover:underline max-md:flex max-md:min-h-[var(--cp-touch)] max-md:items-center">
            Open record
          </Link>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">
          {error}
        </p>
      )}
    </section>
  );
}
