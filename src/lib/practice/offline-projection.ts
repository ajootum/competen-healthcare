import { zonedDayRange } from "@/lib/practice/practice-time";

// CP-OFFLINE-SURVEY-001 s3 — PHASE ONE, THE READ-ONLY OFFLINE CACHE: the projection, the clock and the
// three sentences a cached clinic day is allowed to say about itself.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS MODULE IMPORTS NOTHING THAT CANNOT RUN IN A BROWSER, AND THAT IS LOAD-BEARING.
//
// It is imported by the route handler (server), by the writer and the reader (client components) and by
// the harness (node). practice-time.ts is pure Intl arithmetic with no Supabase and no next/server, so
// it crosses that boundary safely. Nothing else may be added here without checking the same thing --
// this repository has already lost a board to a server-only import reaching a client component, which
// passed tsc, eslint and every harness and only died in `next build`.
//
// ── WHAT IS CACHED, AND WHY THE ALLOW-LIST IS THE SECURITY CONTROL ──────────────────────────────────
//
// s3.8.1: "Project at WRITE time, not at render time. A cache that stores everything and renders a
// subset has stored everything." So the projection below CONSTRUCTS its output field by field. It never
// spreads a source row, and there is no path by which a column added upstream tomorrow arrives in a
// browser store: a new field is excluded by default because it was never named here.
//
// Kept, each earning its place (s3.8.1):
//   name             the key a human uses to match the person in front of them to the right record
//   one identifier   disambiguates namesakes; duplicate registration is a named hazard in this product
//   AGE, not DOB     age carries the clinical utility; the full date is a strong identifier
//   time, duration   the ordering of the clinic, and what fits before the next patient
//   status           "waiting" versus "seen" -- the second-most-used fact in a clinic day
//   encounter id     opaque, non-disclosive, the key to open the right record on reconnect
//
// Dropped, deliberately: date of birth, phone, email, address, the identifier SET, free-text reason,
// allergies, current medications, diagnoses, sex, and all twelve management metrics. A device lost with
// this cache discloses that these named people had an appointment at this practice today. That is a real
// disclosure and a much smaller one than the payload it came from.
//
// ⚠ THE VISIT KIND IS CACHED AND IS NOT IN THE LIST ROW. s3.8.7: the clinic context supplies the *who*
// for free, so a service label beside a name on a waiting-room screen is more disclosive than the name.
// It is still needed -- a practitioner who cannot tell a review from a first visit cannot triage -- so it
// lives on the record and appears only when one patient is opened deliberately. Two functions rather than
// one flag: `offlineListRow` physically cannot return it, and that is asserted.
//
// ⚠ THE PRACTITIONER'S OWN SESSION TITLE IS NOT CACHED AT ALL, for the same reason and one step further.
// "TB clinic 09:00-13:00" printed above a list of names re-supplies at the top of the screen exactly what
// suppressing the per-patient visit kind removed. The activity TYPE -- outpatient clinic, ward round,
// theatre list -- is a care setting rather than a condition, so that is what is kept.

/** Bumped when the shape below changes. A record from an older schema is discarded, never migrated. */
export const OFFLINE_SCHEMA_VERSION = 1;

/**
 * One appointment on the cached day.
 *
 * ⚠ Every field here is in the allow-list because it is written down here. `OFFLINE_PATIENT_KEYS` is the
 * machine-readable copy of this type and the harness asserts the projection produces exactly it.
 */
export type OfflinePatient = {
  /** The appointment row id. Opaque; the key for this row and nothing else. */
  id: string;
  name: string;
  /** ONE identifier, never the set. Null when the patient has none recorded. */
  identifierType: string | null;
  identifierValue: string | null;
  /** Whole years, derived on the SERVER. A date of birth never crosses the wire. */
  ageYears: number | null;
  /** hh:mm on the practice's wall clock, formatted server-side from the practice timezone. */
  timeLabel: string;
  durationMinutes: number | null;
  status: string;
  /** The encounter to open on reconnect. Null when none has been started. */
  encounterId: string | null;
  /** ⚠ CACHED, NEVER IN THE LIST ROW. See the header. */
  visitKind: string;
};

/** One of the practitioner's planned blocks. No free-text title -- see the header. */
export type OfflineSession = {
  id: string;
  /** The care setting: "Outpatient clinic", "Ward round". Never the practitioner's own title. */
  kindLabel: string;
  startLabel: string;
  endLabel: string;
  /** The engine's own vocabulary (activity.ts `ActivityState`), not a second one invented here. */
  state: "planned" | "running" | "done";
};

export type OfflineDay = {
  schemaVersion: number;
  workspaceId: string;
  /** YYYY-MM-DD in the practice's calendar, never the device's. */
  date: string;
  timezone: string;
  /** The instant the SERVER assembled this, from DashboardReadModel.asOf. Never a client clock. */
  asOf: string;
  /**
   * The instant after which this record is DELETED rather than shown (s3.8.2, and the user's decision of
   * 2026-08-08: end of the clinic day). ⚠ A cached day is WRONG after that day, not merely stale -- a
   * Tuesday schedule shown on Thursday is a correctness failure before it is a security one.
   */
  expiresAt: string;
  sessions: OfflineSession[];
  patients: OfflinePatient[];
  /**
   * s3.4.5: the per-card degradation state CAPTURED AT CACHE TIME. A card that was already unavailable at
   * 08:14 must not render as populated-but-old.
   */
  feeders: Record<string, "ok" | "unavailable">;
  /** ⚠ A FAILED READ IS NOT AN EMPTY DAY, offline least of all. */
  patientsUnavailable: boolean;
  sessionsUnavailable: boolean;
};

export const OFFLINE_PATIENT_KEYS: readonly (keyof OfflinePatient)[] = [
  "id", "name", "identifierType", "identifierValue", "ageYears",
  "timeLabel", "durationMinutes", "status", "encounterId", "visitKind",
] as const;

export const OFFLINE_SESSION_KEYS: readonly (keyof OfflineSession)[] = [
  "id", "kindLabel", "startLabel", "endLabel", "state",
] as const;

export const OFFLINE_DAY_KEYS: readonly (keyof OfflineDay)[] = [
  "schemaVersion", "workspaceId", "date", "timezone", "asOf", "expiresAt",
  "sessions", "patients", "feeders", "patientsUnavailable", "sessionsUnavailable",
] as const;

/**
 * ⚠ THE FIELDS THAT MUST NEVER APPEAR, BY NAME.
 *
 * The allow-list already excludes them; this list exists so the harness can fail with a sentence naming
 * the field rather than "unexpected key". Every one of them is present on the source rows the projection
 * reads, so a lazy `{...row}` would be caught by name.
 */
export const OFFLINE_FORBIDDEN_FIELDS = [
  "birth_date", "birthDate", "dateOfBirth", "dob",
  "patient_phone", "patientPhone", "phone", "email", "address",
  "reason", "notes", "allergies", "medications", "diagnoses",
  "sex", "metrics", "queue", "brief", "alerts", "drafts",
] as const;

/** Keys on `obj` that are not in `allowed`. Empty means the projection held. */
export function keysOutsideAllowList(obj: object, allowed: readonly string[]): string[] {
  return Object.keys(obj).filter(k => !allowed.includes(k));
}

/**
 * Whole years at `at`, from a birth date, falling back to a recorded estimate.
 *
 * ⚠ NULL RATHER THAN ZERO when neither is recorded. An unknown age rendered as "0y" is a newborn.
 */
export function ageYearsFrom(
  birthDate: string | null | undefined, estimate: number | null | undefined, at: Date,
): number | null {
  if (birthDate) {
    const b = new Date(`${birthDate}T00:00:00.000Z`);
    if (!Number.isNaN(b.getTime())) {
      let years = at.getUTCFullYear() - b.getUTCFullYear();
      const beforeBirthday =
        at.getUTCMonth() < b.getUTCMonth()
        || (at.getUTCMonth() === b.getUTCMonth() && at.getUTCDate() < b.getUTCDate());
      if (beforeBirthday) years -= 1;
      if (years >= 0 && years <= 130) return years;
    }
  }
  return typeof estimate === "number" ? estimate : null;
}

/**
 * The instant the cached day stops being a day: the next midnight in the PRACTICE's timezone.
 *
 * Not "12 hours from asOf". The survey proposed that before the distinction was drawn; the user's
 * decision is end-of-clinic-day, because for a schedule this is a correctness control. `zonedDayRange`
 * already returns an exclusive end -- the next midnight -- which is exactly this instant, so the day
 * boundary is computed in one place for the whole product rather than twice.
 */
export function offlineExpiry(date: string, timezone: string): string {
  return zonedDayRange(date, timezone).endIso;
}

export type Freshness = {
  band: "fresh" | "ageing" | "stale";
  minutes: number;
  /** hh:mm on the PRACTICE's clock -- an absolute stamp, never a relative "2 hours ago". */
  atLabel: string;
  /** The sentence, in full. s3.4.1: absolute, local time, in the content area. */
  sentence: string;
  /** Rendering weight, escalating with age. s3.4.2: the same grey badge at 8 minutes and 8 hours IS the failure. */
  tone: "amber" | "orange" | "red";
};

/** s3.4.2: labels escalate from 60 minutes. Under an hour a clinic day is materially accurate. */
export const STALENESS_AGEING_MINUTES = 60;
export const STALENESS_STALE_MINUTES = 180;

export function offlineFreshness(asOf: string, timezone: string, now: Date): Freshness {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(asOf)) / 60000));
  const atLabel = new Date(asOf).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", timeZone: timezone || "UTC",
  });
  const band = minutes >= STALENESS_STALE_MINUTES ? "stale"
    : minutes >= STALENESS_AGEING_MINUTES ? "ageing" : "fresh";
  const tone = band === "stale" ? "red" as const : band === "ageing" ? "orange" as const : "amber" as const;
  // ⚠ EVERY SENTENCE HERE MUST BE TRUE TODAY. None of them claims the data is current, and none of them
  // says "synced", "up to date" or "saved" -- there is no sync in phase one and nothing was saved.
  const sentence = band === "fresh"
    ? `Offline. Showing the day as it stood at ${atLabel}. Anything that has changed since is not here.`
    : band === "ageing"
      ? `Offline for over an hour. Showing the day as it stood at ${atLabel}. Appointments may have been cancelled or added since.`
      : `Offline for several hours. Showing the day as it stood at ${atLabel}. Treat every row as possibly wrong and confirm before acting on it.`;
  return { band, minutes, atLabel, sentence, tone };
}

/** What the reader is allowed to do with a record it found. */
export type OfflineReadResult =
  | { state: "ok"; day: OfflineDay; freshness: Freshness }
  /** ⚠ The record must be DELETED, not hidden. `reason` is shown; nothing else is. */
  | { state: "expired"; reason: string; purge: true }
  | { state: "clock_rollback"; reason: string; purge: false }
  | { state: "wrong_schema"; reason: string; purge: true }
  | { state: "none"; reason: string; purge: false };

/**
 * The one place that decides whether a cached day may be shown at all.
 *
 * ⚠ s3.4.3, the single most important rule in phase one: BEYOND THE THRESHOLD, RENDER NOTHING plus a
 * reason. An empty screen with a reason is safe; a stale screen is not.
 *
 * ⚠ The device clock is attacker-controlled and nothing at this layer changes that. Refusing when the
 * device believes it is EARLIER than the capture instant is cheap and catches casual tampering and a
 * genuinely wrong clock; it is not presented as a defence against a competent adversary.
 */
export function readOfflineDay(day: OfflineDay | null, now: Date): OfflineReadResult {
  if (!day) return { state: "none", reason: "Nothing has been cached on this device yet.", purge: false };
  if (day.schemaVersion !== OFFLINE_SCHEMA_VERSION)
    return {
      state: "wrong_schema", purge: true,
      reason: "This device holds a cached day in a format this version no longer reads, so it is discarded rather than guessed at.",
    };
  if (now.getTime() < Date.parse(day.asOf))
    return {
      state: "clock_rollback", purge: false,
      reason: "This device's clock is earlier than the moment this day was captured, so the age of what is stored cannot be worked out. Nothing is shown.",
    };
  if (now.getTime() >= Date.parse(day.expiresAt))
    return {
      state: "expired", purge: true,
      reason: "This device has not reached the practice since the day it cached ended. Today's list is not shown because it would be yesterday's.",
    };
  return { state: "ok", day, freshness: offlineFreshness(day.asOf, day.timezone, now) };
}

/**
 * ⚠ THE LIST ROW. It CANNOT carry the visit kind, because it does not name it.
 *
 * A flag on the render would have been one boolean away from disclosure. This is a different function
 * with a narrower return type, and the harness asserts the visit kind is not in its keys.
 */
export type OfflineListRow = {
  id: string; timeLabel: string; name: string;
  identifierValue: string | null; ageYears: number | null; status: string;
};

export function offlineListRow(p: OfflinePatient): OfflineListRow {
  return {
    id: p.id, timeLabel: p.timeLabel, name: p.name,
    identifierValue: p.identifierValue, ageYears: p.ageYears, status: p.status,
  };
}

/** What one patient's own record shows when it is opened deliberately. This one DOES carry the kind. */
export type OfflineRecordDetail = OfflineListRow & {
  identifierType: string | null;
  durationMinutes: number | null;
  visitKind: string;
  encounterId: string | null;
};

export function offlineRecordDetail(p: OfflinePatient): OfflineRecordDetail {
  return {
    ...offlineListRow(p),
    identifierType: p.identifierType,
    durationMinutes: p.durationMinutes,
    visitKind: p.visitKind,
    encounterId: p.encounterId,
  };
}

// ── THE CONTROLS AN OFFLINE SCREEN MAY RENDER ───────────────────────────────────────────────────────
//
// ⚠ s3.5, and it is the line that matters most: PHASE ONE ACCEPTS NO INPUT IT CANNOT DELIVER. A client
// that takes a write it later cannot sync has taken a clinical record and lost it -- and lost it
// silently, which is the part that does the harm.
//
// ⚠ THE ACCIDENT THIS EXISTS TO PREVENT: an offline screen that renders a form because the component was
// reused from the online page, and merely fails on submit. The user typed. The input was accepted. The
// duty felt discharged. Nothing arrived.
//
// So the controls are DATA, declared here, and the screen renders what this returns. Two properties are
// carried separately on purpose: whether activating a control would change a server record (`mutating`)
// and whether it is enabled. The rule is one line and the harness asserts it directly:
//
//     a mutating control is NEVER enabled offline.
//
// s3.4.6 is why they are rendered at all rather than hidden: "a greyed 'Start encounter' that says 'needs
// a connection' teaches the state; a missing button teaches nothing." A disabled button also cannot be
// typed into and then lost, which a merely-un-submittable input can.

export type OfflineControl = {
  key: string;
  label: string;
  /** True when activating this would change a record on the server. */
  mutating: boolean;
  enabled: boolean;
  /** Why it is disabled. Null only when it is enabled. */
  reason: string | null;
};

/** The controls offered beside one patient on the offline screen. */
export function offlineControls(p: OfflinePatient): OfflineControl[] {
  return [
    {
      key: `open:${p.id}`,
      label: "Show this record",
      // Expanding a row reads what is already on the device. It sends nothing and changes nothing.
      mutating: false,
      enabled: true,
      reason: null,
    },
    {
      key: `encounter:${p.id}`,
      label: p.encounterId ? "Open the consultation" : "Start a consultation",
      mutating: true,
      enabled: false,
      reason: "This needs a connection to the practice. Nothing typed here could be delivered, so nothing is accepted.",
    },
    {
      key: `arrive:${p.id}`,
      label: "Mark as arrived",
      mutating: true,
      enabled: false,
      reason: "This needs a connection to the practice. Nothing typed here could be delivered, so nothing is accepted.",
    },
  ];
}

/** ⚠ MUST BE EMPTY. The harness asserts it, over the real control list rather than over a mock. */
export function enabledMutatingControls(controls: OfflineControl[]): OfflineControl[] {
  return controls.filter(c => c.mutating && c.enabled);
}

// ── THE PROJECTION ──────────────────────────────────────────────────────────────────────────────────
//
// The source shapes are declared as INPUTS rather than imported from the engines, so that adding a
// column to practice_appointment or a field to TodaysPlan cannot widen what is cached. The projection
// reads what it names and nothing else.

export type CohortSource = {
  appointmentId: string;
  name: string;
  identifierType: string | null;
  identifierValue: string | null;
  ageYears: number | null;
  timeLabel: string;
  durationMinutes: number | null;
  status: string;
  encounterId: string | null;
  visitKind: string;
};

export type SessionSource = {
  id: string; kindLabel: string; startLabel: string; endLabel: string;
  state: "planned" | "running" | "done";
};

export function projectOfflinePatient(row: CohortSource): OfflinePatient {
  // FIELD BY FIELD. No spread, ever -- see the header.
  return {
    id: row.appointmentId,
    name: row.name,
    identifierType: row.identifierType,
    identifierValue: row.identifierValue,
    ageYears: row.ageYears,
    timeLabel: row.timeLabel,
    durationMinutes: row.durationMinutes,
    status: row.status,
    encounterId: row.encounterId,
    visitKind: row.visitKind,
  };
}

export function projectOfflineSession(row: SessionSource): OfflineSession {
  return {
    id: row.id, kindLabel: row.kindLabel,
    startLabel: row.startLabel, endLabel: row.endLabel, state: row.state,
  };
}

export function projectOfflineDay(input: {
  workspaceId: string;
  date: string;
  timezone: string;
  asOf: string;
  sessions: SessionSource[];
  patients: CohortSource[];
  feeders: Record<string, string>;
  patientsUnavailable: boolean;
  sessionsUnavailable: boolean;
}): OfflineDay {
  return {
    schemaVersion: OFFLINE_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    date: input.date,
    timezone: input.timezone,
    asOf: input.asOf,
    expiresAt: offlineExpiry(input.date, input.timezone),
    sessions: input.sessions.map(projectOfflineSession),
    patients: input.patients.map(projectOfflinePatient),
    // ⚠ THE QUEUE FEEDER IS DROPPED HERE, not hidden at render. The user's decision: the live queue is
    // suppressed offline entirely, because "3 waiting" is a claim about NOW and is the most
    // staleness-prone thing in the payload. Carrying its feeder state would invite a later reader to
    // conclude the queue is merely unavailable rather than deliberately absent.
    feeders: Object.fromEntries(
      Object.entries(input.feeders)
        .filter(([k]) => k !== "queue")
        .map(([k, v]) => [k, v === "ok" ? "ok" as const : "unavailable" as const]),
    ),
    patientsUnavailable: input.patientsUnavailable,
    sessionsUnavailable: input.sessionsUnavailable,
  };
}
