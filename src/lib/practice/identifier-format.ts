import { audit } from "@/lib/practice/provisioning";
import type { EngineResult } from "@/lib/practice/encounters";

// THE ONE PLACE THAT KNOWS THE SHAPE OF A PRACTITIONER NUMBER.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// FORMAT: CP-000001-4
//
//   CP        Competen Practice. Deliberately NOT 'CPR': in this repository a bare CPR-nnn is a
//             SPECIFICATION id (CPR-240 is the portfolio spec), and PIS-000 s2's CPR-000001 differs
//             from it only by digit count -- a distinction a human skimming a support ticket will miss.
//   000001    six digits from the sequence, zero-padded.
//   -4        a Damm check digit.
//
// THE CHECK DIGIT IS THE SUBSTANTIVE PART. PIS-000 s11 lets a patient find a practitioner BY NUMBER.
// Without one, CP-000132 is exactly as valid as CP-000123 and resolves to A DIFFERENT REAL CLINICIAN --
// the patient reaches the wrong person and nothing notices, because both numbers are real. Damm catches
// every single-digit error and every adjacent transposition: the two mistakes people actually make.
//
// "CHANGES EVERYWHERE" MEANS FUTURE ISSUANCE, NOT A REWRITE. An issued number is on printed cards and in
// QR codes; rewriting it would mean it was never permanent. So: one place knows the shape, every future
// number and every validator follows it at once, and each identity records the version it was issued
// under. Numbers already issued keep resolving forever.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

export type IdentifierFormat = {
  key: string; prefix: string; digits: number; checkDigit: boolean; separator: string;
  version: number; locked: boolean; updatedAt: string | null; updatedBy: string | null;
  changeReason: string | null;
};

/** The shape used when the table has not been read yet. Matches migration 220's seed exactly. */
export const DEFAULT_FORMAT: IdentifierFormat = {
  key: "practitioner_number", prefix: "CP", digits: 6, checkDigit: true, separator: "-",
  version: 1, locked: false, updatedAt: null, updatedBy: null, changeReason: null,
};

// ── DAMM ─────────────────────────────────────────────────────────────────────────────────────────────
//
// The standard order-10 anti-symmetric quasigroup. Not invented here and not adjustable: the property
// that makes it work -- every single-digit error and every adjacent transposition detected -- is a
// property of THIS table, and a "tidied" one silently stops detecting things.

const DAMM: readonly (readonly number[])[] = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];

/** The check digit for a string of digits. */
export function dammDigit(digits: string): number {
  let interim = 0;
  for (const ch of digits) {
    const d = ch.charCodeAt(0) - 48;
    if (d < 0 || d > 9) throw new Error(`not a digit: ${ch}`);
    interim = DAMM[interim][d];
  }
  return interim;
}

/** True when the digits already carry a correct trailing check digit. */
export const dammValid = (digitsWithCheck: string) => dammDigit(digitsWithCheck) === 0;

// ── FORMATTING AND PARSING ───────────────────────────────────────────────────────────────────────────

export function formatPractitionerNumber(sequence: number | bigint, format: IdentifierFormat): string {
  const body = String(sequence).padStart(format.digits, "0");
  if (body.length > format.digits)
    throw new Error(`sequence ${sequence} does not fit in ${format.digits} digits -- the format needs widening before the next issue`);
  const core = `${format.prefix}${format.separator}${body}`;
  return format.checkDigit ? `${core}${format.separator}${dammDigit(body)}` : core;
}

/**
 * Parse and check a number a human typed.
 *
 * TOLERANT ABOUT PRESENTATION, STRICT ABOUT THE DIGITS. A patient reading a number off a card will type
 * spaces, lowercase, or no separators at all; none of that changes who they meant. A wrong digit does,
 * so it is refused rather than resolved to somebody else.
 */
export function parsePractitionerNumber(raw: string, format: IdentifierFormat): {
  ok: boolean; normalised?: string; reason?: "empty" | "prefix" | "length" | "check";
} {
  const cleaned = raw.trim().toUpperCase().replace(/[\s./-]/g, "");
  if (!cleaned) return { ok: false, reason: "empty" };
  if (!cleaned.startsWith(format.prefix)) return { ok: false, reason: "prefix" };

  const digits = cleaned.slice(format.prefix.length);
  if (!/^\d+$/.test(digits)) return { ok: false, reason: "length" };

  const expected = format.digits + (format.checkDigit ? 1 : 0);
  if (digits.length !== expected) return { ok: false, reason: "length" };
  // THE WHOLE POINT: a transposed pair fails here instead of resolving to another real clinician.
  if (format.checkDigit && !dammValid(digits)) return { ok: false, reason: "check" };

  const body = format.checkDigit ? digits.slice(0, -1) : digits;
  return { ok: true, normalised: formatPractitionerNumber(Number(body), format) };
}

// ── READING AND CHANGING THE FORMAT ──────────────────────────────────────────────────────────────────

export async function getFormat(admin: any, key = "practitioner_number"): Promise<IdentifierFormat> {
  const { data, error } = await admin.from("practice_identifier_format")
    .select("*").eq("key", key).maybeSingle();
  // A FORMAT THAT CANNOT BE READ IS NOT AN EXCUSE TO INVENT ONE SILENTLY. The default matches the seed
  // exactly, and the failure is logged so a missing migration is visible rather than papered over.
  if (error) {
    console.error(`[practice] could not read identifier format "${key}" -- using the built-in default: ${error.message}`);
    return DEFAULT_FORMAT;
  }
  if (!data) return DEFAULT_FORMAT;
  return {
    key: data.key, prefix: data.prefix, digits: data.digits, checkDigit: data.check_digit,
    separator: data.separator, version: data.version, locked: data.locked,
    updatedAt: data.updated_at, updatedBy: data.updated_by, changeReason: data.change_reason,
  };
}

/** The phrase an operator must type to change a locked format. Deliberately not "yes". */
export const FORMAT_CHANGE_ACKNOWLEDGEMENT = "I understand existing numbers will not change";

export async function updateFormat(admin: any, args: {
  key?: string; prefix?: string; digits?: number; checkDigit?: boolean; separator?: string;
  reason: string; acknowledgement?: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ version: number; example: string }>> {
  const key = args.key ?? "practitioner_number";
  const current = await getFormat(admin, key);

  if (!args.reason || args.reason.trim().length < 10)
    return { ok: false, status: 400, code: "REASON_REQUIRED", message: "say why the format is changing -- this is recorded and read later" };

  // DIFFICULT TO CHANGE, AND THIS IS THE MECHANISM. Once a number has been issued the format is locked,
  // and unlocking it means typing a sentence that states the consequence. A yes/no confirmation is
  // clicked without reading; a sentence has to be understood to be reproduced.
  if (current.locked && args.acknowledgement !== FORMAT_CHANGE_ACKNOWLEDGEMENT)
    return {
      ok: false, status: 409, code: "ACKNOWLEDGEMENT_REQUIRED",
      message: `numbers have already been issued in this format. To change it, acknowledge: "${FORMAT_CHANGE_ACKNOWLEDGEMENT}"`,
    };

  const next = {
    prefix: (args.prefix ?? current.prefix).toUpperCase().trim(),
    digits: args.digits ?? current.digits,
    checkDigit: args.checkDigit ?? current.checkDigit,
    separator: args.separator ?? current.separator,
  };

  if (!/^[A-Z]{1,6}$/.test(next.prefix))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a prefix is one to six capital letters" };
  if (!Number.isInteger(next.digits) || next.digits < 4 || next.digits > 12)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "between 4 and 12 digits" };
  if (!["-", "/", ".", ""].includes(next.separator))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the separator must be -, /, . or nothing" };

  // NARROWING IS REFUSED WHILE IT WOULD STRAND THE SEQUENCE. Dropping to four digits when 20,000 numbers
  // have been issued means the next issue cannot be formatted at all, and would fail at the moment a
  // practitioner registers rather than here.
  const { data: highest } = await admin.from("practice_practitioner_identity")
    .select("number_format_version, practitioner_number").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (highest) {
    const { data: seq } = await admin.rpc("practice_next_practitioner_sequence");
    // Reading the sequence advances it. That is acceptable -- a skipped number is not a reused one, and
    // s2 forbids reuse, not gaps.
    if (seq != null && String(seq).length > next.digits)
      return {
        ok: false, status: 409, code: "TOO_NARROW",
        message: `${next.digits} digits cannot hold the next number (${seq}) -- widen it instead`,
      };
  }

  const version = current.version + 1;
  const { error: historyError } = await admin.from("practice_identifier_format_history").insert({
    key, version, prefix: next.prefix, digits: next.digits,
    check_digit: next.checkDigit, separator: next.separator,
    previous: { prefix: current.prefix, digits: current.digits, checkDigit: current.checkDigit, separator: current.separator, version: current.version },
    change_reason: args.reason.trim(), changed_by: args.actorId,
  });
  // THE HISTORY WRITE COMES FIRST AND ITS FAILURE STOPS THE CHANGE, for the reason CPR-230 gives about
  // reflections: a change nobody can account for later is worse than no change.
  if (historyError)
    return { ok: false, status: 500, code: "HISTORY_FAILED", message: `the change could not be recorded, so nothing was changed: ${historyError.message}` };

  const { data: updated, error } = await admin.from("practice_identifier_format").update({
    prefix: next.prefix, digits: next.digits, check_digit: next.checkDigit, separator: next.separator,
    version, updated_at: new Date().toISOString(), updated_by: args.actorId,
    change_reason: args.reason.trim(),
  }).eq("key", key).select("version");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!updated || updated.length === 0)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "no such identifier format" };

  await audit(admin, {
    workspaceId: null, actorId: args.actorId, eventType: "practice.identifier_format_changed",
    payload: { key, version, from: { ...current }, to: next, reason: args.reason.trim() },
    correlationId: args.correlationId,
  });

  const format: IdentifierFormat = { ...current, ...next, version };
  return { ok: true, data: { version, example: formatPractitionerNumber(1, format) } };
}

/** Called by the issuer the first time a number is allocated. Idempotent. */
export async function lockFormat(admin: any, key = "practitioner_number"): Promise<void> {
  await admin.from("practice_identifier_format").update({ locked: true }).eq("key", key).eq("locked", false);
}

export async function formatHistory(admin: any, key = "practitioner_number") {
  const { data } = await admin.from("practice_identifier_format_history")
    .select("*").eq("key", key).order("version", { ascending: false });
  return (data ?? []) as any[];
}
