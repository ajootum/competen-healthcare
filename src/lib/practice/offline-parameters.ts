// CP-OFFLINE-SURVEY-001 — THE PARAMETER DEFINITIONS A DEVICE NEEDS IN ORDER TO RECORD ANYTHING.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THE OWNER'S RULE, 2026-08-08, AND IT DISSOLVES MOST OF THE TENSION IN THIS PROGRAMME:
//
//     "PARAMETER DEFINITIONS ARE NOT PATIENT DATA -- CACHE THEM ALL, ALWAYS. To RECORD a measurement
//      offline you need the DEFINITION and a PATIENT IDENTITY, not the history. Only parameter
//      MEASUREMENTS are patient data."
//
// So this cache names nobody, discloses nothing about any person's care, and is the cheapest thing in the
// whole offline programme. A device holding it discloses that a practice measures blood pressure.
//
// ⚠⚠ AND BECAUSE OF THAT IT IS STORED UNSEALED, WHICH IS NOT LAZINESS -- IT IS THE DECISION.
//
// The day and the clinical carry are sealed behind the PIN. If the definitions were too, then a
// practitioner who had forgotten their PIN could not RECORD either -- and the owner's decision of
// 2026-08-10 is explicit that the PIN gates COPIES and never CAPTURED WORK, because captured work is the
// only copy in existence. The outbox is already exempt (its own database, unreachable from any purge).
// Sealing the definitions would have re-introduced the block through the back door: nothing to choose
// from, so nothing to record.
//
// The consequence, stated: a locked device can still take a reading. It cannot show you the clinic list
// or the allergy panel while it is locked, but it will not stop you writing down a blood pressure.

/** Bumped when the shape below changes. An older record is discarded, never migrated. */
export const OFFLINE_PARAMETERS_SCHEMA_VERSION = 1;

/**
 * ⚠ LONGER THAN THE CLINICAL CARRY'S FIVE DAYS, AND FOR THE OPPOSITE REASON.
 *
 * Nothing here is patient data, so the disclosure argument that shortened the other caches does not
 * apply. What DOES apply is that a definition can be RETIRED or have its plausibility bounds changed
 * while the device is away, and a device that never reconnects must eventually stop offering it. Thirty
 * days is long enough that the definitions are never the reason a trip fails, and short enough that a
 * retired parameter cannot be offered for ever.
 */
export const OFFLINE_PARAMETERS_MAX_DAYS = 30;

/** A practice may install large packs. Reported when it bites -- see `dropped`. */
export const OFFLINE_PARAMETERS_MAX = 200;

export type OfflineParameterOption = { value: string; label: string };

export type OfflineParameter = {
  id: string;
  code: string;
  displayName: string;
  shortName: string | null;
  category: string;
  /** decimal | integer | boolean | date | text | single_choice | multi_choice. ⚠ Never `calculated`. */
  dataType: string;
  canonicalUnit: string | null;
  permittedUnits: string[];
  valuePrecision: number | null;
  /** ⚠ These WARN, they never refuse -- migration 246 s1. The device must behave the same way. */
  minPlausible: number | null;
  maxPlausible: number | null;
  options: OfflineParameterOption[];
};

export type OfflineParameterSet = {
  schemaVersion: number;
  workspaceId: string;
  asOf: string;
  expiresAt: string;
  parameters: OfflineParameter[];
  /** ⚠ A FAILED READ IS NOT AN EMPTY SET. */
  unavailable: boolean;
  dropped: { count: number; reason: string } | null;
};

export const OFFLINE_PARAMETER_KEYS: readonly (keyof OfflineParameter)[] = [
  "id", "code", "displayName", "shortName", "category", "dataType", "canonicalUnit",
  "permittedUnits", "valuePrecision", "minPlausible", "maxPlausible", "options",
] as const;

/**
 * ⚠ WHAT MAY NEVER BE CACHED, AND ONE OF THESE IS A CLINICAL SAFETY RULE RATHER THAN A PRIVACY ONE.
 *
 * `unit_conversions` is deliberately absent. Migration 246: the conversion table is "data, not code,
 * because a conversion table in TypeScript and a conversion table in SQL would eventually disagree and
 * THE DISAGREEMENT WOULD BE A WRONG DOSE." Putting it on a device would create a THIRD copy, on hardware
 * that may not reconnect for days, and let the device convert. It does not convert: it records the value
 * and the unit the practitioner chose, and the server converts once, at write time, as it always has.
 */
export const OFFLINE_PARAMETERS_FORBIDDEN_FIELDS = [
  "unit_conversions", "unitConversions", "workspace_id", "workspaceId", "status", "version",
] as const;

export function parameterKeysOutsideAllowList(obj: object, allowed: readonly string[]): string[] {
  return Object.keys(obj).filter(k => !allowed.includes(k));
}

export function offlineParametersExpiry(
  asOf: string, maxDays: number = OFFLINE_PARAMETERS_MAX_DAYS,
): string {
  return new Date(Date.parse(asOf) + maxDays * 86_400_000).toISOString();
}

export type OfflineParametersReadResult =
  | { state: "ok"; set: OfflineParameterSet }
  | { state: "expired"; reason: string; purge: true }
  | { state: "wrong_schema"; reason: string; purge: true }
  | { state: "none"; reason: string; purge: false };

export function readOfflineParameters(
  set: OfflineParameterSet | null, now: Date,
): OfflineParametersReadResult {
  if (!set)
    return {
      state: "none", purge: false,
      reason: "This device has not stored the practice's list of measurements, so there is nothing to choose from. Opening Practice while online will remember them.",
    };
  if (set.schemaVersion !== OFFLINE_PARAMETERS_SCHEMA_VERSION)
    return { state: "wrong_schema", purge: true, reason: "This device holds the measurement list in a format this version no longer reads." };
  if (now.getTime() >= Date.parse(set.expiresAt))
    return {
      state: "expired", purge: true,
      reason: `This device has not reached the practice for over ${OFFLINE_PARAMETERS_MAX_DAYS} days, so the measurement list has been removed. Some of it may have been retired or changed since.`,
    };
  return { state: "ok", set };
}

// ── PLAUSIBILITY, ON THE DEVICE ─────────────────────────────────────────────────────────────────────

export type PlausibilityNote = { level: "ok" | "warn"; text: string | null };

/**
 * ⚠ IT WARNS. IT DOES NOT REFUSE, AND THAT IS COPIED FROM THE ENGINE ON PURPOSE.
 *
 * Migration 246 s1: "a refused measurement is a measurement nobody records, and a 3 kg adult is a typing
 * error worth a warning, not a locked form." Offline that argument is STRONGER, not weaker -- a form that
 * locks in a clinic with no signal cannot be argued with by anybody, and the reading is simply lost.
 *
 * ⚠ So this returns a sentence, never a veto, and `captureMeasurement` does not consult it. The screen
 * shows it beside the field and the practitioner decides.
 */
export function offlinePlausibility(
  parameter: OfflineParameter, value: number | null,
): PlausibilityNote {
  if (value === null || Number.isNaN(value)) return { level: "ok", text: null };
  const { minPlausible: lo, maxPlausible: hi, canonicalUnit: unit } = parameter;
  const suffix = unit ? ` ${unit}` : "";
  if (lo !== null && value < lo)
    return { level: "warn", text: `That is below the usual range for ${parameter.displayName} (${lo}${suffix} and up). It can still be recorded — check it is what you meant.` };
  if (hi !== null && value > hi)
    return { level: "warn", text: `That is above the usual range for ${parameter.displayName} (up to ${hi}${suffix}). It can still be recorded — check it is what you meant.` };
  return { level: "ok", text: null };
}

// ── THE PROJECTION ──────────────────────────────────────────────────────────────────────────────────

export type ParameterSource = {
  id: string; code: string; display_name: string; short_name: string | null;
  category: string; data_type: string; canonical_unit: string | null;
  permitted_units: string[] | null; value_precision: number | null;
  min_plausible: number | null; max_plausible: number | null;
  options: unknown;
};

/**
 * ⚠ THE TWO EXCLUSIONS ARE WELDED INTO THE QUERY, NOT APPLIED HERE, and this constant is what names them
 * so the reason travels with the shape rather than living inside a `.eq()`.
 *
 *   status = 'active'        a RETIRED parameter is refused by recordMeasurement. Offering one offline
 *                            means the practitioner takes a reading, believes it recorded, and learns
 *                            days later that it was refused -- with the patient long gone.
 *   data_type <> 'calculated' a calculated parameter is derived from other rows and cannot be typed in.
 *                            Same failure, same delay.
 */
export const OFFLINE_PARAMETERS_ONLY_RECORDABLE = true;

export function projectOfflineParameter(row: ParameterSource): OfflineParameter {
  // FIELD BY FIELD. No spread -- see OFFLINE_PARAMETERS_FORBIDDEN_FIELDS.
  const rawOptions = Array.isArray(row.options) ? row.options : [];
  return {
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    shortName: row.short_name,
    category: row.category,
    dataType: row.data_type,
    canonicalUnit: row.canonical_unit,
    permittedUnits: Array.isArray(row.permitted_units) ? row.permitted_units : [],
    valuePrecision: row.value_precision,
    minPlausible: row.min_plausible,
    maxPlausible: row.max_plausible,
    // ⚠ Only the two fields a form needs. Migration 223's shape also carries `score`, which is scoring
    // logic the server owns; a device that held it could compute a total nobody asked it to compute.
    options: rawOptions
      .filter((o): o is { value: string; label?: string } =>
        !!o && typeof o === "object" && typeof (o as { value?: unknown }).value === "string")
      .map(o => ({ value: o.value, label: typeof o.label === "string" ? o.label : o.value })),
  };
}

export function projectOfflineParameterSet(input: {
  workspaceId: string; asOf: string; parameters: OfflineParameter[];
  unavailable: boolean; dropped: { count: number; reason: string } | null;
}): OfflineParameterSet {
  return {
    schemaVersion: OFFLINE_PARAMETERS_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    asOf: input.asOf,
    expiresAt: offlineParametersExpiry(input.asOf),
    parameters: input.parameters,
    unavailable: input.unavailable,
    dropped: input.dropped,
  };
}
