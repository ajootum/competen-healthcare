// CP-OFFLINE-SURVEY-001 s5 precondition 5 — THE CONFLICT SURFACE.
// COMP-CONF-001 s6 (Clinical Safety Rules), CP-SYNC-001 s6, COMP-SYNC-001 s8.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// THE SPECIFICATION, IN FULL, BECAUSE IT IS FOUR BULLETS AND ALL FOUR ARE LOAD-BEARING.
//
// COMP-CONF-001 s6 reads: "never silently overwrite clinically significant data; preserve both values
// until resolved when required; display clear comparison to the user; record all decisions in the audit
// log." There is no per-entity matrix and no named strategy -- the survey checked, and the "Server Wins
// + Always Require Review" rule attributed to this section appears nowhere in any of the nineteen
// documents. So the policy is OURS to choose, and these four are the constraints on the choice.
//
// This module is the first three. The fourth is the caller's, through audit().
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ WHAT THIS DELIBERATELY DOES NOT DO: AUTO-MERGE. AND THE REASON IS THAT IT CANNOT BE DONE SAFELY
// YET, NOT THAT IT WAS FORGOTTEN.
//
// CP-SYNC-001 s6 and COMP-SYNC-001 s8 both ask to "auto-merge non-conflicting field changes". Deciding
// that a field is NON-conflicting requires a THREE-WAY comparison: the value the practitioner started
// from, the value they made it, and the value the server holds now. Only the base tells you whether the
// server ALSO changed that field or merely holds the value it always had.
//
// This product does not store base values. A transaction carries `baseVersion` -- a number, enough to
// detect that the record moved, and not enough to say WHICH fields moved. There is no field-level change
// log for online edits either.
//
// So a two-way comparison cannot distinguish "only I changed this" from "we both changed this", and an
// auto-merge built on it would silently overwrite a colleague's edit while reporting a clean merge --
// which is precisely the thing the first bullet of s6 forbids. It would also be the fourth promise this
// product has had to withdraw.
//
// ⚠ WHAT WOULD CLOSE IT, written down so it is a decision and not a hole: carry the base values of the
// changed fields in the transaction payload (they are already in the practitioner's hands at capture
// time), or keep a field-level change log server-side. The first is cheap and is the obvious route. It
// is not built, so nothing here claims to merge.
//
// EVERY CONFLICT THEREFORE GOES TO A PERSON. That is a stricter policy than the spec asks for, it is
// permitted (s5's strategies are "a menu, not an assignment"), and it is the only one that can be
// honestly implemented on what is stored today.

/** What a practitioner recorded offline, beside what the practice holds now. One row of the comparison. */
export type ConflictField = {
  /** The column or property name. Machine-facing. */
  field: string;
  /** What a person calls it. ⚠ Never the column name -- see conflictLabel. */
  label: string;
  /** The value the practitioner recorded while offline. */
  mine: unknown;
  /** The value the practice holds now. */
  theirs: unknown;
  /**
   * ⚠ TRUE UNLESS AN APPLIER SAYS OTHERWISE. See CONFLICT_UNKNOWN_FIELD_IS_SIGNIFICANT: a field nobody
   * has classified is treated as clinically significant, because the failure of guessing wrong in that
   * direction is a delay and the failure of guessing wrong the other way is an overwritten diagnosis.
   */
  significant: boolean;
};

/**
 * ⚠ THE FAIL-SAFE DEFAULT, AS A NAMED CONSTANT SO IT CANNOT BE CHANGED BY ACCIDENT.
 *
 * An applier declares which of its fields are clinically significant. Anything it does not mention is
 * significant. An applier added in six months that forgets the declaration gets the strict behaviour and
 * a conflict a person has to look at -- not a silent overwrite.
 */
export const CONFLICT_UNKNOWN_FIELD_IS_SIGNIFICANT = true;

export type ConflictResolution =
  /** Apply what the practitioner recorded offline, over what the practice holds. */
  | "keep_mine"
  /** Discard the offline change and keep what the practice holds. ⚠ Still recorded, never deleted. */
  | "keep_theirs"
  /** Neither is right on its own and the practitioner will re-enter it. */
  | "redo_by_hand";

export const CONFLICT_RESOLUTIONS: readonly ConflictResolution[] =
  ["keep_mine", "keep_theirs", "redo_by_hand"] as const;

/**
 * ⚠ EVERY RESOLUTION NEEDS WORDS, AND THAT IS NOT BUREAUCRACY.
 *
 * s6's fourth rule is "record all decisions in the audit log". A recorded decision with no reason answers
 * "what happened" and not "why", and the second is the only one that helps the next clinician reading the
 * record. The same rule delegation.ts already applies to a rejected approval, and migration 259 to a dose
 * given without a weight.
 */
export const CONFLICT_REASON_REQUIRED = true;
export const CONFLICT_REASON_MIN = 3;

export type ConflictDecision = {
  transactionId: string;
  resolution: ConflictResolution;
  reason: string;
  decidedBy: string;
  decidedAt: string;
};

// ── THE COMPARISON ──────────────────────────────────────────────────────────────────────────────────

/**
 * Build the comparison rows for one conflict.
 *
 * ⚠ IT COMPARES ONLY THE FIELDS THE PRACTITIONER ACTUALLY CHANGED. The payload is a delta
 * (COMP-SYNC-001 s5), so its keys are the edits. Comparing every column would fill the screen with rows
 * that differ for reasons nobody is being asked about, and the one row that matters would be lost in it.
 *
 * ⚠ A FIELD WHOSE VALUES MATCH IS NOT A CONFLICT and is dropped. Somebody who typed the same value the
 * practice already holds has not disagreed with anybody.
 */
export function compareConflict(input: {
  mine: Record<string, unknown>;
  theirs: Record<string, unknown>;
  labels?: Record<string, string>;
  /** Fields this applier declares NOT clinically significant. Everything else is. */
  insignificant?: string[];
}): ConflictField[] {
  const insignificant = new Set(input.insignificant ?? []);
  const rows: ConflictField[] = [];
  for (const field of Object.keys(input.mine ?? {})) {
    const mine = input.mine[field];
    const theirs = (input.theirs ?? {})[field];
    if (sameValue(mine, theirs)) continue;
    rows.push({
      field,
      label: conflictLabel(field, input.labels),
      mine, theirs,
      significant: insignificant.has(field) ? false : CONFLICT_UNKNOWN_FIELD_IS_SIGNIFICANT,
    });
  }
  return rows;
}

/** JSON-equality, so `{a:1}` and `{a:1}` are the same answer rather than two objects. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

/**
 * ⚠ A COLUMN NAME IS NOT A LABEL. "reason_for_visit" on a screen asking somebody to choose between two
 * clinical values is the product showing its plumbing at the moment it most needs to be understood. An
 * applier supplies labels; this falls back to something readable rather than to the raw key.
 */
export function conflictLabel(field: string, labels?: Record<string, string>): string {
  const given = labels?.[field];
  if (given && given.trim()) return given.trim();
  const words = field.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** ⚠ ANY significant field makes the whole transaction a person's decision. See needsAPerson. */
export function hasSignificantConflict(fields: ConflictField[]): boolean {
  return fields.some(f => f.significant);
}

/**
 * ⚠ TRUE FOR EVERY CONFLICT TODAY, AND THE FUNCTION EXISTS ANYWAY.
 *
 * With no base values there is no safe auto-merge, so every conflict goes to a person -- see the header.
 * This is written as a predicate rather than as `return true` so that the day base values arrive, the
 * rule has one place to change and the harness has something to assert about it. A hard-coded `true`
 * would have to be found and reasoned about instead.
 */
export function needsAPerson(fields: ConflictField[]): boolean {
  if (fields.length === 0) return false;
  if (hasSignificantConflict(fields)) return true;
  // Even an all-insignificant conflict waits: without a base we cannot tell whose change is newer, only
  // that they differ, and "it was only the phone number" is a judgement about a record we cannot make.
  return true;
}

/**
 * Whether a decision may be recorded.
 *
 * ⚠ IT REFUSES A BLANK REASON WITH btrim SEMANTICS, not `is not null`. Migration 256 shipped a
 * not-null reason believing it stopped an empty one, and a blank string is not null -- it cost migration
 * 257. The same mistake here would let somebody overwrite a colleague with the space bar.
 */
export function validateDecision(input: { resolution: string; reason: string }):
  { ok: true } | { ok: false; code: string; message: string } {
  if (!CONFLICT_RESOLUTIONS.includes(input.resolution as ConflictResolution))
    return { ok: false, code: "UNKNOWN_RESOLUTION", message: "That is not one of the ways this can be settled." };
  const reason = (input.reason ?? "").trim();
  if (CONFLICT_REASON_REQUIRED && reason.length < CONFLICT_REASON_MIN)
    return {
      ok: false, code: "REASON_REQUIRED",
      message: "Say why you settled it this way. The next person reading this record needs to know what happened here, not just which value won.",
    };
  return { ok: true };
}

// ── WHAT A PERSON READS ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ EVERY SENTENCE TRUE TODAY. None of these says "merged", because nothing merges, and none says the
 * offline copy was lost, because it never is -- outbox-model.ts refuses to remove anything undelivered.
 */
export function conflictSentence(fields: ConflictField[]): string {
  if (fields.length === 0)
    return "This did not go through, and the practice did not say which value it disagreed with.";
  const significant = fields.filter(f => f.significant).length;
  const names = fields.map(f => f.label).join(", ");
  if (significant > 0)
    return `The practice has changed since you recorded this, and ${significant === 1 ? "one of the things you changed" : `${significant} of the things you changed`} is clinical: ${names}. Nothing has been overwritten and nothing has been lost — you decide which stands.`;
  return `The practice has changed since you recorded this: ${names}. Nothing has been overwritten and nothing has been lost — you decide which stands.`;
}

export function resolutionLabel(r: ConflictResolution): { label: string; detail: string } {
  switch (r) {
    case "keep_mine": return {
      label: "Use what I recorded",
      detail: "What you wrote offline replaces what the practice holds. The previous value stays in the record.",
    };
    case "keep_theirs": return {
      label: "Keep what the practice has",
      detail: "Your offline change is set aside. It is kept on this device and in the record of this decision — it is not deleted.",
    };
    case "redo_by_hand": return {
      label: "Neither — I will redo it",
      detail: "Nothing is applied. The record stays as the practice has it, and what you wrote is kept so you can work from it.",
    };
  }
}

/** ⚠ Shown next to the choice, not after it. A decision is not informed if the caveat arrives later. */
export const CONFLICT_NOTHING_IS_DISCARDED =
  "Whichever you choose, both values are kept: the one the practice held, the one you recorded, and the "
  + "reason you gave. Nothing here is deleted by settling it.";
