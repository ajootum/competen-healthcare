import type { SyncApplier, SyncTransaction } from "@/lib/practice/sync-engine";
import { fileOfflineCollection } from "@/lib/practice/offline-filing";

export { COLLECTION_ENTITY_TYPE } from "@/lib/practice/sync-appliers/entity-types";

// ── THE FIELD-COLLECTION APPLIER ── entity four (docs/CPR-PAY-PBI-SURVEY-001 D1) ────────────────────
//
// ⚠ IT WRAPS fileOfflineCollection, WHICH WRAPS createCharge + recordPayment -- the same billing
// engines every online caller uses. Money gets the same three applier duties as clinical data and
// not one more: the shape check on an untrusted payload, the welds a device may never choose, and
// the HTTP-class mapping. Everything financial -- the fee rules, the receipt snapshot, the
// collected-versus-received doctrine, the capability gates -- lives in the engines.
//
// ⚠ THE WELDS ARE THE FRAUD SURFACE HERE, so they are named: the actor is ctx.userId (an upload
// cannot attribute cash-handling to a colleague); the payment row id is tx.entityId (replays are
// exact); the collector is welded "practitioner" INSIDE the filing engine (a device cannot claim
// the facility took the money); and the receipt number is allocated AT SYNC by the practice's own
// counter -- nothing receipt-shaped ever existed in the field.
//
// ⚠ CREATE-ONLY, LIKE EVERY ENTITY BEFORE IT. Refunds, adjustments and settlements are online acts
// against records that exist; a capture records the one fact only the field knew.

type CollectionPayload = {
  patientId?: unknown;
  description?: unknown;
  amountMinor?: unknown;
  currency?: unknown;
  method?: unknown;
  collectedAtIso?: unknown;
  collectedOn?: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** ⚠ A refusal names what is wrong in words the practitioner can act on, days later, on a sync screen. */
function refuse(code: string, message: string) {
  return { ok: false as const, conflict: false as const, code, message };
}

export const fieldCollectionApplier: SyncApplier = async (admin, ctx, tx: SyncTransaction) => {
  if (tx.operation !== "create")
    return refuse("CREATE_ONLY",
      "Only money newly taken can be filed from a device. Refunds, corrections and settlements are done in the practice, where the records they answer to are open.");

  const p = (tx.payload ?? {}) as CollectionPayload;
  const patientId = str(p.patientId);
  if (!patientId || !UUID.test(patientId))
    return refuse("BAD_PATIENT", "This payment does not say which patient it came from, so it cannot be filed.");

  // The filing engine re-checks all of this -- deliberate duplication, same sentences, one voice.
  if (!str(p.description))
    return refuse("NO_DESCRIPTION", "This payment does not say what the money was for. The receipt has to answer that later, so it cannot be filed without it.");
  if (typeof p.amountMinor !== "number" || !Number.isInteger(p.amountMinor) || p.amountMinor <= 0)
    return refuse("NO_AMOUNT", "This payment does not say how much money was taken, so there is nothing to file.");
  if (!str(p.collectedAtIso))
    return refuse("NO_TIME", "This payment does not say when the money was taken. Because it was recorded without a connection, the practice cannot work that out, and filing it under today would be wrong.");

  const result = await fileOfflineCollection(admin, ctx, {
    patientId,
    description: str(p.description)!,
    amountMinor: p.amountMinor,
    currency: typeof p.currency === "string" ? p.currency : "",
    method: str(p.method) ?? "",
    collectedAtIso: str(p.collectedAtIso)!,
    collectedOn: str(p.collectedOn),
    // ⚠⚠ THE WELDS -- see the header. tx.entityId becomes the payment row's primary key.
    entityId: tx.entityId,
    actorId: ctx.userId,
    correlationId: tx.id,
  });

  if (result.ok)
    // The payment row exists at its one and only version. Never null -- migration 284 requires an
    // applied create to carry a version, and a null here silently drops the ledger row and the
    // dedup with it (the lesson entity two's harness taught; see parameter-measurement.ts).
    return { ok: true, version: 1 };

  // ⚠ THE MAPPING. >= 500 is infrastructure -- THROW, no ledger row, retry (the payment-id and
  // charge-ref replay checks make that retry exact, including after a numbering outage's
  // compensating delete). < 500 is the practice refusing the money: final, ledgered, shown in the
  // practitioner's words. The filing engine has already re-mapped the engines' insert-failure
  // VALIDATION_ERRORs to 500, so a database blip cannot masquerade as a refusal.
  if (result.status >= 500)
    throw new Error(`${result.code}: ${result.message}`);

  return refuse(result.code, result.message);
};

/**
 * The sentence for money still waiting on the device. It has a truth the other entities do not:
 * the patient already parted with the cash, and until sync the practice's books do not know.
 */
export const COLLECTION_DELAY_NOTE =
  "Money recorded without a connection reaches the practice's books when the device next connects. "
  + "The time it was taken is kept, and the numbered receipt is issued at that point -- not before, "
  + "because a receipt number belongs to the practice's own counter, not to any one device.";
