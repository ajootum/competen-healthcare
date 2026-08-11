"use client";

import {
  outboxDueAt, outboxMarkConflict, outboxMarkDelivered, outboxMarkFailed, outboxMarkRefused,
  outboxSendable, type OutboxRecord,
} from "@/lib/practice/outbox-model";
import { outboxLoad, outboxSave } from "@/lib/practice/outbox-store";
import { SYNC_MAX_BATCH } from "@/lib/practice/sync-limits";

// CP-OFFLINE-SURVEY-001 s5 — THE DELIVERY HALF. What actually sends what capture accepted.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ WITHOUT THIS MODULE, CAPTURE IS THE FAILURE s5 IS ABOUT.
//
// Capture and the applier shipped on 2026-08-11 and nothing called /api/v1/practice/sync/upload -- the
// route existed with ZERO callers. So a practitioner could record a reading, be told truthfully that it
// was held on the device, and it would sit there for ever. That is precisely the survey's own sentence:
//
//   "A queued note that never syncs is BELIEVED TO BE SAVED by the only person who could rewrite it.
//    The record is gone and no one is looking for it."
//
// The acceptance existed without the delivery. This is the delivery.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ THE DECISION THIS FILE TURNS ON: `sending` IS NEVER WRITTEN TO DISK.
//
// The obvious implementation marks each record `sending`, saves it, POSTs, then saves the verdict. It is
// wrong, and the way it is wrong is a permanent loss:
//
//   `outboxSendable` takes only `pending` and `failed`. A record persisted as `sending` is in NEITHER.
//   So a crash, a closed lid or a killed tab between the save and the response STRANDS that record in a
//   state nothing will ever pick up again. It is not delivered, it is not retried, and it counts in the
//   queue for ever.
//
// A crash must therefore leave the record exactly as it was -- `pending` -- so the next run sends it
// again. ⚠ RE-SENDING IS SAFE AND THAT IS NOT AN ASSUMPTION: migration 284's ledger is keyed by the
// transaction id, consulted BEFORE the apply, so the second attempt is answered `duplicate` rather than
// applied twice. Idempotent acceptance is precondition 3, and this is the thing it was for.
//
// The cost, stated: a record can be applied by the server and lose its response, so the device sends it
// once more. That costs one round trip. The alternative costs a consultation.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ AND THE VERDICT MAPPING, WHICH IS THE OTHER PLACE WORK GETS LOST.
//
//   applied              -> delivered
//   conflict             -> conflicted   (does NOT count an attempt: it arrived and was answered)
//   refused + retryable  -> FAILED       (transient: the retry loop keeps it, backoff applies)
//   refused + !retryable -> refused      (terminal: escalates to a person at once)
//
// ⚠ THE THIRD LINE IS THE ONE. `retryable` is not the status -- migration 284's own history. A ledger
// that would not read, or an applier that threw, comes back as `refused` WITH `retryable: true`, and a
// client that took the status at face value would abandon a real consultation over a database blip.

export type UploadOutcome = {
  /** How many records were sent in this run. Zero is a normal, healthy answer. */
  attempted: number;
  delivered: number;
  failed: number;
  refused: number;
  conflicted: number;
  /** Held back because an earlier change to the same entity needs a person. Never silent. */
  blocked: number;
  /** Waiting on backoff. Not a problem -- said so a screen can explain a queue that is not moving. */
  waiting: number;
  /**
   * ⚠ NULL WHEN THE RUN COMPLETED, whatever the individual verdicts were. A sentence here means the run
   * itself could not proceed, which is a different thing from records that were refused.
   */
  problem: string | null;
};

const EMPTY: UploadOutcome = {
  attempted: 0, delivered: 0, failed: 0, refused: 0, conflicted: 0, blocked: 0, waiting: 0, problem: null,
};

type Verdict = {
  id: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  duplicate: boolean;
  conflict?: {
    currentVersion: number | null;
    theirs: Record<string, unknown>;
    labels: Record<string, string>;
    insignificant: string[];
  };
};

/** The wire shape. Built field by field -- a spread would put outbox bookkeeping on the wire. */
function toTransaction(r: OutboxRecord) {
  return {
    id: r.id,
    deviceId: r.deviceId,
    entityType: r.entityType,
    entityId: r.entityId,
    operation: r.operation,
    payload: r.payload,
    baseVersion: r.baseVersion,
    // ⚠ THE OUTBOX CALLS IT `sequence`, THE WIRE CALLS IT `clientSequence`. Same number, and the server
    // re-sorts by it: an update applied before its create fails against a row that does not exist.
    clientSequence: r.sequence,
    // ⚠ WHEN THE PRACTITIONER ACTED, never when it synced. The clinical instant travels with the work.
    occurredAt: r.createdAt,
  };
}

/**
 * Send what is waiting. Safe to call at any time, including with nothing to send.
 *
 * ⚠ IT NEVER DELETES ANYTHING AND NEVER RESOLVES A CONFLICT. Both are a person's decision, and this runs
 * unattended.
 */
export async function uploadOutbox(
  opts: { at?: Date; fetchImpl?: typeof fetch } = {},
): Promise<UploadOutcome> {
  const at = opts.at ?? new Date();
  const doFetch = opts.fetchImpl ?? fetch;

  const loaded = await outboxLoad();
  // ⚠ AN UNREADABLE RECORD DOES NOT STOP THE RUN. outboxLoad reports it and returns what it could read;
  // holding back the readable work because one record is corrupt would turn one loss into many.
  const sendable = outboxSendable(loaded.records);

  // ⚠ BACKOFF IS RESPECTED HERE, NOT ON THE SERVER. A device with no connection retries every time this
  // is called; without this filter a failing record would be re-sent on every online event, every page
  // load and every timer, which is how a phone's battery and a practice's rate limit both go.
  const due = sendable.filter(r => outboxDueAt(r) <= at.getTime());
  const waiting = sendable.length - due.length;
  const blocked = loaded.records.filter(
    r => (r.state === "pending" || r.state === "failed") && !sendable.includes(r),
  ).length;

  if (due.length === 0)
    return { ...EMPTY, waiting, blocked, problem: loaded.detail };

  // ⚠ CAPPED TO THE SERVER'S OWN CEILING. The route refuses an oversized batch WHOLE rather than
  // truncating it, so a client that sent more would have everything rejected and nothing filed.
  const batch = due.slice(0, SYNC_MAX_BATCH);

  // ⚠ NOTHING IS WRITTEN BEFORE THE REQUEST. See the header: a persisted `sending` is a state
  // `outboxSendable` cannot return, so a crash here would strand the record for ever.

  let verdicts: Verdict[];
  try {
    const res = await doFetch("/api/v1/practice/sync/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ transactions: batch.map(toTransaction) }),
    });

    if (!res.ok) {
      // ⚠ EVERY NON-OK IS TREATED AS TRANSIENT, INCLUDING 401 AND 403, AND THAT IS DELIBERATE.
      //
      // A refusal here is about the REQUEST, not about the clinical content -- the session expired, the
      // device was signed out, the server is restarting. All of those are fixed by signing in again, and
      // marking the work `refused` would escalate a recoverable problem to a person as though the
      // practice had rejected their consultation. Backoff and the attempt ceiling still apply, so a
      // genuinely permanent 403 escalates on its own after OUTBOX_MAX_ATTEMPTS rather than instantly.
      const problem = `The practice could not be reached (${res.status}). Nothing was filed, and everything is still on this device.`;
      let failed = 0;
      for (const r of batch) {
        const saved = await outboxSave(outboxMarkFailed(r, problem, at));
        if (saved.ok) failed++;
      }
      return { ...EMPTY, attempted: batch.length, failed, waiting, blocked, problem };
    }

    const body = await res.json() as { verdicts?: Verdict[] };
    verdicts = Array.isArray(body.verdicts) ? body.verdicts : [];
  } catch (e) {
    // Offline, or the request died in flight. Transient by definition.
    const problem = `The practice could not be reached: ${String((e as Error)?.message ?? e).slice(0, 160)}. Everything is still on this device.`;
    let failed = 0;
    for (const r of batch) {
      const saved = await outboxSave(outboxMarkFailed(r, problem, at));
      if (saved.ok) failed++;
    }
    return { ...EMPTY, attempted: batch.length, failed, waiting, blocked, problem };
  }

  const byId = new Map(verdicts.map(v => [v.id, v]));
  const out: UploadOutcome = { ...EMPTY, attempted: batch.length, waiting, blocked, problem: loaded.detail };

  for (const record of batch) {
    const v = byId.get(record.id);

    // ⚠ A RECORD THE RESPONSE DID NOT MENTION IS NOT DELIVERED. Treating an absent verdict as success is
    // exactly how a queue reports "all sent" for work the server never saw. It is marked failed, so it is
    // retried -- and the ledger makes that retry harmless.
    if (!v) {
      const saved = await outboxSave(outboxMarkFailed(
        record, "The practice's reply did not mention this item, so it is not known to have been filed.", at));
      if (saved.ok) out.failed++;
      continue;
    }

    if (v.status === "applied") {
      // ⚠ `duplicate` IS A SUCCESS. It means the ledger already held this transaction -- the work is on
      // the server and this device simply lost the first reply. Anything else would re-send for ever.
      const saved = await outboxSave(outboxMarkDelivered(record));
      if (saved.ok) out.delivered++;
      continue;
    }

    if (v.status === "conflict" && v.conflict) {
      const saved = await outboxSave(outboxMarkConflict(
        record, v.errorMessage ?? "Somebody else changed this first.", { ...v.conflict }, at));
      if (saved.ok) out.conflicted++;
      continue;
    }

    // ⚠ THE MAPPING THE HEADER IS ABOUT. `retryable` decides, never the status.
    if (v.retryable) {
      const saved = await outboxSave(outboxMarkFailed(
        record, v.errorMessage ?? "The practice could not file this just now.", at));
      if (saved.ok) out.failed++;
      continue;
    }

    const saved = await outboxSave(outboxMarkRefused(
      record, v.errorMessage ?? "The practice did not accept this.", at));
    if (saved.ok) out.refused++;
  }

  return out;
}

/**
 * ⚠ THE SENTENCE A SCREEN MAY PRINT AFTER A RUN, AND WHY IT IS NOT "SYNCED".
 *
 * "Synced" is a claim about the whole queue. A run sends at most one batch and may leave records waiting
 * on backoff, blocked behind a refusal, or needing a person -- so a screen that says "synced" after a
 * partial run tells a practitioner their work has arrived when some of it has not.
 */
export function uploadSentence(outcome: UploadOutcome): string {
  if (outcome.problem && outcome.attempted === 0) return outcome.problem;
  if (outcome.attempted === 0)
    return outcome.waiting > 0
      ? `Nothing was sent just now. ${outcome.waiting} item${outcome.waiting === 1 ? " is" : "s are"} waiting before being tried again.`
      : "There is nothing waiting to be sent.";

  const parts: string[] = [];
  if (outcome.delivered > 0) parts.push(`${outcome.delivered} filed with the practice`);
  if (outcome.failed > 0) parts.push(`${outcome.failed} not sent yet and still here`);
  if (outcome.conflicted > 0) parts.push(`${outcome.conflicted} needs a decision`);
  if (outcome.refused > 0) parts.push(`${outcome.refused} was not accepted`);
  const tail = outcome.blocked > 0
    ? ` ${outcome.blocked} more ${outcome.blocked === 1 ? "is" : "are"} held back behind an earlier item that needs a person.`
    : "";
  return `${parts.join(", ")}.${tail}`;
}
