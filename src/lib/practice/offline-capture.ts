"use client";

import { outboxAccept } from "@/lib/practice/outbox-store";
// ⚠ FROM entity-types.ts, NEVER FROM THE APPLIER. Importing the constant from parameter-measurement.ts
// pulled parameters.ts -> access.ts -> next/headers into this client bundle and put /practice/offline on
// a 500. tsc, eslint and every harness stayed green. See entity-types.ts for the rule.
import { MEASUREMENT_ENTITY_TYPE, ENCOUNTER_ENTITY_TYPE, FOLLOWUP_ENTITY_TYPE } from "@/lib/practice/sync-appliers/entity-types";

// CP-OFFLINE-SURVEY-001 s5 — THE PRODUCER. The first thing in this product that accepts a write it
// cannot deliver today.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ THIS MODULE CROSSES THE LINE s5 DREW, AND IT MAY ONLY EXIST BECAUSE ALL SEVEN PRECONDITIONS HOLD.
//
//   1. durable local persistence, PROVEN BY TEST ...... practice-outbox-durability-harness.ts, in Chrome
//   2. a visible per-record delivery state ............ outbox-model.ts, surfaced in SyncCentre
//   3. idempotent server acceptance ................... sync-engine.ts + migration 284
//   4. a bounded failure path that escalates .......... escalation on attempts OR age
//   5. a conflict surface that exists ................. conflict-model.ts + /practice/sync
//   6. a recovery path for the undeliverable .......... outboxExport() + its download
//   7. local re-authentication (the owner's own) ...... offline-lock.ts, PIN -> KEK -> data key
//
// Precondition 1 was the last, and until 2026-08-11 it was UNSIGNABLE -- built and exercised by hand, in
// a repository with no browser test infrastructure. It is now proven against a real Chrome profile,
// including a renderer crash with no unload handler. **If any of the seven is ever weakened, this module
// is what has to be withdrawn.**
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ WHY IT VALIDATES HERE, WHEN THE APPLIER ALREADY VALIDATES ON THE SERVER.
//
// Not belt and braces. A refusal from the applier reaches the practitioner WHENEVER THE DEVICE NEXT
// REACHES THE PRACTICE -- which is the whole point of the feature, so it may be days -- on a sync screen,
// about a patient they saw on a different day and may not remember, with no way to go back and take the
// reading again.
//
// A refusal at the bedside costs five seconds and the patient is still in the room. So everything the
// server would refuse for is refused HERE FIRST, in the same words, while it can still be fixed. What
// remains on the server is the checks only the server can make -- does this patient exist, is this
// parameter retired, is it a calculated one.
//
// ⚠ THE TWO LISTS MUST NOT DRIFT. Where a rule exists on both sides it is the same sentence, and the
// harness asserts the shared ones match.

/** ⚠ Refused at capture, in the words the server would have used days later. */
export type CaptureRefusal = { ok: false; code: string; reason: string };
export type CaptureResult = { ok: true; recordId: string; entityId: string } | CaptureRefusal;

export const CAPTURE_NO_VALUE =
  "This reading carries no value, so there is nothing to record.";
export const CAPTURE_NO_TIME =
  "This reading does not say when it was taken. Because it was recorded without a connection, the practice cannot work that out, and filing it under today's date would be wrong.";
export const CAPTURE_FUTURE_TIME =
  "This reading is dated in the future, which usually means the clock on this device is wrong. It has not been recorded.";

/** The same allowance the applier makes for ordinary clock drift. One number, one meaning. */
export const CAPTURE_CLOCK_SKEW_MS = 5 * 60_000;

export type MeasurementCapture = {
  workspaceId: string;
  deviceId: string;
  userId: string;
  patientId: string;
  definitionId: string;
  value: number | string | boolean | string[];
  unit?: string | null;
  method?: string | null;
  /** ⚠ REQUIRED. When the observation was true of the patient -- see the applier. */
  effectiveAt: string;
  note?: string | null;
  encounterId?: string | null;
  at?: Date;
};

/**
 * Record one measurement on this device, for delivery later.
 *
 * ⚠⚠ THE CALLER MUST NOT TELL THE PRACTITIONER ANYTHING WAS RECORDED UNTIL THIS RETURNS `ok: true`.
 *
 * That is `outboxAccept`'s contract restated at the only other place it can be broken. s5: "the line is
 * crossed the moment any UI accepts input that the user reasonably believes is recorded -- and it is
 * crossed by the ACCEPTANCE, not by the failure." A screen that renders "Saved" optimistically and
 * handles the rejection quietly has already crossed it, whatever this function returns.
 *
 * ⚠ AND IT MUST NOT SAY "SENT", "SYNCED" OR "SAVED TO THE PRACTICE". Nothing has left the device. The
 * only true words are that it is held here and will be filed when there is a connection.
 */
export async function captureMeasurement(input: MeasurementCapture): Promise<CaptureResult> {
  const at = input.at ?? new Date();

  if (input.value === null || input.value === undefined || input.value === "")
    return { ok: false, code: "NO_VALUE", reason: CAPTURE_NO_VALUE };

  const effective = Date.parse(input.effectiveAt ?? "");
  if (!input.effectiveAt || Number.isNaN(effective))
    return { ok: false, code: "NO_TIME", reason: CAPTURE_NO_TIME };
  if (effective > at.getTime() + CAPTURE_CLOCK_SKEW_MS)
    return { ok: false, code: "FUTURE_TIME", reason: CAPTURE_FUTURE_TIME };

  // ⚠ THE ID IS MINTED HERE, ON THE DEVICE, AND THAT IS WHAT MAKES THE RETRY SAFE. The server's ledger
  // (migration 284) is keyed by the transaction id; a device that let the SERVER choose the identity
  // would have nothing stable to retry with, and a lost response would become a duplicate reading.
  const entityId = crypto.randomUUID();

  const accepted = await outboxAccept({
    workspaceId: input.workspaceId,
    deviceId: input.deviceId,
    userId: input.userId,
    entityType: MEASUREMENT_ENTITY_TYPE,
    entityId,
    operation: "create",
    payload: {
      patientId: input.patientId,
      definitionId: input.definitionId,
      value: input.value,
      unit: input.unit ?? null,
      method: input.method ?? null,
      effectiveAt: input.effectiveAt,
      note: input.note ?? null,
      encounterId: input.encounterId ?? null,
    },
    // ⚠ NULL, AND NOT A PLACEHOLDER. `baseVersion` is how an update says which version it was made
    // against. Nothing ever updates a measurement -- the table is append-only -- so there is no prior
    // version this was based on, and inventing 0 would claim one.
    baseVersion: null,
    at,
  });

  if (!accepted.ok)
    return { ok: false, code: "NOT_STORED", reason: accepted.reason };

  return { ok: true, recordId: accepted.record.id, entityId };
}

/**
 * ⚠ THE ONLY SENTENCE A SCREEN MAY PRINT AFTER A SUCCESSFUL CAPTURE.
 *
 * Every rejected alternative said something untrue: "Saved" (to what?), "Synced" (nothing was), "Sent"
 * (nothing left the device), "Recorded" on its own (the practice has no idea this exists). This says
 * exactly what happened and what has not happened yet.
 */
export const CAPTURE_HELD_NOTE =
  "Held on this device. It will be filed with the practice when there is a connection, and it stays here "
  + "until that is confirmed.";

// ── ENTITY TWO: A WHOLE VISIT ── (owner's order 2026-08-16: "Encounters then follow-up") ────────────
//
// ⚠ A CAPTURED VISIT IS A PAST, COMPLETED CONSULTATION -- paper notes typed up where they were made.
// The server files it as COMPLETED directly (offline-filing.ts) and can never resume or disturb a live
// encounter, which is what makes this entity safe to capture at all. Same preconditions, same contract,
// same refuse-at-the-bedside doctrine as the measurement above: everything the server would refuse for
// is refused HERE FIRST, in the same words, while the visit is still fresh enough to correct.

export const CAPTURE_VISIT_NO_TIME =
  "This visit does not say when it started and ended. Because it was recorded without a connection, the practice cannot work that out, and filing it under today would be wrong.";
export const CAPTURE_VISIT_END_BEFORE_START =
  "This visit ends before it starts, which usually means one of the two times was mistyped. It has not been recorded.";
export const CAPTURE_VISIT_FUTURE_TIME =
  "This visit is dated in the future, which usually means the clock on this device is wrong. It has not been recorded.";
export const CAPTURE_VISIT_NO_CONTENT =
  "This visit carries no notes at all, so there is nothing to record.";

export type EncounterCapture = {
  workspaceId: string;
  deviceId: string;
  userId: string;
  patientId: string;
  /** The DB vocabularies, restated on the screen as fixed pickers -- never free text. */
  pathway?: string | null;
  encounterMode?: string | null;
  reasonForVisit?: string | null;
  /** ⚠ BOTH REQUIRED, from the practitioner, never defaulted -- see the applier. */
  startedAt: string;
  endedAt: string;
  /** Keyed by note type (subjective/objective/assessment/plan/narrative). At least one non-empty. */
  notes: Record<string, string>;
  at?: Date;
};

/**
 * Record one whole visit on this device, for delivery later. Same contract as captureMeasurement:
 * nothing may be described as recorded until this returns `ok: true`, and nothing may ever be
 * described as saved, sent or synced -- CAPTURE_HELD_NOTE is the only sentence for success.
 */
export async function captureEncounter(input: EncounterCapture): Promise<CaptureResult> {
  const at = input.at ?? new Date();

  const started = Date.parse(input.startedAt ?? "");
  const ended = Date.parse(input.endedAt ?? "");
  if (!input.startedAt || !input.endedAt || Number.isNaN(started) || Number.isNaN(ended))
    return { ok: false, code: "NO_TIME", reason: CAPTURE_VISIT_NO_TIME };
  if (ended < started)
    return { ok: false, code: "END_BEFORE_START", reason: CAPTURE_VISIT_END_BEFORE_START };
  if (ended > at.getTime() + CAPTURE_CLOCK_SKEW_MS)
    return { ok: false, code: "FUTURE_TIME", reason: CAPTURE_VISIT_FUTURE_TIME };

  const notes: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.notes ?? {})) {
    if (typeof v === "string" && v.trim()) notes[k] = v.trim();
  }
  if (Object.keys(notes).length === 0)
    return { ok: false, code: "NO_CONTENT", reason: CAPTURE_VISIT_NO_CONTENT };

  const entityId = crypto.randomUUID();

  const accepted = await outboxAccept({
    workspaceId: input.workspaceId,
    deviceId: input.deviceId,
    userId: input.userId,
    entityType: ENCOUNTER_ENTITY_TYPE,
    entityId,
    operation: "create",
    payload: {
      patientId: input.patientId,
      pathway: input.pathway ?? null,
      encounterMode: input.encounterMode ?? null,
      reasonForVisit: input.reasonForVisit ?? null,
      startedAtIso: new Date(started).toISOString(),
      endedAtIso: new Date(ended).toISOString(),
      notes,
    },
    // Create-only entity: no prior version exists to have been based on. Same as measurements.
    baseVersion: null,
    at,
  });

  if (!accepted.ok)
    return { ok: false, code: "NOT_STORED", reason: accepted.reason };

  return { ok: true, recordId: accepted.record.id, entityId };
}

// ── ENTITY THREE: A FOLLOW-UP ── (owner's order 2026-08-16: "Encounters then follow-up") ────────────
//
// ⚠ RAISING an obligation, never closing, rescheduling or deferring one -- create-only keeps the
// conflict surface structurally closed, same as the two entities before it. On the server it goes
// through createFollowUp, the same engine the online product uses, so it lands on the board with the
// event row and audit every other follow-up gets.
//
// ⚠ THE ENTITY ID MINTED HERE BECOMES THE ROW'S PRIMARY KEY. The other entities mint it for the
// ledger; this one takes the doctrine to its conclusion, so a crashed sync's retry is absorbed by an
// exact id lookup rather than a natural-key reconstruction.

export const CAPTURE_FOLLOWUP_NO_REASON =
  "This follow-up does not say what it is for, so there is nothing to file.";
export const CAPTURE_FOLLOWUP_REASON_TOO_LONG =
  "The reason on this follow-up is longer than the record can hold (400 characters). Shorten it and it can be filed.";
export const CAPTURE_FOLLOWUP_NO_DUE =
  "This follow-up does not say when it is due. An obligation without a due date is one nobody will ever be reminded of, so it cannot be filed.";
export const CAPTURE_FOLLOWUP_BAD_DUE =
  "The due date on this follow-up could not be read, so it cannot be filed.";

export type FollowUpCapture = {
  workspaceId: string;
  deviceId: string;
  userId: string;
  patientId: string;
  /** What the obligation is for. Required -- the board is useless without it. */
  reason: string;
  /** YYYY-MM-DD, the practitioner's chosen date. ⚠ A PAST date is allowed -- "should have been seen
   * last week" is a legitimate obligation that arrives overdue, and refusing it would lose it. */
  dueOn: string;
  kind?: string | null;
  priority?: string | null;
  at?: Date;
};

/**
 * Raise one follow-up on this device, for delivery later. Same contract as the other captures:
 * nothing may be described as recorded until this returns `ok: true`, and CAPTURE_HELD_NOTE is the
 * only sentence for success.
 */
export async function captureFollowUp(input: FollowUpCapture): Promise<CaptureResult> {
  const at = input.at ?? new Date();

  const reason = (input.reason ?? "").trim();
  if (!reason)
    return { ok: false, code: "NO_REASON", reason: CAPTURE_FOLLOWUP_NO_REASON };
  if (reason.length > 400)
    return { ok: false, code: "REASON_TOO_LONG", reason: CAPTURE_FOLLOWUP_REASON_TOO_LONG };
  const dueOn = (input.dueOn ?? "").trim();
  if (!dueOn)
    return { ok: false, code: "NO_DUE", reason: CAPTURE_FOLLOWUP_NO_DUE };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn) || Number.isNaN(Date.parse(dueOn)))
    return { ok: false, code: "BAD_DUE", reason: CAPTURE_FOLLOWUP_BAD_DUE };

  // ⚠ The identity of the future ROW, not just of the retry -- see the header.
  const entityId = crypto.randomUUID();

  const accepted = await outboxAccept({
    workspaceId: input.workspaceId,
    deviceId: input.deviceId,
    userId: input.userId,
    entityType: FOLLOWUP_ENTITY_TYPE,
    entityId,
    operation: "create",
    payload: {
      patientId: input.patientId,
      reason,
      dueOn,
      kind: input.kind ?? null,
      priority: input.priority ?? null,
    },
    // Create-only entity: no prior version exists to have been based on.
    baseVersion: null,
    at,
  });

  if (!accepted.ok)
    return { ok: false, code: "NOT_STORED", reason: accepted.reason };

  return { ok: true, recordId: accepted.record.id, entityId };
}
