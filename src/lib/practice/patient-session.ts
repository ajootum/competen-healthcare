import { createHash, randomBytes } from "node:crypto";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 PHASE 4 -- THE PATIENT SESSION. An auth artefact, and only that.
//
// ⚠ THIS IS A LEAF MODULE ON PURPOSE. booking-rules.ts imports it so that a patient booking can be
// PROVED rather than permitted, and booking-rules.ts is imported by patient-booking.ts. If the proof
// lived in either of those, the pair would be a cycle -- and a cycle here is a bundler behaviour to be
// tested rather than relied on. So this file imports nothing from this codebase at all.
//
// ---- ⚠ A PATIENT SESSION IS NOT A PRACTITIONER SESSION -----------------------------------------------
//
// Migration 254 says it at length and shapes the table so it cannot become one by accident: no user_id,
// no membership, no role, no capability column, and no patient_id. Nothing here returns, derives or
// invents any of those. What a verified session proves is exactly one thing -- SOMEBODY PROVED CONTROL
// OF THIS PHONE OR INBOX, FOR THIS PRACTICE, RECENTLY -- and that is the only claim the booking engine
// is allowed to act on.
//
// ⚠ NO WORKSPACE COLUMN, AND THE ABSENCE IS LOAD-BEARING. The practice is read THROUGH the challenge,
// because two copies of "which practice is this for" is one disagreement away from a session minted for
// one practice being accepted by another. Every function below therefore joins to the challenge and
// takes the workspace from there, never from an argument.
//
// ---- WHAT IS PRESENTED AND WHAT IS STORED -----------------------------------------------------------
//
// The token is returned ONCE, from issue, and never again. Only its SHA-256 is stored, exactly as
// migration 224 treats the code itself: read access to this table is far wider than the person holding
// the session. The row's id is deliberately NOT the bearer -- ids travel through logs, error payloads
// and joins in a way a secret must not.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The three states this area uses everywhere. `ok` with an empty value is not `unreadable`. */
export type Reading<T> =
  | { state: "ok"; value: T }
  | { state: "unreadable"; reason: string };

/** Migration 254 caps a session at thirty minutes in the DATABASE. This is the value we ask for. */
export const PATIENT_SESSION_MINUTES = 20;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * ⚠ THE ONE REFUSAL CODE FOR EVERY WAY A SESSION IS NOT GOOD.
 *
 * Revoked, expired, unknown token and wrong destination all answer `PATIENT_SESSION_INVALID`. Telling a
 * caller WHICH of those it was tells somebody probing with a stolen or guessed token how close they are
 * -- the position verifyOtp already takes on codes, and messaging.ts's comment gives the reasoning. The
 * distinction is preserved for the SERVER's benefit in `reason`, which is never returned to a patient.
 */
export type PatientSessionProof = {
  sessionId: string;
  challengeId: string;
  /** The practice the code was issued for. Read through the challenge, never from an argument. */
  workspaceId: string | null;
  /** The phone or inbox that was actually verified. */
  destination: string;
  channel: string;
  expiresAt: string;
};

export type PatientSessionCheck =
  | { ok: true; proof: PatientSessionProof }
  /** ⚠ `reason` is for the server log. Nothing patient-facing may repeat it. */
  | { ok: false; code: "PATIENT_SESSION_INVALID"; reason: string }
  | { ok: false; code: "PATIENT_SESSION_UNREADABLE"; reason: string };

/**
 * Mint a session from a challenge that has just been verified.
 *
 * ⚠ THE CALLER MUST HAVE VERIFIED THE CODE FIRST. This does not re-verify -- verifyOtp consumes the
 * challenge, and a second consumption is impossible by design -- but it DOES refuse a challenge that was
 * never consumed, because a session minted from an unverified challenge is a session that proves
 * nothing. That check is the whole point of the function.
 */
export async function issuePatientSession(admin: any, args: {
  challengeId: string;
}): Promise<{ ok: true; token: string; expiresAt: string; sessionId: string }
  | { ok: false; code: string; message: string }> {
  const { data: c, error } = await admin.from("practice_otp_challenge")
    .select("id, workspace_id, destination, channel, consumed_at").eq("id", args.challengeId).maybeSingle();
  if (error)
    return { ok: false, code: "PATIENT_SESSION_UNREADABLE", message: `the verification could not be read: ${error.message}` };
  if (!c) return { ok: false, code: "PATIENT_SESSION_INVALID", message: "that verification is not valid" };

  // ⚠ AN UNCONSUMED CHALLENGE HAS NOT BEEN VERIFIED. Minting from one would turn "I asked for a code"
  // into "I proved I received it", which is the entire difference this table exists to record.
  if (!c.consumed_at)
    return { ok: false, code: "NOT_VERIFIED", message: "that code has not been entered yet" };

  // 32 random bytes, hex. The token is returned once and never stored.
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + PATIENT_SESSION_MINUTES * 60000).toISOString();

  const { data, error: insErr } = await admin.from("practice_patient_session")
    .insert({ challenge_id: c.id, token_hash: sha256(token), expires_at: expiresAt })
    .select("id").maybeSingle();
  if (insErr) {
    // ux_practice_patient_session_challenge: ONE SESSION PER CHALLENGE. A one-time code that could mint
    // two sessions is not one-time, and the database is what makes that true rather than this code.
    if (insErr.code === "23505")
      return { ok: false, code: "SESSION_ALREADY_ISSUED", message: "that code has already been used to start a session" };
    return { ok: false, code: "REFUSED_BY_DATABASE", message: insErr.message };
  }
  // ⚠ AN INSERT THAT RETURNED NOTHING IS NOT A SUCCESS. This codebase has shipped two silent write
  // failures by treating one as one.
  if (!data) return { ok: false, code: "NOT_WRITTEN", message: "the session was not created and the database reported no error" };

  return { ok: true, token, expiresAt, sessionId: data.id as string };
}

/**
 * ⚠ THE CHECK booking-rules.ts RUNS INSTEAD OF A CAPABILITY TEST, FOR THE patient_self CHANNEL ONLY.
 *
 * It answers: is this bearer a live session, minted from a consumed challenge, for THIS practice, that
 * verified THIS destination? Anything less is refused.
 *
 * ⚠ A FAILED READ IS ITS OWN ANSWER AND IS NEVER A PASS. `PATIENT_SESSION_UNREADABLE` is distinct from
 * `PATIENT_SESSION_INVALID` for the server, and both refuse. Collapsing them would either report an
 * outage as a bad token or -- far worse, and the direction this codebase keeps being bitten in -- let an
 * unreadable session table become an open door.
 */
export async function checkPatientSession(admin: any, args: {
  token: string | null | undefined;
  /** The practice being booked with. The session must have been minted for exactly this one. */
  workspaceId: string;
  /** The phone or inbox the booking claims. Must be the one the code actually went to. */
  destination?: string | null;
}): Promise<PatientSessionCheck> {
  const token = (args.token ?? "").trim();
  if (!token) return { ok: false, code: "PATIENT_SESSION_INVALID", reason: "no session token was presented" };

  const { data: s, error } = await admin.from("practice_patient_session")
    .select("id, challenge_id, expires_at, revoked_at").eq("token_hash", sha256(token)).maybeSingle();
  if (error)
    return { ok: false, code: "PATIENT_SESSION_UNREADABLE", reason: `the session store could not be read: ${error.message}` };
  if (!s) return { ok: false, code: "PATIENT_SESSION_INVALID", reason: "no session matches that token" };
  if (s.revoked_at) return { ok: false, code: "PATIENT_SESSION_INVALID", reason: "that session was revoked" };
  // Derived against the clock at read time, never a stored `expired` flag -- the same decision
  // follow-ups.ts takes about OVERDUE, and for the same reason: a stored one needs something to run.
  if (String(s.expires_at) <= new Date().toISOString())
    return { ok: false, code: "PATIENT_SESSION_INVALID", reason: "that session has expired" };

  const { data: c, error: cErr } = await admin.from("practice_otp_challenge")
    .select("id, workspace_id, destination, channel, consumed_at").eq("id", s.challenge_id).maybeSingle();
  if (cErr)
    return { ok: false, code: "PATIENT_SESSION_UNREADABLE", reason: `the verification behind that session could not be read: ${cErr.message}` };
  if (!c) return { ok: false, code: "PATIENT_SESSION_INVALID", reason: "the verification behind that session is gone" };
  if (!c.consumed_at) return { ok: false, code: "PATIENT_SESSION_INVALID", reason: "the verification behind that session was never completed" };

  // ⚠ THE PRACTICE IS THE CHALLENGE'S, AND IT MUST MATCH. A session minted for one practice being
  // accepted by another is the exact failure the missing workspace_id column was designed to prevent.
  if (c.workspace_id !== args.workspaceId)
    return { ok: false, code: "PATIENT_SESSION_INVALID", reason: "that session was issued for a different practice" };

  // ⚠ AND THE DESTINATION MUST MATCH. Without this, somebody who verified their OWN phone could book
  // giving a different contact -- the verification would be real and would be attached to a stranger.
  const claimed = (args.destination ?? "").trim();
  if (claimed && normaliseDestination(claimed) !== normaliseDestination(String(c.destination)))
    return { ok: false, code: "PATIENT_SESSION_INVALID", reason: "that session verified a different phone or inbox" };

  return {
    ok: true,
    proof: {
      sessionId: s.id as string, challengeId: c.id as string,
      workspaceId: (c.workspace_id as string | null) ?? null,
      destination: String(c.destination), channel: String(c.channel),
      expiresAt: String(s.expires_at),
    },
  };
}

/**
 * Compared the way the contact register compares: case-folded, with spaces and punctuation removed.
 *
 * ⚠ IT IS DELIBERATELY LOOSE ON FORMATTING AND STRICT ON VALUE. "+256 772 555 401" and "+256772555401"
 * are one phone; refusing that pair would refuse a patient for retyping their own number with a space.
 */
export const normaliseDestination = (v: string) => v.toLowerCase().replace(/[\s()-]/g, "");

/** Spend or withdraw a session. One column, because there is nothing else that can happen to one. */
export async function revokePatientSession(admin: any, args: {
  token: string;
}): Promise<{ ok: boolean; code?: string; message?: string }> {
  const { data, error } = await admin.from("practice_patient_session")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", sha256(args.token)).is("revoked_at", null).select("id");
  if (error) return { ok: false, code: "REFUSED_BY_DATABASE", message: error.message };
  // Revoking an already-revoked or unknown session is not an error worth surfacing -- it is the state
  // the caller asked for. It is reported as `changed` so a caller that cares can tell.
  return { ok: true, code: (data ?? []).length > 0 ? "REVOKED" : "ALREADY_GONE" };
}
