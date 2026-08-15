import type { CSSProperties } from "react";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-LIFE-001 PRACTICE LIFECYCLE & DECOMMISSIONING -- the constants, kept apart from the engine.
//
// Everything here is pure: no database client, no server import, no React. It is imported by the engine,
// by the booking engine (bookingBlock), by the client console and by the harness, and a value that four
// callers disagree about is a rule that only appears to exist.
//
// ---- WHAT THIS BUILD IS, AND WHAT IT DELIBERATELY IS NOT ------------------------------------------
//
// CPR-LIFE-001 names six lifecycle states. THIS BUILD IMPLEMENTS THE REVERSIBLE ONES ONLY -- Active,
// Archived, Suspended -- plus a read-only closure report. There is NO DELETE VERB anywhere in this
// file or the engine beside it, and there is no PENDING_DELETION or DELETED status: migration 247
// deliberately left both out of the CHECK constraint, and it names the three questions the
// specification does not answer (anonymisation, authorisation, the email confirmation step).
//
// ⚠ THE DESTRUCTIVE VERB ALREADY EXISTS AND IS NOT REACHED FROM HERE. scripts/practice-pilot-gate.ts
// deletes a practice_workspace row and 111 cascading foreign keys follow it. Every part of CPR-LIFE-001
// that costs effort is a BRAKE on that. The natural build order -- verb first, brakes later -- produces
// a working irreversible destructor with some of its safeties missing at every intermediate commit,
// which is why the verb is absent rather than unfinished.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ THE FIVE CODES, AND THEY ARE THE FIVE THAT ARE LIVE.
 *
 * Probed against practice_role_capabilities on 2026-08-07: practice.lifecycle.view, practice.archive,
 * practice.suspend and practice.restore were seeded by migration 247, and data.export has existed since
 * migration 202 and was granted to practice_owner by 247. NOTHING ELSE IS USED.
 *
 * Six invented capability codes have shipped on this product before. An invented code compiles, reviews
 * clean, and returns 403 for every user including the owner -- so this array is asserted against the
 * live catalogue by the harness, exactly as PARAMETER_CAPABILITIES is.
 *
 * ⚠ AND THE ROUTE STILL WRITES EACH CODE AS AN INLINE DOUBLE-QUOTED LITERAL. practice-audit-harness's
 * capabilityCodesInSource() matches only that shape; a code reaching requirePracticeContext through a
 * constant is invisible to it.
 */
export const LIFECYCLE_CAPABILITIES = [
  "practice.lifecycle.view",
  "practice.archive",
  "practice.suspend",
  "practice.restore",
  "data.export",
] as const;

export const CAP_VIEW = "practice.lifecycle.view";
export const CAP_ARCHIVE = "practice.archive";
export const CAP_SUSPEND = "practice.suspend";
export const CAP_RESTORE = "practice.restore";
export const CAP_EXPORT = "data.export";

// ── THE STATE SET ────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ practice_workspace.status IS A PROVISIONING STATE MACHINE THAT NOW ALSO CARRIES LIFECYCLE STATES.
// Migration 191 wrote ten values and 247 added ARCHIVED. Five of the eleven -- REQUESTED,
// IDENTITY_PENDING, PROVISIONING, MIGRATING, FAILED -- are provisioning states and are NOT lifecycle
// states. A six-node lifecycle pipeline rendered from an eleven-value column would eventually draw
// FAILED to a practitioner as though it were somewhere their practice had chosen to be.
//
// So the vocabulary is split here and the screen renders the lifecycle ones as a state, the rest as
// "this practice is still being set up" or "something went wrong while it was being set up".

export const LIFECYCLE_STATUSES = ["ACTIVE", "ARCHIVED", "SUSPENDED", "CLOSING", "CLOSED"] as const;
export const PROVISIONING_STATUSES = [
  "REQUESTED", "IDENTITY_PENDING", "PROVISIONING", "ONBOARDING", "MIGRATING", "FAILED",
] as const;

export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

/** What each status means, in CPR-LIFE-001 s2's own words where it has them. */
export const STATUS_MEANING: Record<string, string> = {
  ACTIVE: "Normal operation.",
  ARCHIVED: "Hidden from daily use, bookings disabled, fully recoverable.",
  SUSPENDED: "Temporarily inaccessible for an administrative or licensing reason.",
  CLOSING: "Being wound down. Nothing in this build puts a practice here.",
  CLOSED: "Operations permanently ceased. Data retained, booking disabled. Nothing in this build puts a practice here.",
  ONBOARDING: "Still being set up. Its lifecycle has not started yet.",
  PROVISIONING: "Being created. Its lifecycle has not started yet.",
  REQUESTED: "Requested but not yet created.",
  IDENTITY_PENDING: "Waiting on the practitioner's identity check.",
  MIGRATING: "Being moved between plans or owners.",
  FAILED: "Creation did not complete. This is a provisioning fault, not a lifecycle state.",
};

/**
 * ⚠ THE STATUSES THAT REFUSE A BOOKING.
 *
 * s2 says of Archived "bookings disabled" and of Closed "booking links disabled"; s10's third acceptance
 * criterion is "Closed practices cannot receive bookings". Suspended is "temporarily inaccessible", which
 * cannot mean a diary that keeps filling.
 *
 * CLOSING is here too. A practice being wound down that still takes bookings is the same failure with a
 * shorter fuse -- and nothing in this build ever sets CLOSING, so including it costs nothing today and
 * closes the hole on the day something does.
 *
 * ⚠ ONBOARDING AND PROVISIONING ARE NOT HERE. A practice being set up books appointments during setup,
 * and every existing harness fixture books against a workspace in one of those states.
 */
export const NON_BOOKING_STATUSES: string[] = ["ARCHIVED", "SUSPENDED", "CLOSING", "CLOSED"];

/**
 * Does this practice's status refuse a booking? `null` means it does not.
 *
 * ⚠ A STATUS THAT COULD NOT BE READ IS NOT AN ACTIVE ONE, AND IT IS NOT A REFUSAL EITHER. The caller
 * passes `null` for an unreadable status and gets STATUS_UNREADABLE back -- a booking made while nobody
 * could tell whether the practice was archived is the failure this whole function exists to stop, and
 * silently allowing it would be the two-state version of the three-state doctrine.
 */
export function bookingBlock(status: string | null | undefined): { code: string; message: string } | null {
  if (status === null || status === undefined || status === "") {
    return {
      code: "PRACTICE_STATUS_UNREADABLE",
      message: "this booking was not made because whether this practice is open could not be read -- an unread status is not an active one",
    };
  }
  if (!NON_BOOKING_STATUSES.includes(status)) return null;
  const phrase = status === "ARCHIVED" ? "archived"
    : status === "SUSPENDED" ? "suspended"
      : status === "CLOSING" ? "being closed" : "closed";
  return {
    code: "PRACTICE_NOT_BOOKABLE",
    message: `this practice is ${phrase}, so it is not taking bookings${status === "ARCHIVED" || status === "SUSPENDED" ? ". Restoring it re-opens the diary" : ""}`,
  };
}

// ── THE THREE VERBS ──────────────────────────────────────────────────────────────────────────────────

export type LifecycleAction = "archive" | "suspend" | "restore";

export type ActionSpec = {
  action: LifecycleAction;
  label: string;
  /** The statuses this verb may be applied FROM. */
  from: string[];
  to: LifecycleStatus;
  capability: string;
  /** What it does, said plainly, on the button's own confirmation. */
  effect: string;
  /** What it does NOT do. Every one of these three is reversible and none of them removes a row. */
  reversibleBy: LifecycleAction | null;
};

/**
 * ⚠ ARCHIVE AND SUSPEND DIFFER BY INTENT, NOT BY EFFECT, AND THE SCREEN HAS TO SAY SO.
 *
 * Both hide the practice and stop bookings. s2 separates them by why: suspension is a temporary
 * disablement pending something (a payment, an investigation, a licence), archive is a practice put away
 * while fully preserved. Only archive is offered as an ordinary, blameless act -- a practitioner who
 * "suspends" their own practice because the two buttons looked the same has recorded a fact about
 * themselves that is not true.
 */
export const LIFECYCLE_ACTIONS: ActionSpec[] = [
  {
    action: "archive", label: "Archive this practice",
    from: ["ACTIVE"], to: "ARCHIVED", capability: CAP_ARCHIVE,
    effect: "The practice is hidden from daily use and stops taking bookings. Every record stays exactly where it is: nothing is removed, nothing is anonymised, and restoring it returns the practice to normal operation.",
    reversibleBy: "restore",
  },
  {
    action: "suspend", label: "Suspend this practice",
    from: ["ACTIVE", "ARCHIVED"], to: "SUSPENDED", capability: CAP_SUSPEND,
    effect: "The practice becomes temporarily inaccessible for an administrative or licensing reason and stops taking bookings. Nothing is removed. Restoring it returns the practice to normal operation.",
    reversibleBy: "restore",
  },
  {
    action: "restore", label: "Restore this practice",
    from: ["ARCHIVED", "SUSPENDED"], to: "ACTIVE", capability: CAP_RESTORE,
    effect: "The practice returns to normal operation and starts taking bookings again. s10's second acceptance criterion: an archived practice is restored with full functionality.",
    reversibleBy: null,
  },
];

export const actionSpec = (a: string): ActionSpec | null =>
  LIFECYCLE_ACTIONS.find(s => s.action === a) ?? null;

/** s7 asks for "why" on every transition, and migration 247 made the column NOT NULL to enforce it. */
export const REASON_MIN = 3;
export const REASON_MAX = 1000;

// ── THE CLOSURE CHECKLIST (s4), AND THE TWO LINES THAT CANNOT BE CHECKED ─────────────────────────────

/**
 * ⚠ A LINE WE CANNOT CHECK SAYS SO. IT IS NEVER DRAWN AS AN EMPTY BOX.
 *
 * s4 names six checks. Two of them have no store in this product at all: `practice_integration` does not
 * exist (probed live and absent) and there is no billing module, so there is no invoice to review. An
 * unticked box tells a practitioner "you have not done this". The truth is "we cannot tell", and those
 * are different sentences on the one screen where the difference matters.
 *
 * `verdict: "no_store"` is therefore a first-class state beside met/unmet/unreadable, and the console
 * renders it as a statement rather than as a control.
 */
export type ClosureVerdict = "met" | "unmet" | "unreadable" | "no_store";

export const CLOSURE_NO_STORE: Record<string, string> = {
  invoices: "The billing store EXISTS now (migration 303: charges, invoices, payments, receipts) but the closure checklist has not yet been taught to read it -- so this line still cannot be checked by software and has to be checked by you, in the Payments workspace, before closing. Wiring closure to the billing tables is a named open gap, not an oversight.",
  integrations: "There is no integration store in this product. practice_integration does not exist, no calendar, messaging, payment or FHIR connection is recorded anywhere, so there is nothing to disconnect and nothing to report on.",
};

// ── WHAT THIS BUILD REFUSES TO RENDER, AND WHY ──────────────────────────────────────────────────────

/**
 * ⚠ THE REFUSALS TRAVEL WITH THE PAYLOAD.
 *
 * A screen that simply lacks a figure looks like a screen that has not finished loading. One that
 * carries the reason is telling the truth, and the reason is the useful part -- each of these is a
 * question somebody has to answer before the thing can be built.
 */
export const LIFECYCLE_REFUSALS: Record<string, string> = {
  permanent_deletion:
    "There is no way to delete a practice from this screen, and that is deliberate rather than unfinished. "
    + "CPR-LIFE-001 does not say what Deleted does to the data -- which rows go, which are retained, what a "
    + "retention check checks or against what policy, or what happens to a patient who also attends another "
    + "practice. It also requires an email confirmation step, and this product has no way to send one. Until "
    + "those are answered a delete pipeline would be a working irreversible destructor with some of its "
    + "safeties missing.",
  anonymisation:
    "Nothing in this product anonymises a clinical record, and nothing here claims to. "
    + "CPR-LIFE-001 is 61 lines long and never uses the word. Free-text notes, note version history, "
    + "correspondence and uploaded scans all carry identifiers in prose and in pixels, and there is no "
    + "de-identification engine here. Archiving and suspending a practice change one column and remove "
    + "nothing at all.",
  storage_quota:
    "There is no storage quota anywhere in this product. No plan, entitlement, configuration or workspace "
    + "row carries one, so there is no denominator to draw a bar against -- and a bar against a limit "
    + "nobody set is a warning that will never fire and a reassurance that means nothing. The bytes below "
    + "are reported without one, which is the same answer the document library reached.",
  integrations:
    "practice_integration does not exist. There is no calendar, messaging, payment or FHIR connection "
    + "recorded anywhere in this product, so a count of connected integrations could only ever be nought "
    + "and is not drawn.",
  export_formats:
    "s5 asks for PDF, CSV, JSON and ZIP. Only JSON is built. A format offered and not produced is worse "
    + "than one that is absent, because the practitioner finds out after they have relied on it.",
  export_billing:
    "s5's export list names billing. There is no billing module in this product, so that section of the "
    + "export is declared as unavailable rather than emitted empty -- an export that silently omits a "
    + "named category is worse than one that says the category does not exist.",
  restore_lockout:
    "A practice that is not ACTIVE is refused by the workspace guard every Practice page runs, so this "
    + "page is not reachable once the practice is archived or suspended. Restoring is therefore offered on "
    + "the access-status screen a member lands on instead. Nothing about that is a permission change: the "
    + "same practice.restore capability decides it.",
};

/**
 * ⚠ WHICH TABLES THE BYTE FIGURE COVERS, AS A FIELD RATHER THAN AS PAGE TEXT.
 *
 * byte_size exists on exactly two tables in this schema. A single figure labelled "Storage used" would
 * silently exclude the clinical record itself -- generated clinical documents are structured rows, not
 * files -- so the figure names its own scope and the client prints it.
 */
export const BYTES_COVER = ["practice_attachment", "practice_library_document"];
export const BYTES_EXCLUDE =
  "the clinical record itself. Encounters, notes, problems, diagnoses, treatments and generated clinical "
  + "documents are structured rows with no byte size, so they are not in this figure.";

/**
 * ⚠ "DOCUMENTS" IS THREE DIFFERENT TABLES AND IS NEVER ONE NUMBER HERE.
 *
 * practice_clinical_document (authored clinical documents), practice_library_document (practice library
 * files) and practice_attachment (uploads on encounters) are three different things. One number labelled
 * "Documents" that silently means one of them is not honest, so each is counted and named.
 */
export const DOCUMENT_TABLES = [
  { key: "clinical", table: "practice_clinical_document", label: "Clinical documents", detail: "Letters, reports and certificates authored in this practice." },
  { key: "library", table: "practice_library_document", label: "Library files", detail: "Files uploaded to the practice document library." },
  { key: "attachments", table: "practice_attachment", label: "Encounter attachments", detail: "Files attached to a consultation." },
];

// ── COLOUR ───────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ THESE BELONG IN src/lib/practice/palette.ts AND ARE PARKED HERE ON PURPOSE. palette.ts is being
// edited by another agent in this session and a second writer would clobber it. Every value below is an
// existing --cp token or a Tailwind step of one -- nothing new is invented -- so moving this map into
// palette.ts later is a cut and paste with no visual change.

export type LifecycleSwatch = { chip: string; dot: string; box: string; figure: string };

export const STATUS_SWATCH: Record<string, LifecycleSwatch> = {
  ACTIVE: { chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500", box: "border-emerald-200 bg-emerald-50/60", figure: "text-emerald-700" },
  ARCHIVED: { chip: "bg-slate-200 text-slate-700", dot: "bg-slate-500", box: "border-slate-300 bg-slate-50", figure: "text-slate-700" },
  SUSPENDED: { chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500", box: "border-amber-200 bg-amber-50/60", figure: "text-amber-700" },
  CLOSING: { chip: "bg-orange-100 text-orange-800", dot: "bg-orange-500", box: "border-orange-200 bg-orange-50/60", figure: "text-orange-700" },
  CLOSED: { chip: "bg-rose-100 text-rose-800", dot: "bg-rose-500", box: "border-rose-200 bg-rose-50/60", figure: "text-rose-700" },
  ONBOARDING: { chip: "bg-sky-100 text-sky-800", dot: "bg-sky-500", box: "border-sky-200 bg-sky-50/60", figure: "text-sky-700" },
  FAILED: { chip: "bg-rose-100 text-rose-800", dot: "bg-rose-500", box: "border-rose-200 bg-rose-50/60", figure: "text-rose-700" },
};

export const STATUS_SWATCH_UNKNOWN: LifecycleSwatch = {
  chip: "bg-slate-100 text-slate-600", dot: "bg-slate-400",
  box: "border-slate-200 bg-slate-50", figure: "text-slate-600",
};

export const swatchFor = (status: string | null): LifecycleSwatch =>
  (status ? STATUS_SWATCH[status] : undefined) ?? STATUS_SWATCH_UNKNOWN;

/** The verdict chips on the closure report. `no_store` is visually distinct from `unmet` on purpose. */
export const CLOSURE_CHIP: Record<ClosureVerdict, { label: string; chip: string; mark: string }> = {
  met: { label: "Clear", chip: "bg-emerald-100 text-emerald-800", mark: "✓" },
  unmet: { label: "Outstanding", chip: "bg-amber-100 text-amber-800", mark: "!" },
  unreadable: { label: "Could not be read", chip: "bg-slate-200 text-slate-700", mark: "?" },
  no_store: { label: "No store — cannot be checked", chip: "bg-violet-100 text-violet-800", mark: "—" },
};

/** The one style helper this console needs, matching palette.ts's own tintedCard shape. */
export function tintedPanel(colour: string): CSSProperties {
  return { borderColor: `color-mix(in srgb, ${colour} 30%, transparent)`, backgroundColor: `color-mix(in srgb, ${colour} 6%, transparent)` };
}
