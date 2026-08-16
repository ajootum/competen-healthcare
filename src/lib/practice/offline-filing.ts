import { audit } from "@/lib/practice/audit";
import { NOTE_TYPES } from "@/lib/practice/encounter-constants";
import type { EngineResult } from "@/lib/practice/encounters";
import type { WorkspaceContext } from "@/lib/practice/access";
import { saveNoteSegment } from "@/lib/practice/documentation";
import { createFollowUp } from "@/lib/practice/follow-ups";
import { createCharge, recordPayment } from "@/lib/practice/billing";
import { PAYMENT_METHODS, BILLING_CAPTURE_CAPABILITIES } from "@/lib/practice/billing-constants";

// ── FILING AN OFFLINE VISIT ── CP offline capture, entity two (owner: "Encounters then follow-up") ──
//
// ⚠ THIS IS THE POST-HOC PATH, AND IT NEVER TOUCHES THE LIVE LIFECYCLE. A visit captured offline is a
// PAST, COMPLETED consultation -- paper notes typed up later. launchEncounter's resume-before-create
// would file them into whatever encounter happens to be OPEN for that patient today, which is exactly
// the wrong record. So this inserts status COMPLETED directly: the live-status partial index
// (ux_practice_encounter_live spans only DRAFT/ACTIVE/PAUSED) never sees it, a running consultation
// is never disturbed, and signing stays a live, deliberate act performed after review.
//
// ⚠ ITS OWN MODULE, NOT A NEW EXPORT OF encounters.ts, BECAUSE OF A ONE-WAY RULE ALREADY WRITTEN DOWN.
// The notes go through saveNoteSegment -- the same versioned write the online product uses, because a
// raw insert here would be the lenient way into the record: no version row (documentation.ts: "a
// history with a hole in it is worse than no history: it looks complete"), no note audit. But
// saveNoteSegment lives in documentation.ts, which imports editableEncounter FROM encounters.ts and
// records that "the dependency runs one way only". This module sits above both, so that stays true.
//
// ⚠ IDEMPOTENT ALL THE WAY THROUGH, NOT JUST AT THE FRONT. The sync ledger writes its row AFTER the
// apply, so a crash anywhere inside this function retries the WHOLE call. The natural key
// (workspace, patient, filed-by, exact started_at, COMPLETED) finds the half-filed encounter; the
// history rows are backfilled only if absent; and the notes converge because saveNoteSegment treats
// an identical body as a no-op that writes no version. A retry therefore completes a partial filing
// instead of duplicating it -- which is also why a note failure below maps to 500-retryable rather
// than a terminal refusal: at that point nothing is wrong with what the practitioner recorded.

/* eslint-disable @typescript-eslint/no-explicit-any */

// The DB CHECK constraints on practice_encounter, restated here so an out-of-vocabulary payload is
// REFUSED in words rather than thrown at the database -- a CHECK violation surfaces as a 500, the
// applier maps 500 to retryable, and the same payload would then poison the queue forever.
const PATHWAYS = ["booked", "new_walk_in", "walk_in_followup", "scheduled_followup"];
const MODES = ["in_person", "teleconsultation", "outreach", "home_visit", "hospital"];

const CLOCK_SKEW_MS = 5 * 60_000;

export async function fileOfflineEncounter(admin: any, args: {
  workspaceId: string; patientId: string;
  pathway?: string | null; encounterMode?: string | null; reasonForVisit?: string | null;
  startedAtIso: string; endedAtIso: string;
  notes: Partial<Record<(typeof NOTE_TYPES)[number], string>>;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; replayed: boolean }>> {
  const { data: patient } = await admin.from("practice_patient")
    .select("id, status").eq("id", args.patientId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!patient)
    return { ok: false, status: 404, code: "BAD_PATIENT", message: "that patient is not in this practice, so the visit cannot be filed" };
  // ⚠ NOT launchEncounter's "active only" rule. A visit with an ARCHIVED patient is refused live
  // because the archiving came first; here the VISIT came first -- it happened while the record may
  // still have been active -- and refusing to file real care against a since-archived record would
  // lose the notes. Only a MERGED record is refused, because it has a surviving twin the visit
  // belongs on, and filing against the dead half would split the patient's history in two.
  if (patient.status === "merged")
    return { ok: false, status: 422, code: "PATIENT_MERGED", message: "that patient record was merged into another. File this visit against the surviving record" };

  // ⚠ THE TIMES COME FROM THE DEVICE AND ARE REQUIRED, NOT DEFAULTED -- same doctrine as the
  // measurement applier. For a visit synced three days late, stamping NOW would file it as though
  // the patient was seen at the moment of the upload, which is a lie recorded as a clinical fact.
  const started = Date.parse(args.startedAtIso ?? "");
  const ended = Date.parse(args.endedAtIso ?? "");
  if (Number.isNaN(started) || Number.isNaN(ended))
    return { ok: false, status: 422, code: "NO_TIME", message: "this visit does not say when it started and ended, and filing it under today would be wrong" };
  if (ended < started)
    return { ok: false, status: 422, code: "END_BEFORE_START", message: "this visit ends before it starts, which usually means one of the two times was mistyped. It has not been filed" };
  if (ended > Date.now() + CLOCK_SKEW_MS)
    return { ok: false, status: 422, code: "FUTURE_TIME", message: "this visit is dated in the future, which usually means the clock on the device that recorded it was wrong. It has not been filed" };

  const noteEntries = NOTE_TYPES
    .map((t) => [t, (args.notes?.[t] ?? "").trim()] as const)
    .filter(([, body]) => body.length > 0);
  if (noteEntries.length === 0)
    return { ok: false, status: 422, code: "NO_CONTENT", message: "this visit carries no notes at all, so there is nothing to file" };

  // Absent metadata gets the same defaults the online engine uses; PRESENT-but-unrecognised metadata
  // is refused, never silently rewritten into something the practitioner did not record.
  const pathway = args.pathway?.trim() || "new_walk_in";
  const mode = args.encounterMode?.trim() || "in_person";
  if (!PATHWAYS.includes(pathway) || !MODES.includes(mode))
    return { ok: false, status: 422, code: "BAD_KIND", message: "this visit was recorded as a kind of visit this practice does not recognise, so it cannot be filed as captured" };

  // The natural-key replay check. String equality is safe here because BOTH sides are the same
  // normalisation of the same device timestamp -- this function is the only writer of these rows.
  const startedIso = new Date(started).toISOString();
  const endedIso = new Date(ended).toISOString();
  const { data: existing, error: findError } = await admin.from("practice_encounter")
    .select("id").eq("workspace_id", args.workspaceId).eq("patient_id", args.patientId)
    .eq("created_by", args.actorId).eq("started_at", startedIso).eq("status", "COMPLETED").maybeSingle();
  // ⚠ A FAILED read is not an EMPTY read. Treating it as "no duplicate" and inserting would mint the
  // twin this check exists to prevent, on exactly the flaky infrastructure that makes retries likely.
  if (findError)
    return { ok: false, status: 500, code: "REPLAY_CHECK_FAILED", message: findError.message };

  let encounterId = existing?.id as string | undefined;
  const replayed = Boolean(encounterId);

  if (!encounterId) {
    const { data: enc, error } = await admin.from("practice_encounter").insert({
      workspace_id: args.workspaceId, patient_id: args.patientId,
      entry_pathway: pathway, encounter_mode: mode,
      reason_for_visit: args.reasonForVisit?.trim() || null,
      status: "COMPLETED", started_at: startedIso, completed_at: endedIso,
      // ⚠ NO activity_id, AND THAT IS A STATEMENT, NOT AN OMISSION. The activity an encounter inherits
      // is "where the work started"; the actor's CURRENT running session is where the UPLOAD started.
      // encounters.ts already says null is an ordinary answer for an encounter outside any session.
      created_by: args.actorId,
    }).select("id").single();
    if (error)
      return { ok: false, status: 500, code: "WRITE_FAILED", message: error.message };
    encounterId = enc.id as string;
  }

  // The history walk, with the DEVICE's times. averageConsultMinutes reads this log, and an encounter
  // whose rows carried server time would report a three-day consultation. Backfilled on replay too,
  // because the crash window between the insert above and here is real.
  const { count: historyCount, error: historyReadError } = await admin.from("practice_encounter_status_history")
    .select("id", { count: "exact", head: true }).eq("encounter_id", encounterId);
  if (historyReadError)
    return { ok: false, status: 500, code: "HISTORY_READ_FAILED", message: historyReadError.message };
  if ((historyCount ?? 0) === 0) {
    const { error: historyError } = await admin.from("practice_encounter_status_history").insert([
      { workspace_id: args.workspaceId, encounter_id: encounterId, from_status: null, to_status: "DRAFT", actor_id: args.actorId, occurred_at: startedIso },
      { workspace_id: args.workspaceId, encounter_id: encounterId, from_status: "DRAFT", to_status: "ACTIVE", actor_id: args.actorId, occurred_at: startedIso },
      { workspace_id: args.workspaceId, encounter_id: encounterId, from_status: "ACTIVE", to_status: "COMPLETED", actor_id: args.actorId, occurred_at: endedIso },
    ]);
    if (historyError)
      return { ok: false, status: 500, code: "HISTORY_NOT_RECORDED", message: historyError.message };
  }

  // ⚠ THE SAME VERSIONED WRITE THE ONLINE PRODUCT USES. editableEncounter admits COMPLETED, the
  // version row and the practice.note_saved audit happen because they happen there, and the no-op
  // check is what makes a replay converge instead of stacking identical versions.
  //
  // source stays "typed" -- the practitioner DID type these notes, and the version table's CHECK
  // holds exactly the four online vocabularies. That the visit arrived offline is the ENCOUNTER's
  // story, carried by the audit event below and by the gap between started_at and created_at.
  for (const [noteType, body] of noteEntries) {
    const saved = await saveNoteSegment(admin, {
      workspaceId: args.workspaceId, encounterId, noteType, body,
      source: "typed", actorId: args.actorId, correlationId: args.correlationId,
    });
    // ⚠ MAPPED TO RETRYABLE WHATEVER saveNoteSegment SAID. Every payload fault was refused above,
    // so a failure here is infrastructure -- and a terminal refusal at this point would strand an
    // encounter that EXISTS with notes that do not, telling the practitioner their visit was
    // rejected when most of it is already in the record. The retry finds the encounter by natural
    // key and finishes the notes.
    if (!saved.ok)
      return { ok: false, status: 500, code: "NOTES_NOT_FILED", message: `the visit was filed but its notes were not all recorded, so it will be retried: ${saved.message}` };
  }

  if (!replayed) {
    await audit(admin, {
      workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.encounter_filed_offline",
      payload: {
        encounterId, patientId: args.patientId,
        startedAt: startedIso, endedAt: endedIso,
        noteTypes: noteEntries.map(([t]) => t),
      },
      correlationId: args.correlationId,
    });
  }

  return { ok: true, data: { id: encounterId, replayed } };
}

// ── FILING AN OFFLINE FOLLOW-UP ── entity three (owner's order: "Encounters then follow-up") ────────
//
// ⚠ IT WRAPS createFollowUp -- the same function every online caller uses -- so validation, the event
// row, the audit, the domain event and the activation hook all happen because they happen there. What
// this wrapper adds is exactly the offline concerns:
//
//   THE ROW ID IS THE DEVICE-MINTED ENTITY ID. offline-capture.ts already mints an entityId per
//   capture "because that is what makes the retry safe" -- this entity takes that doctrine to its
//   conclusion and makes it the PRIMARY KEY. The crash-between-apply-and-ledger replay check is then
//   an exact id lookup, not the natural-key reconstruction the encounter needs.
//
//   ⚠ A LATE VALIDATION_ERROR IS RE-MAPPED TO 500, AND THIS IS LOAD-BEARING. createFollowUp answers
//   400 VALIDATION_ERROR for a failed INSERT -- for an online caller a tolerable conflation, but the
//   applier maps < 500 to a TERMINAL refusal, so a transient database fault during the insert would
//   read as "the practice refused this obligation" and the capture would be abandoned. Every payload
//   fault is refused BEFORE the call (same sentences as the bedside), so a VALIDATION_ERROR that
//   comes back from the engine can only be the insert itself -- infrastructure, retryable -- except
//   the duplicate-key shape, which is the replay race and returns the row that won.

const DUE_ON_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function fileOfflineFollowUp(admin: any, args: {
  workspaceId: string; patientId: string;
  reason: string; dueOn: string; kind?: string | null; priority?: string | null;
  /** The device-minted capture identity -- becomes the row id. */
  entityId: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; replayed: boolean }>> {
  const reason = (args.reason ?? "").trim();
  if (!reason)
    return { ok: false, status: 422, code: "NO_REASON", message: "This follow-up does not say what it is for, so there is nothing to file." };
  if (reason.length > 400)
    return { ok: false, status: 422, code: "REASON_TOO_LONG", message: "The reason on this follow-up is longer than the record can hold (400 characters). Shorten it and it can be filed." };
  const dueOn = (args.dueOn ?? "").trim();
  if (!dueOn)
    return { ok: false, status: 422, code: "NO_DUE", message: "This follow-up does not say when it is due. An obligation without a due date is one nobody will ever be reminded of, so it cannot be filed." };
  if (!DUE_ON_RE.test(dueOn) || Number.isNaN(Date.parse(dueOn)))
    return { ok: false, status: 422, code: "BAD_DUE", message: "The due date on this follow-up could not be read, so it cannot be filed." };

  // The replay check -- an exact primary-key lookup, because the device minted the identity.
  const { data: existing, error: findError } = await admin.from("practice_follow_up")
    .select("id").eq("id", args.entityId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (findError)
    return { ok: false, status: 500, code: "REPLAY_CHECK_FAILED", message: findError.message };
  if (existing) return { ok: true, data: { id: existing.id as string, replayed: true } };

  const created = await createFollowUp(admin, {
    workspaceId: args.workspaceId, patientId: args.patientId,
    id: args.entityId,
    reason, dueOn,
    kind: args.kind ?? undefined, priority: args.priority ?? undefined,
    // ⚠ WELDED. A device cannot claim its obligation was raised by a document, an investigation or an
    // encounter row it cannot name -- "manual" is the one source that is true of a bedside capture,
    // and createFollowUp refuses the others without their origin anyway.
    source: "manual",
    actorId: args.actorId, correlationId: args.correlationId,
  });

  if (created.ok) return { ok: true, data: { id: created.data.id, replayed: false } };

  // NOT_FOUND is the engine's generic word for a missing patient. On a sync screen days later it has
  // to say whose record is missing, so it is renamed here rather than passed through.
  if (created.code === "NOT_FOUND")
    return { ok: false, status: 404, code: "BAD_PATIENT", message: "that patient is not in this practice, so the follow-up cannot be filed" };

  if (created.code === "VALIDATION_ERROR") {
    // The replay race: two retries both passed the check above and the primary key decided. The row
    // that won IS this capture -- same device-minted id -- so this is a success, not a failure.
    if (/duplicate|unique/i.test(created.message)) {
      const { data: raced } = await admin.from("practice_follow_up")
        .select("id").eq("id", args.entityId).eq("workspace_id", args.workspaceId).maybeSingle();
      if (raced) return { ok: true, data: { id: raced.id as string, replayed: true } };
    }
    // Anything else labelled VALIDATION_ERROR at this point is the INSERT failing -- see the header.
    return { ok: false, status: 500, code: "WRITE_FAILED", message: created.message };
  }

  return created;
}

// ── FILING A FIELD COLLECTION ── entity four (docs/CPR-PAY-PBI-SURVEY-001 D1, owner 2026-08-16) ─────
//
// Cash taken in the field becomes CHARGE + PAYMENT, through createCharge and recordPayment -- the
// same engines every online caller uses, so the fee snapshot rules, the receipt snapshot, the audit
// rows and the collected-versus-received doctrine all hold because they hold there. The survey's
// finding is what makes this small: a payment allocates to an UNINVOICED CHARGE today, so field cash
// needs no invoice and no credit ledger.
//
// ⚠ TWO WRITES, EACH IDEMPOTENT ITS OWN WAY, AND THE ORDER MATTERS:
//   PAYMENT -- the device-minted entityId is the row id (the follow-up pattern); the replay check is
//     an exact primary-key lookup and runs FIRST, because a payment that exists means the whole
//     filing finished.
//   CHARGE -- created with source_ref = the transaction id, which ux_practice_charge_source folds
//     into its unique key. A retry after a crash between the two writes (or after recordPayment's
//     own compensating delete -- numbering down at sync deletes the payment and throws) finds the
//     charge by that ref and REUSES it. Without this, every numbering outage would double-charge
//     the patient on the retry that follows it.
//
// ⚠ CAPABILITIES ARE CHECKED BEFORE THE FIRST WRITE, and that is orphan-avoidance, not decoration.
// createCharge wants invoice.draft and recordPayment wants payment.record; letting the engines
// refuse in their own order would create the charge and THEN refuse the payment, leaving an
// uninvoiced, unpaid charge on the patient's account from a filing that reported failure. Checked
// here, the refusal happens before anything exists. Terminal, with the honest sentence -- the money
// fact stays on the device, and the recovery path is the outbox's own (export, or re-entry online
// once the permission is granted).

export async function fileOfflineCollection(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; description: string;
  amountMinor: number; currency: string; method: string;
  collectedAtIso: string; collectedOn?: string | null;
  entityId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; receiptNumber: string | null; replayed: boolean }>> {
  if (!BILLING_CAPTURE_CAPABILITIES.every(c => ctx.capabilities.includes(c)))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "Recording money for this practice needs the billing permissions (payment.record and invoice.draft), which this account does not hold. Nothing was filed; the record stays on this device." };

  const { data: patient } = await admin.from("practice_patient")
    .select("id, status").eq("id", args.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!patient)
    return { ok: false, status: 404, code: "BAD_PATIENT", message: "that patient is not in this practice, so the payment cannot be filed" };
  if (patient.status === "merged")
    return { ok: false, status: 422, code: "PATIENT_MERGED", message: "that patient record was merged into another. File this payment against the surviving record" };

  const description = (args.description ?? "").trim();
  if (description.length < 2)
    return { ok: false, status: 422, code: "NO_DESCRIPTION", message: "This payment does not say what the money was for. The receipt has to answer that later, so it cannot be filed without it." };
  if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0)
    return { ok: false, status: 422, code: "NO_AMOUNT", message: "This payment does not say how much money was taken, so there is nothing to file." };
  if (typeof args.currency !== "string" || !/^[A-Z]{3}$/.test(args.currency))
    return { ok: false, status: 422, code: "BAD_CURRENCY", message: "This payment does not carry a readable currency, so the amount cannot mean anything. It has not been filed." };
  if (!PAYMENT_METHODS.some(([m]) => m === args.method))
    return { ok: false, status: 422, code: "BAD_METHOD", message: "This payment was recorded with a way of paying this practice does not recognise, so it cannot be filed as captured." };

  // ⚠ Device time, required, never defaulted -- the doctrine every capture entity shares. Money taken
  // on Monday and synced on Thursday is paid_at Monday; the arrival gap is created_at's story.
  const collected = Date.parse(args.collectedAtIso ?? "");
  if (Number.isNaN(collected))
    return { ok: false, status: 422, code: "NO_TIME", message: "This payment does not say when the money was taken. Because it was recorded without a connection, the practice cannot work that out, and filing it under today would be wrong." };
  if (collected > Date.now() + CLOCK_SKEW_MS)
    return { ok: false, status: 422, code: "FUTURE_TIME", message: "This payment is dated in the future, which usually means the clock on the device that recorded it was wrong. It has not been filed." };
  const collectedIso = new Date(collected).toISOString();
  // The DATE the money changed hands, on the practitioner's own clock where the device said so --
  // never the sync day, which is what createCharge would default to, three days late.
  const chargedOn = args.collectedOn && /^\d{4}-\d{2}-\d{2}$/.test(args.collectedOn)
    ? args.collectedOn : collectedIso.slice(0, 10);

  // The replay check that means "the whole filing finished" -- see the header.
  const { data: existingPay, error: payFindError } = await admin.from("practice_payment")
    .select("id").eq("id", args.entityId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (payFindError)
    return { ok: false, status: 500, code: "REPLAY_CHECK_FAILED", message: payFindError.message };
  if (existingPay) {
    const { data: rct } = await admin.from("practice_receipt")
      .select("receipt_number").eq("payment_id", args.entityId).maybeSingle();
    return { ok: true, data: { id: args.entityId, receiptNumber: (rct?.receipt_number as string) ?? null, replayed: true } };
  }

  // The charge half: find by the transaction ref first, create otherwise, and treat the unique
  // index's refusal as the race it is.
  let chargeId: string | null = null;
  const { data: existingCharge, error: chargeFindError } = await admin.from("practice_charge")
    .select("id").eq("workspace_id", ctx.workspaceId).eq("source", "manual").eq("source_ref", args.correlationId).maybeSingle();
  if (chargeFindError)
    return { ok: false, status: 500, code: "REPLAY_CHECK_FAILED", message: chargeFindError.message };
  chargeId = (existingCharge?.id as string) ?? null;

  if (!chargeId) {
    const charged = await createCharge(admin, ctx, {
      source: "manual", sourceRef: args.correlationId,
      patientId: args.patientId, description,
      unitAmountMinor: args.amountMinor, currency: args.currency,
      chargedOn, performedBy: args.actorId,
      actorId: args.actorId, correlationId: args.correlationId,
    });
    if (!charged.ok) {
      if (charged.code === "CHARGE_EXISTS") {
        const { data: raced } = await admin.from("practice_charge")
          .select("id").eq("workspace_id", ctx.workspaceId).eq("source", "manual").eq("source_ref", args.correlationId).maybeSingle();
        chargeId = (raced?.id as string) ?? null;
      }
      if (!chargeId) {
        // Every payload fault was refused above, so a refusal here is the INSERT failing --
        // infrastructure, retryable -- with the one exception already handled.
        if (charged.code === "VALIDATION_ERROR")
          return { ok: false, status: 500, code: "WRITE_FAILED", message: charged.message };
        return charged;
      }
    } else {
      chargeId = charged.data.id;
    }
  }

  const paid = await recordPayment(admin, ctx, {
    id: args.entityId,
    patientId: args.patientId, payerKind: "patient",
    amountMinor: args.amountMinor, currency: args.currency, method: args.method,
    // ⚠ WELDED. A device cannot claim the facility collected -- the person holding the device took
    // the money, and the whole collected-versus-received doctrine hangs on this column being true.
    collector: "practitioner",
    paidAtIso: collectedIso,
    allocations: [{ chargeId, amountMinor: args.amountMinor }],
    actorId: args.actorId, correlationId: args.correlationId,
  });

  if (paid.ok)
    return { ok: true, data: { id: paid.data.id, receiptNumber: paid.data.receiptNumber, replayed: false } };

  // The payment-id race: two retries both passed the check above; the primary key decided, and the
  // row that won IS this capture.
  if (paid.code === "VALIDATION_ERROR" && /duplicate|unique/i.test(paid.message)) {
    const { data: raced } = await admin.from("practice_payment")
      .select("id").eq("id", args.entityId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (raced) {
      const { data: rct } = await admin.from("practice_receipt")
        .select("receipt_number").eq("payment_id", args.entityId).maybeSingle();
      return { ok: true, data: { id: args.entityId, receiptNumber: (rct?.receipt_number as string) ?? null, replayed: true } };
    }
  }
  // Any other late VALIDATION_ERROR is the insert itself -- see the follow-up's header for the trap.
  // The 503s (NUMBERING_UNAVAILABLE, RECEIPT_FAILED) pass through >= 500 untouched: recordPayment
  // has already deleted the payment, so the retry re-runs this function, finds the CHARGE by its
  // ref, and only re-attempts the payment half.
  if (paid.code === "VALIDATION_ERROR")
    return { ok: false, status: 500, code: "WRITE_FAILED", message: paid.message };
  return paid;
}
