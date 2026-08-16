import type { SyncApplier, SyncTransaction } from "@/lib/practice/sync-engine";
import { fileOfflineEncounter } from "@/lib/practice/offline-filing";

export { ENCOUNTER_ENTITY_TYPE } from "@/lib/practice/sync-appliers/entity-types";

// ── THE OFFLINE VISIT APPLIER ── entity two of the capture arc (owner: "Encounters then follow-up") ──
//
// ⚠ IT WRAPS fileOfflineEncounter AND NOTHING ELSE. The applier is a WELD, not an engine: every
// clinical rule -- patient in workspace, times sane, at least one note, and the natural-key replay
// check that makes a crashed sync safe to retry -- lives in the engine. What belongs HERE is exactly
// three things: the shape check on an untrusted device payload, the welds a device is never allowed
// to choose (actor identity, correlation id), and the HTTP-class mapping.
//
// ⚠ CREATE-ONLY, LIKE THE MEASUREMENT APPLIER, AND FOR THE SAME STRUCTURAL REASON. An offline EDIT of
// an existing encounter would need base versions and the whole conflict story; an offline CAPTURE of
// a past, completed visit needs neither, because the row it creates did not exist to conflict with.
// The engine it wraps files status COMPLETED directly -- it deliberately does NOT take
// launchEncounter's resume-before-create path, which would file three-day-old notes into whatever
// encounter happens to be OPEN for that patient today. That is the hazard this entity was designed
// around, and the harness pins it with a live-encounter non-interference control.

type VisitPayload = {
  patientId?: unknown;
  pathway?: unknown;
  encounterMode?: unknown;
  reasonForVisit?: unknown;
  startedAtIso?: unknown;
  endedAtIso?: unknown;
  notes?: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * ⚠ A REFUSAL NAMES WHAT IS WRONG IN WORDS THE PRACTITIONER CAN ACT ON. It reaches them days later,
 * on a sync screen, about a visit they may only half remember -- "VALIDATION_ERROR" would be useless.
 */
function refuse(code: string, message: string) {
  return { ok: false as const, conflict: false as const, code, message };
}

export const encounterVisitApplier: SyncApplier = async (admin, ctx, tx: SyncTransaction) => {
  if (tx.operation !== "create")
    return refuse("CREATE_ONLY",
      "Only a newly captured visit can be filed from a device. Changing a visit that is already in the practice record is done in the practice, where the record itself is open.");

  const p = (tx.payload ?? {}) as VisitPayload;
  const patientId = str(p.patientId);
  if (!patientId || !UUID.test(patientId))
    return refuse("BAD_PATIENT", "This visit does not say which patient it belongs to, so it cannot be filed.");

  // The engine re-checks times and notes -- the duplication is deliberate, and the sentences match,
  // so the device speaks with one voice whichever layer refuses first.
  const startedAtIso = str(p.startedAtIso);
  const endedAtIso = str(p.endedAtIso);
  if (!startedAtIso || !endedAtIso)
    return refuse("NO_TIME",
      "This visit does not say when it started and ended. Because it was recorded without a connection, the practice cannot work that out, and filing it under today would be wrong.");

  const notes = (typeof p.notes === "object" && p.notes !== null && !Array.isArray(p.notes)
    ? p.notes : {}) as Record<string, string>;

  const result = await fileOfflineEncounter(admin, {
    workspaceId: ctx.workspaceId,
    patientId,
    pathway: str(p.pathway) ?? "new_walk_in",
    encounterMode: str(p.encounterMode) ?? "in_person",
    reasonForVisit: str(p.reasonForVisit),
    startedAtIso,
    endedAtIso,
    notes,
    // ⚠⚠ THE WELDS. `ctx.userId`, NEVER anything from the payload -- the transaction carries the user
    // the DEVICE claims held it; ctx carries the one who actually authenticated this upload. And the
    // correlation id is the outbox transaction id minted on the device, which is what stitches the
    // practice.encounter_filed_offline audit row back to the capture.
    actorId: ctx.userId,
    correlationId: tx.id,
  });

  if (result.ok)
    // ⚠ `version: 1` -- practice_encounter.record_version's actual starting value -- and NOT null,
    // because migration 284 requires an applied create to carry a version and a null here means the
    // ledger row is silently dropped and the dedup with it (the measurement applier shipped that way;
    // see its comment for the full account). A REPLAYED transaction reports success identically to a
    // first filing -- the device's only question is "is this visit in the practice record now?", and
    // either way the answer is yes.
    return { ok: true, version: 1 };

  // ⚠ THE MAPPING -- the line that decides whether a database blip loses a visit. >= 500 is
  // infrastructure: nothing was decided, THROW, no ledger row, the transaction retries (and the
  // engine's natural-key check makes that retry safe). < 500 is the practice REFUSING the visit:
  // final, ledgered, shown to the practitioner in the words above.
  if (result.status >= 500)
    throw new Error(`${result.code}: ${result.message}`);

  return refuse(result.code, result.message);
};

/**
 * ⚠ WHAT A PRACTITIONER IS TOLD ABOUT A VISIT STILL WAITING ON THE DEVICE. Same voice as
 * MEASUREMENT_DELAY_NOTE: what is true now, what will happen, and that nothing is lost. The filed
 * encounter keeps the DEVICE's start and end times; the practice separately records when it arrived,
 * so a gap between them is the wait for a connection rather than a delay in seeing the patient.
 */
export const VISIT_DELAY_NOTE =
  "Visits recorded without a connection are filed when the device next reaches the practice. The times "
  + "the visit actually started and ended are kept; the practice separately records when it arrived, so "
  + "a gap between them is the wait for a connection rather than anything about the care itself.";
