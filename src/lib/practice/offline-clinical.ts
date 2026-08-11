import { allergyLine, bloodGroupLine, type SafetyLine } from "@/lib/practice/longitudinal-constants";

// CP-OFFLINE-SURVEY-001 s9 — THE CLINICAL CARRY: what a practitioner needs on a device in order to make
// a decision, rather than merely to know who is coming.
//
// The owner's brief, 2026-08-11, verbatim: "We need to be able to go to an internet scarce zone and
// safely run a clinic or review patients in a way that is safe. The past data is needed as well. I would
// prefer being able to recall say the last visit at the most and all other relevant data to help with
// making the clinical decisions today."
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ THIS DELIBERATELY REVERSES AN EXCLUSION THAT WAS RECORDED WITH REASONS. SAY SO PLAINLY.
//
// offline-projection.ts:32 reads: "Dropped, deliberately: date of birth, phone, email, address, the
// identifier SET, free-text reason, ALLERGIES, CURRENT MEDICATIONS, DIAGNOSES, sex..." and justifies it
// with "A device lost with this cache discloses that these named people had an appointment at this
// practice today. That is a real disclosure and a much smaller one than the payload it came from."
//
// That reasoning was correct FOR A LIST. It answers "who is coming", and for that question allergies are
// surplus. It is the wrong frame for "run a clinic with no connection", which is the question the owner
// actually asked, and which the day cache cannot answer at all: a practitioner offline with a name, an
// age and a time can identify the patient in front of them and can do nothing else safely.
//
// ⚠ WHAT A LOST DEVICE NOW DISCLOSES, STATED SO NOBODY HAS TO DERIVE IT:
//
//     before   these named people had an appointment at this practice today
//     after    these named people have an appointment here within OFFLINE_CLINICAL_HORIZON_DAYS,
//              AND their allergies, AND their current medication, AND the problems on their record,
//              AND the date and findings of their last visit
//
// That is health data of a materially more sensitive class, on a laptop, in a place with no connection --
// which is also a place where a laptop is more likely to be lost. It is held anyway because the
// alternative is a clinician prescribing blind, which is the larger harm. It is not held CASUALLY:
//
//   - the PIN is what stands between a lost device and this payload, and this cache raises the PIN from
//     a good idea to the thing the feature rests on. See offline-lock.ts for what a PIN honestly buys --
//     it is not proof against somebody with time and the right tools, and this file does not pretend it.
//   - the expiry is the SHORTEST of the three caches by days-per-sensitivity. See below.
//   - the horizon is bounded by APPOINTMENTS. There is no register here. A patient with no booking in
//     the window is not on the device, so the cache cannot become a copy of the practice.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ THE SAFETY RULE THIS MODULE EXISTS TO PRESERVE, AND THE OBVIOUS DESIGN THAT BREAKS IT.
//
// longitudinal-constants.ts carries the product's most safety-critical sentence:
//
//     "No known allergies" and "nobody has asked" are different answers and the difference can kill
//     somebody... So the STATUS decides the sentence and the LIST never does.
//
// The obvious offline design caches an ARRAY of allergies. An array has two states, not three: it has
// things in it or it does not. Cache that alone and every patient nobody has ever asked arrives on the
// device as an empty list -- indistinguishable from a patient explicitly recorded as having none, and
// most confidently reassuring for the newest records, whose history is least known.
//
// ⚠ SO THE STATUS, THE COUNT AND THE READ-FAILURE FLAG ARE CACHED AS THREE SEPARATE FACTS, AND THE
// SENTENCE IS COMPUTED ON THE DEVICE AT READ TIME BY THE SAME allergyLine() THE ONLINE SCREENS USE.
// Not cached as a string. A cached sentence is a frozen judgement, and this one must be recomputed
// against what is actually on the device -- including the case where the list did not survive.
//
// ⚠ IT IS IMPORTED, NOT REIMPLEMENTED. One owner per calculation. longitudinal-constants.ts declares
// itself "a module with NO SERVER IMPORTS" and is pure functions on purpose, which is exactly why it can
// cross into a browser store the way practice-time.ts already does for the day.

/** Bumped when the shape below changes. A record from an older schema is discarded, never migrated. */
export const OFFLINE_CLINICAL_SCHEMA_VERSION = 1;

/**
 * ⚠ HOW FAR AHEAD APPOINTMENTS ARE CARRIED, AND IT IS THE THING THAT BOUNDS THE DISCLOSURE.
 *
 * The owner's framing for this whole programme has been "if the device is offline for 4 days". Every
 * patient inside this horizon is on the device with their clinical record; every patient outside it is
 * not on the device at all. Widening this number is the single most consequential edit in this file, so
 * it is a named constant rather than a literal at a call site.
 */
export const OFFLINE_CLINICAL_HORIZON_DAYS = 4;

/**
 * ⚠ THE HARD EXPIRY, AND WHY IT IS FIVE RATHER THAN FOUR OR SEVEN.
 *
 *   - It must OUTLAST the horizon, or the record expires on the last day of the trip -- the day it is
 *     most needed and the day there is least chance of getting it back. Four would do exactly that.
 *   - It must not approach the guidance library's seven. Guidance names nobody; this names living
 *     patients and their medication. The two caches sit at opposite ends of the sensitivity scale and
 *     their expiries say so.
 *   - Beyond it the record is DELETED, not hidden. A five-day-old medication list is not stale, it is
 *     potentially wrong in the specific way that harms somebody: a drug stopped since would still be
 *     listed as active, and nothing on the device can know.
 *
 * ⚠ NOT SETTLED BY THE OWNER. The horizon is theirs ("4 days"); this margin is a build-time judgement,
 * kept in one constant so changing it is a one-line decision.
 */
export const OFFLINE_CLINICAL_MAX_DAYS = 5;

/**
 * ⚠ CAPS, AND THEY ARE REPORTED WHEN THEY BITE. A silent cap on a clinical cache is the worst kind:
 * the practitioner looks up a patient, finds nothing, and concludes there is nothing to find.
 */
export const OFFLINE_CLINICAL_MAX_PATIENTS = 120;
export const OFFLINE_CLINICAL_MAX_BYTES = 2_000_000;
/** Per patient. A long list is truncated with the count said out loud, never quietly. */
export const OFFLINE_CLINICAL_MAX_MEDICATIONS = 30;
export const OFFLINE_CLINICAL_MAX_ALLERGIES = 20;
export const OFFLINE_CLINICAL_MAX_PROBLEMS = 20;

// ── THE SHAPES ──────────────────────────────────────────────────────────────────────────────────────

export type OfflineAllergy = {
  id: string;
  /** Free text by deliberate decision (migration 258's note): displayed, never matched against. */
  substance: string;
  reaction: string | null;
  severity: string | null;
  /** suspected | confirmed | refuted. ⚠ `refuted` is CARRIED, not filtered -- see the projection. */
  certainty: string;
};

export type OfflineMedication = {
  id: string;
  genericName: string;
  brandName: string | null;
  /** What to give. The practitioner's own words, already validated non-empty upstream. */
  doseText: string;
  route: string | null;
  frequency: string | null;
  indication: string | null;
  startedOn: string | null;
  status: string;
};

export type OfflineProblem = {
  id: string;
  label: string;
  status: string | null;
  onsetOn: string | null;
};

/**
 * ⚠ ONE PRIOR ENCOUNTER. THE OWNER SAID "THE LAST VISIT AT THE MOST" AND THAT IS A CEILING, NOT A HINT.
 *
 * A journey view offline would be a second copy of the patient's history on a device, and the owner
 * bounded it themselves. This carries the last visit and stops.
 */
export type OfflineLastVisit = {
  encounterId: string;
  /** YYYY-MM-DD on the practice's calendar. */
  date: string;
  /** The care setting, not a free-text title -- the day cache's rule, for the same reason. */
  kindLabel: string;
  /**
   * ⚠ THE `assessment` AND `plan` SEGMENTS OF THE LAST NOTE, AND BOTH ARE CARRIED.
   *
   * practice_encounter_note is SOAP -- subjective, objective, assessment, plan, narrative. Carrying the
   * assessment alone would tell a practitioner what was concluded and not what was decided, which is the
   * half that governs today: "continue for six weeks then review" is the sentence that makes today's
   * visit make sense. The subjective and objective segments are NOT carried -- they are the longest,
   * they are the patient's account rather than a decision, and the owner bounded this to the last visit
   * rather than the last consultation in full.
   *
   * ⚠ Null means NOTHING WAS RECORDED, which is not the same as "nothing was found". No screen may
   * render an absent assessment as a normal one.
   */
  assessment: string | null;
  plan: string | null;
  /** Diagnoses recorded at that visit. ⚠ Empty means none were RECORDED, NOT that none exist. */
  diagnoses: string[];
};

/**
 * One patient's clinical carry.
 *
 * ⚠ EVERY `...Unavailable` FLAG IS LOAD-BEARING AND NONE OF THEM IS DECORATION. A failed read is never a
 * zero, and offline it is worse than that: there is nobody to ask and no way to retry. A missing
 * medication list rendered as "no current medication" is a prescribing hazard that the practitioner has
 * no means of detecting.
 */
export type OfflineClinicalRecord = {
  patientId: string;
  /**
   * ⚠ THE THREE FACTS THAT DECIDE THE ALLERGY SENTENCE, CACHED SEPARATELY AND NEVER AS A SENTENCE.
   * `allergyStatus` is migration 238's not_recorded | none_known | recorded.
   */
  allergyStatus: string | null;
  allergyReviewedAt: string | null;
  /** ⚠ NULL means the list could not be read. 0 means it was read and was empty. Not the same answer. */
  allergyCount: number | null;
  allergiesUnavailable: boolean;
  allergies: OfflineAllergy[];

  bloodGroup: string | null;

  medications: OfflineMedication[];
  medicationsUnavailable: boolean;
  /** How many active medications were left behind by the cap. Zero means the list is complete. */
  medicationsDropped: number;

  problems: OfflineProblem[];
  problemsUnavailable: boolean;
  problemsDropped: number;

  /** Null when there is no previous encounter, or when the read failed -- distinguished by the flag. */
  lastVisit: OfflineLastVisit | null;
  lastVisitUnavailable: boolean;
};

export type OfflineClinicalPack = {
  schemaVersion: number;
  workspaceId: string;
  timezone: string;
  /** The instant the SERVER assembled this. Never a client clock. */
  asOf: string;
  expiresAt: string;
  /** The last calendar date whose appointments are represented here. */
  horizonDate: string;
  records: OfflineClinicalRecord[];
  /** ⚠ A FAILED READ IS NOT AN EMPTY PACK. */
  recordsUnavailable: boolean;
  dropped: { count: number; reason: string } | null;
};

export const OFFLINE_CLINICAL_RECORD_KEYS: readonly (keyof OfflineClinicalRecord)[] = [
  "patientId", "allergyStatus", "allergyReviewedAt", "allergyCount", "allergiesUnavailable",
  "allergies", "bloodGroup", "medications", "medicationsUnavailable", "medicationsDropped",
  "problems", "problemsUnavailable", "problemsDropped", "lastVisit", "lastVisitUnavailable",
] as const;

export const OFFLINE_CLINICAL_PACK_KEYS: readonly (keyof OfflineClinicalPack)[] = [
  "schemaVersion", "workspaceId", "timezone", "asOf", "expiresAt", "horizonDate",
  "records", "recordsUnavailable", "dropped",
] as const;

/**
 * ⚠ FIELDS THAT MUST NEVER APPEAR, BY NAME, EVEN NOW THAT CLINICAL DATA IS CARRIED.
 *
 * Widening the cache to allergies and medication is NOT a licence to widen it to everything. Each of
 * these is a real column on a table this module reads, so a lazy `{...row}` is caught by name:
 *
 *   birth_date        the day cache carries AGE for exactly this reason and that has not changed
 *   phone / email     contact details serve no clinical decision at the chairside
 *   prescriber        a colleague's NAME. What was prescribed is clinical; who typed it is not.
 *   created_by etc.   people, again
 *   verified_by       the audit trail, which is a practice-administration fact
 *   discontinued_*    only `active` medication is carried, so a stop reason is out of scope by design
 */
export const OFFLINE_CLINICAL_FORBIDDEN_FIELDS = [
  "birth_date", "birthDate", "dateOfBirth", "dob",
  "phone", "email", "address",
  "prescriber", "created_by", "createdBy", "updated_by", "updatedBy",
  "verified_by", "verifiedBy", "allergy_reviewed_by", "allergyReviewedBy",
  "discontinued_reason", "discontinuedReason", "recorded_source", "recordedSource",
] as const;

/** Keys on `obj` that are not in `allowed`. Empty means the projection held. */
export function clinicalKeysOutsideAllowList(obj: object, allowed: readonly string[]): string[] {
  return Object.keys(obj).filter(k => !allowed.includes(k));
}

/** The instant a cached pack stops being readable: `OFFLINE_CLINICAL_MAX_DAYS` after capture. */
export function offlineClinicalExpiry(
  asOf: string, maxDays: number = OFFLINE_CLINICAL_MAX_DAYS,
): string {
  return new Date(Date.parse(asOf) + maxDays * 86_400_000).toISOString();
}

// ── WHAT THE READER MAY DO WITH WHAT IT FOUND ───────────────────────────────────────────────────────

export type OfflineClinicalReadResult =
  | { state: "ok"; pack: OfflineClinicalPack; notice: OfflineClinicalNotice }
  | { state: "expired"; reason: string; purge: true }
  | { state: "clock_rollback"; reason: string; purge: false }
  | { state: "wrong_schema"; reason: string; purge: true }
  | { state: "none"; reason: string; purge: false };

export type OfflineClinicalNotice = {
  days: number;
  atLabel: string;
  sentence: string;
  tone: "amber" | "orange" | "red";
};

/**
 * ⚠ THE SENTENCE NAMES THE CLINICAL HAZARD, WHICH IS NARROWER AND SHARPER THAN "THIS MIGHT BE OLD".
 *
 * The day cache warns that appointments may have moved. Guidance warns that a document may have been
 * withdrawn. Neither is this one. The hazard here is that A DRUG MAY HAVE BEEN STOPPED, OR AN ALLERGY
 * RECORDED, SINCE THIS WAS CAPTURED -- and that the device shows the old answer with no way to know.
 * That is the sentence, in those words, because "may be out of date" does not tell a prescriber what to
 * do differently and this does.
 *
 * ⚠ None of these says "current", "confirmed", "up to date" or "synced". There is no sync.
 */
export function offlineClinicalNotice(asOf: string, timezone: string, now: Date): OfflineClinicalNotice {
  const ms = Math.max(0, now.getTime() - Date.parse(asOf));
  const days = Math.floor(ms / 86_400_000);
  const atLabel = new Date(asOf).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timezone || "UTC",
  });
  const tone = days >= 3 ? "red" as const : days >= 1 ? "orange" as const : "amber" as const;
  const sentence = days < 1
    ? `Offline. This is the clinical record as it stood at ${atLabel}. A medicine stopped, or an allergy recorded, since then would not show here.`
    : days < 3
      ? `Offline for ${days} day${days === 1 ? "" : "s"}. This is the clinical record as it stood at ${atLabel}. A medicine stopped, or an allergy recorded, in that time would still show the old answer here.`
      : `Offline for ${days} days. This is the clinical record as it stood at ${atLabel}. Confirm the medication list and the allergy status with the patient before you prescribe.`;
  return { days, atLabel, sentence, tone };
}

/**
 * The one place that decides whether a cached pack may be shown at all.
 *
 * ⚠ Identical rules to the day and the guidance library, deliberately. Three caches with three
 * almost-identical readers would be three places for the rule to drift; the SHAPE is repeated so each
 * can carry its own sentences, but the DECISIONS are the same four in the same order.
 */
export function readOfflineClinical(
  pack: OfflineClinicalPack | null, now: Date,
): OfflineClinicalReadResult {
  if (!pack)
    return { state: "none", purge: false, reason: "No clinical records have been stored on this device yet." };
  if (pack.schemaVersion !== OFFLINE_CLINICAL_SCHEMA_VERSION)
    return {
      state: "wrong_schema", purge: true,
      reason: "This device holds clinical records in a format this version no longer reads, so they are discarded rather than guessed at.",
    };
  if (now.getTime() < Date.parse(pack.asOf))
    return {
      state: "clock_rollback", purge: false,
      reason: "This device's clock is earlier than the moment these records were captured, so their age cannot be worked out. Nothing is shown.",
    };
  if (now.getTime() >= Date.parse(pack.expiresAt))
    return {
      state: "expired", purge: true,
      reason: `This device has not reached the practice for over ${OFFLINE_CLINICAL_MAX_DAYS} days. The clinical records it was holding have been removed, because a medication list that old cannot be told apart from one that is still correct.`,
    };
  return { state: "ok", pack, notice: offlineClinicalNotice(pack.asOf, pack.timezone, now) };
}

// ── THE SENTENCES ONE RECORD IS ALLOWED TO PRINT ────────────────────────────────────────────────────

/**
 * ⚠ THE ALLERGY SENTENCE, COMPUTED HERE AND NOWHERE ELSE, FROM THE SAME FUNCTION THE ONLINE SCREENS USE.
 *
 * `unavailable` is passed as the OR of two different failures, and conflating them would be the bug this
 * whole design guards against: the status column may have been unreadable at capture, OR the list may
 * have been. Either one means the device cannot honestly reassure anybody.
 */
export function offlineAllergySentence(record: OfflineClinicalRecord): SafetyLine {
  return allergyLine({
    status: record.allergyStatus,
    count: record.allergyCount,
    unavailable: record.allergiesUnavailable,
    reviewedAt: record.allergyReviewedAt,
  });
}

export function offlineBloodGroupSentence(record: OfflineClinicalRecord): SafetyLine {
  return bloodGroupLine({ value: record.bloodGroup, unavailable: record.allergiesUnavailable });
}

/**
 * ⚠ WHAT THE MEDICATION PANEL MUST SAY WHEN IT HAS NOTHING TO SHOW, AND IT IS NOT "NONE".
 *
 * Same three states as the allergy line, for the same reason and with the same consequence. An empty
 * medication list on a device is ambiguous between "this patient takes nothing" and "the list did not
 * make it onto this device", and a prescriber acting on the first when the second is true is the harm.
 */
/**
 * ⚠ WHICH MEDICATION STATUSES REACH A DEVICE, AND WHY `paused` IS ONE OF THEM.
 *
 * migration 258's four states are active / completed / paused / discontinued. The first draft of this
 * carried `active` alone, which is the obvious reading of "current medication" and is WRONG in the one
 * direction that matters: a paused course is a drug the patient may resume, that may still be in them,
 * and that can interact with whatever is prescribed today. A prescriber offline who cannot see it cannot
 * ask about it -- and unlike online, there is nobody to ring.
 *
 * `completed` and `discontinued` are NOT carried: those courses are over, and a finished drug listed on
 * a small screen in bad light is the noise that makes the important two lines get skipped.
 *
 * ⚠ AND `paused` IS NEVER COUNTED AS "CURRENT". It is carried, and it is labelled, and the sentence
 * below reports the two separately -- because "3 current medicines" that silently includes a paused one
 * is a different kind of wrong from not showing it at all.
 */
export const OFFLINE_MEDICATION_STATUSES = ["active", "paused"] as const;

export function offlineMedicationSentence(record: OfflineClinicalRecord): SafetyLine {
  if (record.medicationsUnavailable)
    return { text: "Current medication could not be read", tone: "unreadable", safeToRead: false };
  const active = record.medications.filter(m => m.status === "active").length;
  const paused = record.medications.filter(m => m.status === "paused").length;
  const n = record.medications.length;
  if (n > 0 && active === 0)
    // Everything held is paused. Saying "0 current medicines" would be true and would read as "nothing
    // to worry about", which is the opposite of what a paused course means to somebody prescribing.
    return {
      text: `Nothing is recorded as currently being taken, but ${paused} paused course${paused === 1 ? " is" : "s are"} on the record`,
      tone: "present", safeToRead: false,
    };
  if (n === 0)
    return {
      // ⚠ NOT "no current medication". This says what is actually known: the practice's record was read
      // and held nothing. A patient may be taking something nobody has written down.
      text: "Nothing is recorded as current medication at the practice",
      tone: "none", safeToRead: true,
    };
  const more = record.medicationsDropped > 0
    ? ` (${record.medicationsDropped} more not held on this device)` : "";
  // ⚠ `active`, NOT `n`. Counting the paused courses into "current medicines" is the conflation this
  // whole block was rewritten to avoid, and it is one character away at all times.
  const pausedClause = paused > 0
    ? `, and ${paused} paused course${paused === 1 ? "" : "s"}` : "";
  return {
    text: `${active} current medicine${active === 1 ? "" : "s"}${pausedClause}${more}`,
    tone: "present", safeToRead: false,
  };
}

// ── THE CONTROLS AN OFFLINE CLINICAL SCREEN MAY RENDER ──────────────────────────────────────────────
//
// ⚠ s3.5 applies here at its sharpest. The online medication panel carries Prescribe, Stop and Verify.
// Reusing it offline would render a prescribing form on a device that can deliver nothing -- the
// practitioner would type a prescription, believe it recorded, and it would never exist. That is the
// worst version of the accident s3.5 was written about, because a prescription that silently does not
// exist is indistinguishable from one that does until somebody is harmed.

export type OfflineClinicalControl = {
  key: string;
  label: string;
  mutating: boolean;
  enabled: boolean;
  reason: string | null;
};

const NEEDS_CONNECTION =
  "This needs a connection to the practice. Nothing typed here could be delivered, so nothing is accepted.";

export function offlineClinicalControls(record: OfflineClinicalRecord): OfflineClinicalControl[] {
  return [
    {
      key: `read:${record.patientId}`,
      label: "Show the clinical record",
      mutating: false, enabled: true, reason: null,
    },
    { key: `prescribe:${record.patientId}`, label: "Prescribe", mutating: true, enabled: false, reason: NEEDS_CONNECTION },
    { key: `stopmed:${record.patientId}`, label: "Stop a medicine", mutating: true, enabled: false, reason: NEEDS_CONNECTION },
    { key: `allergy:${record.patientId}`, label: "Record an allergy", mutating: true, enabled: false, reason: NEEDS_CONNECTION },
    { key: `problem:${record.patientId}`, label: "Add a problem", mutating: true, enabled: false, reason: NEEDS_CONNECTION },
  ];
}

/** ⚠ MUST BE EMPTY. Asserted over the real control list rather than over a mock. */
export function enabledMutatingClinicalControls(
  controls: OfflineClinicalControl[],
): OfflineClinicalControl[] {
  return controls.filter(c => c.mutating && c.enabled);
}

// ── THE PROJECTION ──────────────────────────────────────────────────────────────────────────────────
//
// Source shapes are declared as INPUTS rather than imported from longitudinal.ts or medication.ts, so
// that a column added to practice_medication tomorrow cannot widen what reaches a device. The projection
// reads what it names, field by field, and never spreads a row.

export type AllergySource = {
  id: string; substance: string; reaction: string | null;
  severity: string | null; certainty: string;
};

export type MedicationSource = {
  id: string; generic_name: string; brand_name: string | null; dose_text: string;
  route: string | null; frequency: string | null; indication: string | null;
  started_on: string | null; status: string;
};

export type ProblemSource = {
  id: string; label: string; status: string | null; onset_date: string | null;
};

/**
 * ⚠ THE STATUSES A PRIOR ENCOUNTER MUST NOT BE IN, AND WHY THIS IS A CLINICAL CONTROL.
 *
 * `ENTERED_IN_ERROR` means somebody recorded a consultation that did not happen; `CANCELLED` means it
 * did not happen either. Either one presented offline as "the last visit" is a fabricated history, and
 * the practitioner has no connection with which to check it. The filter belongs in the query, but it is
 * NAMED HERE so the rule and its reason live with the shape rather than inside a `.neq()`.
 */
export const OFFLINE_LAST_VISIT_EXCLUDED_STATUSES = ["ENTERED_IN_ERROR", "CANCELLED", "DRAFT"] as const;

export type LastVisitSource = {
  encounter_id: string;
  date: string;
  kindLabel: string;
  assessment: string | null;
  plan: string | null;
  diagnoses: string[];
};

export function projectOfflineLastVisit(row: LastVisitSource): OfflineLastVisit {
  return {
    encounterId: row.encounter_id,
    date: row.date,
    kindLabel: row.kindLabel,
    assessment: row.assessment,
    plan: row.plan,
    diagnoses: row.diagnoses,
  };
}

export function projectOfflineAllergy(row: AllergySource): OfflineAllergy {
  return {
    id: row.id,
    substance: row.substance,
    reaction: row.reaction,
    severity: row.severity,
    // ⚠ `refuted` IS CARRIED RATHER THAN FILTERED OUT. A refuted allergy is a fact somebody established
    // and it changes what a prescriber does: it is the difference between "safe" and "somebody checked
    // this and it was not real". Dropping it offline would make the device silently disagree with the
    // online record, and the practitioner would re-ask a question that has an answer.
    certainty: row.certainty,
  };
}

export function projectOfflineMedication(row: MedicationSource): OfflineMedication {
  return {
    id: row.id,
    genericName: row.generic_name,
    brandName: row.brand_name,
    doseText: row.dose_text,
    route: row.route,
    frequency: row.frequency,
    indication: row.indication,
    startedOn: row.started_on,
    status: row.status,
  };
}

export function projectOfflineProblem(row: ProblemSource): OfflineProblem {
  return { id: row.id, label: row.label, status: row.status, onsetOn: row.onset_date };
}

/**
 * Apply the whole-pack caps and say what they cost.
 *
 * ⚠ `totalAvailable` is the number of patients IN THE HORIZON, which is not `records.length` once the
 * caller has already sliced. Same trap as the guidance library, same fix.
 */
export function capOfflineClinical(
  records: OfflineClinicalRecord[],
  opts: { maxPatients?: number; maxBytes?: number; totalAvailable?: number } = {},
): { records: OfflineClinicalRecord[]; dropped: { count: number; reason: string } | null } {
  const maxPatients = opts.maxPatients ?? OFFLINE_CLINICAL_MAX_PATIENTS;
  const maxBytes = opts.maxBytes ?? OFFLINE_CLINICAL_MAX_BYTES;
  const total = opts.totalAvailable ?? records.length;
  const kept: OfflineClinicalRecord[] = [];
  let bytes = 0;
  let hitBytes = false;

  for (const rec of records) {
    if (kept.length >= maxPatients) break;
    const size = JSON.stringify(rec).length;
    if (bytes + size > maxBytes && kept.length > 0) { hitBytes = true; break; }
    kept.push(rec);
    bytes += size;
  }

  const count = total - kept.length;
  if (count <= 0) return { records: kept, dropped: null };

  const plural = count === 1 ? "" : "s";
  const verb = count === 1 ? "is" : "are";
  return {
    records: kept,
    dropped: {
      count,
      reason: hitBytes
        ? `${count} patient${plural} booked in this period ${verb} on this device WITHOUT a clinical record: what is here already fills the space set aside for it. Their appointment still shows; their allergies and medication do not.`
        : `${count} patient${plural} booked in this period ${verb} on this device WITHOUT a clinical record: only the first ${maxPatients} are held. Their appointment still shows; their allergies and medication do not.`,
    },
  };
}

export function projectOfflineClinicalPack(input: {
  workspaceId: string;
  timezone: string;
  asOf: string;
  horizonDate: string;
  records: OfflineClinicalRecord[];
  recordsUnavailable: boolean;
  dropped: { count: number; reason: string } | null;
}): OfflineClinicalPack {
  return {
    schemaVersion: OFFLINE_CLINICAL_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    timezone: input.timezone,
    asOf: input.asOf,
    expiresAt: offlineClinicalExpiry(input.asOf),
    horizonDate: input.horizonDate,
    records: input.records,
    recordsUnavailable: input.recordsUnavailable,
    dropped: input.dropped,
  };
}

/**
 * ⚠ THE LOOKUP A SCREEN USES, AND IT RETURNS A THREE-STATE ANSWER RATHER THAN `undefined`.
 *
 * A patient on the day's list with no clinical record is NOT a patient with nothing wrong with them.
 * They are a patient whose record did not fit, or could not be read. `find()` returning undefined would
 * be rendered by the nearest `?.` as a blank panel, which reads as reassurance. This makes the caller
 * handle the case by giving them something they cannot accidentally ignore.
 */
export type OfflineClinicalLookup =
  | { state: "found"; record: OfflineClinicalRecord }
  | { state: "not_held"; reason: string };

export function lookupOfflineClinical(
  pack: OfflineClinicalPack | null, patientId: string,
): OfflineClinicalLookup {
  if (!pack)
    return { state: "not_held", reason: "No clinical records are held on this device." };
  if (pack.recordsUnavailable)
    return { state: "not_held", reason: "The clinical records could not be read when this device last reached the practice." };
  const record = pack.records.find(r => r.patientId === patientId);
  if (record) return { state: "found", record };
  return {
    state: "not_held",
    reason: pack.dropped
      ? `No clinical record for this patient is held on this device. ${pack.dropped.reason}`
      : "No clinical record for this patient is held on this device.",
  };
}
