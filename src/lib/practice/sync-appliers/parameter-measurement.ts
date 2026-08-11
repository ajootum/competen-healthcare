import type { SyncApplier, SyncTransaction } from "@/lib/practice/sync-engine";
import { recordMeasurement } from "@/lib/practice/parameters";

// CP-OFFLINE-SURVEY-001 s5 — THE FIRST APPLIER. The server half of offline capture.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ WHY THIS ENTITY IS FIRST, AND IT IS NOT ARBITRARY.
//
// `parameters.ts:41`: "NOTHING IS EVER UPDATED IN practice_parameter_measurement." The table is
// APPEND-ONLY BY DOCTRINE -- a correction is a new row naming the old one, never a mutation. So two
// devices recording offline produce two rows, and an edit-vs-edit conflict is not merely unlikely, it is
// STRUCTURALLY IMPOSSIBLE.
//
// That matters because auto-merge is deliberately not built (conflict-model.ts: it needs a three-way
// comparison and this product stores no base values). An entity that can conflict would send every
// collision to a person on day one. This one cannot collide, so the first crossing of s5's line engages
// the least machinery.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ IT WRAPS THE ENGINE. IT DOES NOT REIMPLEMENT IT.
//
// The SyncApplier contract says so in as many words: "a parallel writer that skips the engine skips its
// validation, its audit and its events -- and the offline path would then be the LENIENT WAY INTO THE
// RECORD." So everything below is argument marshalling around one call to `recordMeasurement`, which is
// the same function `POST /api/v1/practice/parameters/measurements` calls. Plausibility warnings,
// canonical unit conversion, derived values, threshold alerts and the definition-version stamp all
// happen because they happen there.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ THE ONE THAT WOULD HAVE BEEN A REAL BUG: A TRANSIENT FAULT MUST THROW, NOT RETURN.
//
// sync-engine.ts's apply path treats the two outcomes completely differently:
//
//   THROWN            retryable: true, and NO LEDGER ROW -- the retry re-checks and re-applies
//   returned ok:false retryable: FALSE, ledger row written -- TERMINAL. The device escalates.
//
// `recordMeasurement` returns `fail(503, "UNAVAILABLE", ...)` when it merely could not READ the patient
// or the definition -- a database blip. Passing that straight through as `ok: false` would file a
// permanent refusal for a measurement that was never actually rejected: the practitioner would be told
// their work was declined, and the only copy would leave the retry loop.
//
// ⚠ That is migration 284's own history repeating through a different door -- "retryable is not status",
// the bug that "would have made devices abandon real consultations". So the mapping below is by HTTP
// class, and it is the most important thing in this file:
//
//   status >= 500  -> THROW. Transient. Nothing is recorded, the device keeps its copy, the retry runs.
//   status <  500  -> return ok:false. The server understood and will not do it. Retrying cannot help.

/** ⚠ APPEND-ONLY MEANS CREATE-ONLY. An update or delete here would contradict the table's own doctrine. */
export const MEASUREMENT_ENTITY_TYPE = "parameter_measurement";

type MeasurementPayload = {
  patientId?: unknown;
  definitionId?: unknown;
  value?: unknown;
  unit?: unknown;
  method?: unknown;
  effectiveAt?: unknown;
  note?: unknown;
  encounterId?: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * ⚠ A REFUSAL NAMES WHAT IS WRONG IN WORDS THE PRACTITIONER CAN ACT ON.
 *
 * This message is the only thing they will ever see about a measurement that cannot be filed -- it
 * reaches them days later, on a sync screen, about a patient they may not remember. "VALIDATION_ERROR"
 * would be worse than useless.
 */
function refuse(code: string, message: string) {
  return { ok: false as const, conflict: false as const, code, message };
}

export const parameterMeasurementApplier: SyncApplier = async (admin, ctx, tx: SyncTransaction) => {
  if (tx.operation !== "create")
    return refuse("APPEND_ONLY",
      "Measurements are only ever added, never changed or removed, so this could not be filed. A correction is recorded as a new reading that names the one it corrects.");

  const p = (tx.payload ?? {}) as MeasurementPayload;
  const patientId = str(p.patientId);
  const definitionId = str(p.definitionId);
  const effectiveAt = str(p.effectiveAt);

  if (!patientId || !UUID.test(patientId))
    return refuse("BAD_PATIENT", "This reading does not say which patient it belongs to, so it cannot be filed.");
  if (!definitionId || !UUID.test(definitionId))
    return refuse("BAD_PARAMETER", "This reading does not say which measurement it is, so it cannot be filed.");
  if (p.value === null || p.value === undefined || p.value === "")
    return refuse("NO_VALUE", "This reading carries no value, so there is nothing to file.");

  // ⚠ THE OBSERVATION TIME COMES FROM THE DEVICE AND IS REQUIRED, NOT DEFAULTED.
  //
  // `recordMeasurement` defaults `effective_at` to NOW when it is absent. For an online caller that is
  // right. For one that has been offline for three days it is a LIE recorded as a clinical fact: the
  // reading would be filed as though taken at the moment it happened to sync. So an offline transaction
  // that has lost its timestamp is refused rather than stamped with a plausible one.
  if (!effectiveAt || Number.isNaN(Date.parse(effectiveAt)))
    return refuse("NO_TIME",
      "This reading does not say when it was taken. Because it was recorded without a connection, the practice cannot work that out, and filing it under today's date would be wrong.");

  // ⚠ NOT IN THE FUTURE. A device clock is not authoritative and a reading dated tomorrow would sort
  // ahead of everything real. Small allowance for ordinary clock drift rather than an exact comparison.
  if (Date.parse(effectiveAt) > Date.now() + 5 * 60_000)
    return refuse("FUTURE_TIME",
      "This reading is dated in the future, which usually means the clock on the device that recorded it is wrong. It has not been filed.");

  const result = await recordMeasurement(admin, ctx, {
    patientId,
    definitionId,
    value: p.value as number | string | boolean | string[],
    unit: str(p.unit),
    method: str(p.method),
    // ⚠ WELDED, NOT TAKEN FROM THE PAYLOAD. `source` is one of LCP s12's five and it means who observed
    // this. A device that could name its own source could file a practitioner reading as device-generated
    // or vice versa, and s10.3 requires that distinction to be true on screen.
    source: "practitioner",
    effectiveAt,
    note: str(p.note),
    encounterId: str(p.encounterId),
    // ⚠⚠ `ctx.userId`, NEVER `tx.userId`. The transaction carries the user the DEVICE claims recorded it;
    // ctx carries the one who actually authenticated this upload. Trusting the payload would let a device
    // attribute a clinical observation to a colleague who never made it.
    actorId: ctx.userId,
    correlationId: tx.id,
  });

  if (result.ok)
    // ⚠ `version: null` IS CORRECT AND IS NOT A GAP. Version exists so an update can detect that somebody
    // moved first. Nothing ever updates this table, so there is no later write for a version to protect
    // and inventing one would imply an optimistic-concurrency check that does not apply.
    return { ok: true, version: null };

  // ⚠ THE MAPPING. See the header -- this is the line that decides whether a database blip loses work.
  if (result.status >= 500)
    throw new Error(`${result.code}: ${result.message}`);

  return refuse(result.code, result.message);
};

/**
 * ⚠ WHAT A PRACTITIONER IS TOLD ABOUT THE GAP BETWEEN TAKING A READING AND IT ARRIVING.
 *
 * `recordMeasurement` stamps `recorded_at` with the SERVER's clock, so a reading taken on Monday and
 * synced on Thursday is stored with effective_at Monday and recorded_at Thursday. That is not a defect
 * and it is deliberately not "fixed" by letting the device supply recorded_at:
 *
 *   - migration 246 defines recorded_at as when it reached the record, and a server-stamped time cannot
 *     be forged by a device;
 *   - the GAP between the two is exactly the offline delay, which is information a reviewer wants;
 *   - the alternative -- trusting a device clock for an audit timestamp -- weakens the one column that
 *     is currently trustworthy.
 *
 * ⚠ But it must be SAID, because a reader who does not know will read a three-day gap as three days of
 * negligence. This sentence is the one any screen showing a synced measurement should print.
 */
export const MEASUREMENT_DELAY_NOTE =
  "Readings recorded without a connection are filed when the device next reaches the practice. The time "
  + "it was taken is kept; the time it arrived is recorded separately, so a gap between them is the wait "
  + "for a connection rather than a delay in recording it.";
