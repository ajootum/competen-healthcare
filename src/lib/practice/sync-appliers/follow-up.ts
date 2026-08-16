import type { SyncApplier, SyncTransaction } from "@/lib/practice/sync-engine";
import { fileOfflineFollowUp } from "@/lib/practice/offline-filing";

export { FOLLOWUP_ENTITY_TYPE } from "@/lib/practice/sync-appliers/entity-types";

// ── THE OFFLINE FOLLOW-UP APPLIER ── entity three (owner's order: "Encounters then follow-up") ──────
//
// ⚠ IT WRAPS fileOfflineFollowUp, WHICH WRAPS createFollowUp -- the same engine every online caller
// uses, so the event row, the audit, the domain event and the activation hook all happen because they
// happen there. What belongs HERE is the applier's three usual things: the shape check on an
// untrusted device payload, the welds a device may never choose (actor identity, correlation id, and
// for this entity the ROW ID -- tx.entityId, minted on the device, becomes the follow-up's primary
// key, which is what makes the crash-window replay an exact lookup), and the HTTP-class mapping.
//
// ⚠ CREATE-ONLY, LIKE BOTH ENTITIES BEFORE IT. Closing, rescheduling or deferring an obligation
// offline would need base versions and the conflict story; RAISING one needs neither, because the
// row did not exist to conflict with. The conflict surface stays structurally closed.

type FollowUpPayload = {
  patientId?: unknown;
  reason?: unknown;
  dueOn?: unknown;
  kind?: unknown;
  priority?: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** ⚠ A refusal names what is wrong in words the practitioner can act on, days later, on a sync screen. */
function refuse(code: string, message: string) {
  return { ok: false as const, conflict: false as const, code, message };
}

export const followUpApplier: SyncApplier = async (admin, ctx, tx: SyncTransaction) => {
  if (tx.operation !== "create")
    return refuse("CREATE_ONLY",
      "Only a newly raised follow-up can be filed from a device. Closing, rescheduling or deferring one is done in the practice, where the obligation itself is open.");

  const p = (tx.payload ?? {}) as FollowUpPayload;
  const patientId = str(p.patientId);
  if (!patientId || !UUID.test(patientId))
    return refuse("BAD_PATIENT", "This follow-up does not say which patient it is for, so it cannot be filed.");

  // The wrapper re-checks these -- deliberate duplication, same sentences, one voice on the device.
  if (!str(p.reason))
    return refuse("NO_REASON", "This follow-up does not say what it is for, so there is nothing to file.");
  if (!str(p.dueOn))
    return refuse("NO_DUE", "This follow-up does not say when it is due. An obligation without a due date is one nobody will ever be reminded of, so it cannot be filed.");

  const result = await fileOfflineFollowUp(admin, {
    workspaceId: ctx.workspaceId,
    patientId,
    reason: str(p.reason)!,
    dueOn: str(p.dueOn)!,
    kind: str(p.kind),
    priority: str(p.priority),
    // ⚠⚠ THE WELDS. The row identity is the transaction's entityId -- minted on the device at capture,
    // which is what makes a replay exact. The actor is ctx.userId, never a payload field. The
    // correlation id is the transaction id, stitching the audit row to the capture.
    entityId: tx.entityId,
    actorId: ctx.userId,
    correlationId: tx.id,
  });

  if (result.ok)
    // A follow-up is born at record_version 1 (migration 196's default), and a replayed transaction
    // reports success identically -- the device's only question is "is this obligation on the board
    // now?", and either way the answer is yes.
    return { ok: true, version: 1 };

  // ⚠ THE MAPPING. >= 500 is infrastructure -- THROW, no ledger row, retry (the primary-key replay
  // check makes that retry exact). < 500 is the practice refusing the obligation: final, ledgered,
  // shown to the practitioner in the words above. The wrapper has already re-mapped createFollowUp's
  // insert-failure VALIDATION_ERROR to 500, so a database blip cannot masquerade as a refusal here.
  if (result.status >= 500)
    throw new Error(`${result.code}: ${result.message}`);

  return refuse(result.code, result.message);
};

/**
 * The sentence for a follow-up still waiting on the device -- same voice as the other two entities.
 * The due date needs its own truth told: the obligation is not on the practice's board until the
 * device syncs, so a follow-up due tomorrow that has not synced is visible to nobody but this screen.
 */
export const FOLLOWUP_DELAY_NOTE =
  "Follow-ups recorded without a connection reach the practice's board when the device next connects. "
  + "Until then the obligation is held here and nowhere else -- if it falls due before this device "
  + "syncs, no reminder can fire, because the practice does not yet know it exists.";
