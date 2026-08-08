/**
 * Practice security harness -- CPR-370's sessions, devices, consent, break-glass and MFA policy.
 * Migration 213.
 *
 * WHAT IT PROVES:
 *   1. REVOKING A SESSION IS REAL FOR THE PRACTICE. touchSession refuses the device on its very next
 *      call -- which is what resolvePracticeShell runs on every request -- and the result SAYS it does
 *      not end the platform session. A revocation that were cosmetic is the most dangerous thing this
 *      module could ship.
 *   2. AN IDLE DEVICE IS LOCKED OUT AND SAYS WHY, and the control proves an unexpired one is not.
 *   3. BREAK-GLASS IS SELF-GRANTED AND REACHES THE ORDINARY RESOLVER: a member with no patient access
 *      has it immediately afterwards, and only the read capabilities -- never signing.
 *   4. IT CANNOT BE TAKEN QUIETLY: an audit event AND an access-log entry, both asserted.
 *   5. IT EXPIRES ON ITS OWN -- the grants carry the same expiry, so nothing has to run to end it.
 *   6. NOBODY REVIEWS THEIR OWN EMERGENCY ACCESS, and ENDING IS NOT REVIEWING: an ended episode is still
 *      awaiting review.
 *   7. A REASON IS REQUIRED and "emergency" is not one.
 *   8. A WITHDRAWN CONSENT IS KEPT, NEVER DELETED, and expiry is DERIVED -- no column, no job.
 *   9. THE POSTURE CARRIES NO SCORE, NO PERCENTAGE AND NO COMPLIANCE BADGE, and names what it cannot
 *      know from here.
 *  10. Cross-workspace isolation, non-vacuously.
 *  11. ⚠ A FAILED READ IS NEVER A PASS, A ZERO OR A SUCCESS (COMP-SECURITY-SURVEY-001 s0.3). Every
 *      assertion in this block SIMULATES THE FAILURE rather than asserting the happy path: a stub client
 *      makes a named table answer with an error, and the probe that proves the stub really did fail is
 *      asserted first. Without that probe these would be the fifteenth vacuous assertion in this repo.
 *        - an unreadable policy reads as UNREADABLE, never as "MFA off, emergency access on";
 *        - the MFA gate answers UNAVAILABLE, not OPEN, when the assurance-level call errors;
 *        - a revoke whose write fails is reported as a failure, and the device is still refused entry
 *          nowhere -- it is proved still ALLOWED IN, which is what makes the false success dangerous.
 *
 *   npx --yes tsx scripts/practice-security-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import {
  getSecurityPolicy, updateSecurityPolicy, touchSession, listSessions, revokeSession, setDeviceTrusted,
  recordConsent, withdrawConsent, patientConsents, consentSummary,
  breakGlass, endBreakGlass, reviewBreakGlass, breakGlassLog, securityPosture, mfaGate,
  BREAK_GLASS_CAPABILITIES, IDLE_REVOKED_REASON,
} from "../src/lib/practice/security";
import {
  AUTH_EVENT, authTrail, authTrailSummary, recordAuthEvent, signInOccasion,
  AUTH_EVENTS_NOT_RECORDED_HERE,
} from "../src/lib/practice/auth-audit";
import { needsDeviceCookie, isPracticePath, mintDeviceId } from "../src/lib/practice/device-register";
import { PRACTICE_LOGIN, PATIENT_LOGIN } from "../src/lib/marketing/practice-site";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e28d1";
const OTHER = "00000000-0000-4000-8000-0000000e28d2";
const LOCUM = "00000000-0000-4000-8000-0000000e28d3";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-sec-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-sec",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-sec", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const base = { actorId: OWNER, correlationId: "harness-sec" };

/* eslint-disable @typescript-eslint/no-explicit-any */

const capsOf = async (workspaceId: string, userId: string): Promise<string[]> => {
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  return res.ok ? [...res.ctx.capabilities] : [];
};

// ── THE FAULT INJECTOR ─────────────────────────────────────────────────────────────────────────────
//
// ⚠ SIMULATE THE FAILURE; DO NOT ASSERT THE HAPPY PATH. An absence assertion that passes because the
// query errored is the bug class this repo has found fifteen times. Every assertion below therefore runs
// against a client that is MADE to fail on one named table, and each block asserts a PROBE first --
// proof that the read really did fail -- before asserting how the failure was handled.

/** A query builder that resolves to a fixed result no matter what is chained onto it. */
const stubBuilder = (result: { data: unknown; error: unknown }): any => {
  const b: any = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop === "then") return (res: any, rej: any) => Promise.resolve(result).then(res, rej);
      return () => b;
    },
  });
  return b;
};

const FAULT = { message: "simulated read failure", code: "SIMULATED" };

// `Reflect.get` is deliberately called WITHOUT the receiver: forwarding the proxy as `this` breaks any
// getter on the real client that reads a private field.
/** `admin`, except that every operation on `table` answers with an error. */
const adminFailingTable = (table: string): any => new Proxy(admin, {
  get(target: any, prop) {
    if (prop === "from") return (t: string) => (t === table ? stubBuilder({ data: null, error: FAULT }) : target.from(t));
    const v = Reflect.get(target, prop);
    return typeof v === "function" ? v.bind(target) : v;
  },
});

/** `admin`, except that one named VERB on `table` answers with `result` and does nothing. */
const adminFailingVerb = (table: string, verb: string, result: { data: unknown; error: unknown }): any =>
  new Proxy(admin, {
    get(target: any, prop) {
      if (prop === "from") return (t: string) => {
        const real = target.from(t);
        if (t !== table) return real;
        return new Proxy(real, {
          get(bt: any, bp) {
            if (bp === verb) return () => stubBuilder(result);
            const v = Reflect.get(bt, bp);
            return typeof v === "function" ? v.bind(bt) : v;
          },
        });
      };
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });

/** `admin`, except that `update()` on `table` answers with `result` and writes nothing. */
const adminFailingUpdate = (table: string, result: { data: unknown; error: unknown }): any =>
  adminFailingVerb(table, "update", result);

async function main() {
  console.log("\nPractice security harness (CPR-370, migration 213)\n");
  await cleanup();

  const wsA = await provision(OWNER, "HARNESS Security A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Security B (synthetic)", "b");

  // A locum with NO clinical access at all -- the person break-glass exists for.
  const { data: locumMembership } = await admin.from("practice_membership").insert({
    workspace_id: wsA, user_id: LOCUM, role_code: "practice_assistant", status: "active",
  }).select("id").single();
  await admin.from("practice_role_assignment").insert([
    { membership_id: locumMembership!.id, capability_code: "practice.home.view", source: "role_default" },
  ]);
  const before = await capsOf(wsA, LOCUM);
  ok("the locum starts with no patient access at all",
    !before.includes("patient.view") && !before.includes("encounter.list"), before.join(","));

  // ── 1. Revocation is real ────────────────────────────────────────────────
  const first = await touchSession(admin, { workspaceId: wsA, userId: OWNER, deviceId: "device-laptop", userAgent: "probe" });
  ok("a device is registered on first use", first.allowed && !!first.sessionId, JSON.stringify(first));
  const again = await touchSession(admin, { workspaceId: wsA, userId: OWNER, deviceId: "device-laptop" });
  ok("and using it again is still allowed", again.allowed && again.sessionId === first.sessionId);

  const sessions = await listSessions(admin, wsA);
  ok("the device list never returns the device id itself -- it is a credential",
    sessions.sessions.every((s: any) => s.device_id === undefined),
    JSON.stringify(Object.keys(sessions.sessions[0] ?? {})));

  const revoked = await revokeSession(admin, {
    workspaceId: wsA, sessionId: first.sessionId!, reason: "Laptop left in a taxi", ...base,
  });
  ok("a device is revoked", revoked.ok, revoked.ok ? "" : revoked.message);
  ok("AND THE RESULT SAYS IT DOES NOT END THE PLATFORM SESSION",
    revoked.ok && revoked.data.endsPlatformSession === false);

  const afterRevoke = await touchSession(admin, { workspaceId: wsA, userId: OWNER, deviceId: "device-laptop" });
  ok("REVOCATION IS REAL: the very next request from that device is refused",
    !afterRevoke.allowed && afterRevoke.reason === "revoked", JSON.stringify(afterRevoke));
  const otherDevice = await touchSession(admin, { workspaceId: wsA, userId: OWNER, deviceId: "device-phone" });
  ok("CONTROL: a different device is unaffected", otherDevice.allowed);
  const twice = await revokeSession(admin, { workspaceId: wsA, sessionId: first.sessionId!, ...base });
  ok("a device cannot be revoked twice", !twice.ok && twice.code === "ALREADY_REVOKED");

  const trustRevoked = await setDeviceTrusted(admin, {
    workspaceId: wsA, sessionId: first.sessionId!, trusted: true, ...base,
  });
  ok("a revoked device cannot be marked trusted", !trustRevoked.ok && trustRevoked.code === "REVOKED");
  const trustOthers = await setDeviceTrusted(admin, {
    workspaceId: wsA, sessionId: otherDevice.sessionId!, trusted: true, actorId: LOCUM, correlationId: "h",
  });
  ok("NOBODY TRUSTS SOMEBODY ELSE'S DEVICE -- it is a statement about a machine they have not seen",
    !trustOthers.ok && trustOthers.code === "NOT_YOURS");
  const trustMine = await setDeviceTrusted(admin, {
    workspaceId: wsA, sessionId: otherDevice.sessionId!, trusted: true, label: "My phone", ...base,
  });
  ok("CONTROL: a person can trust their own", trustMine.ok, trustMine.ok ? "" : trustMine.message);

  // ── 2. Idle lockout ──────────────────────────────────────────────────────
  await updateSecurityPolicy(admin, { workspaceId: wsA, sessionIdleMinutes: 5, ...base });
  await admin.from("practice_session")
    .update({ last_seen_at: new Date(Date.now() - 60 * 60_000).toISOString() })
    .eq("id", otherDevice.sessionId!);
  const idled = await touchSession(admin, { workspaceId: wsA, userId: OWNER, deviceId: "device-phone" });
  ok("AN IDLE DEVICE IS LOCKED OUT AND SAYS WHY",
    !idled.allowed && idled.reason === "idle", JSON.stringify(idled));

  const fresh = await touchSession(admin, { workspaceId: wsA, userId: OWNER, deviceId: "device-tablet" });
  ok("CONTROL: a device used just now is not idled out", fresh.allowed);
  await updateSecurityPolicy(admin, { workspaceId: wsA, sessionIdleMinutes: null, ...base });

  // ── 7. A reason is required ──────────────────────────────────────────────
  const noReason = await breakGlass(admin, { workspaceId: wsA, userId: LOCUM, reason: "emergency", correlationId: "h" });
  ok("'emergency' IS NOT A REASON -- ten characters minimum, because somebody will read it",
    !noReason.ok && noReason.code === "REASON_REQUIRED", noReason.ok ? "granted" : noReason.code);

  const stranger = await breakGlass(admin, {
    workspaceId: wsA, userId: "00000000-0000-4000-8000-0000000e28d9",
    reason: "Collapsed patient in reception", correlationId: "h",
  });
  ok("a non-member has no emergency claim on this practice at all",
    !stranger.ok && stranger.code === "NOT_A_MEMBER");

  // ── 3, 4. Break-glass reaches the ordinary resolver, loudly ──────────────
  const patient = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Wanjiru Alice", sex: "female", birthDate: "1975-03-14",
    phone: "0772 556 000", ...base,
  });
  if (!patient.ok) { ok("patient registers", false, patient.message); return report(); }

  const glass = await breakGlass(admin, {
    workspaceId: wsA, userId: LOCUM, patientId: patient.data.id,
    reason: "Unconscious in reception, regular clinician off duty", correlationId: "harness-sec",
  });
  ok("emergency access is taken", glass.ok, glass.ok ? "" : glass.message);
  if (!glass.ok) return report();

  const during = await capsOf(wsA, LOCUM);
  ok("BREAK-GLASS REACHES THE ORDINARY RESOLVER -- the locum can now read the record",
    during.includes("patient.view") && during.includes("encounter.list"), during.join(","));
  ok("AND ONLY THE READ CAPABILITIES -- an emergency is a reason to SEE a record, not to sign one",
    !during.includes("document.sign") && !during.includes("encounter.sign") && !during.includes("encounter.edit"),
    during.join(","));
  ok("the granted set is exactly what the constant allows",
    glass.data.capabilities.every(c => (BREAK_GLASS_CAPABILITIES as readonly string[]).includes(c)),
    glass.data.capabilities.join(","));

  const { data: auditRows } = await admin.from("practice_audit_event")
    .select("event_type, payload").eq("workspace_id", wsA).eq("event_type", "practice.break_glass_taken");
  ok("IT CANNOT BE TAKEN QUIETLY (1): an audit event, carrying the reason",
    ((auditRows ?? []) as any[]).length === 1 && /Unconscious/.test(JSON.stringify(auditRows)),
    JSON.stringify(((auditRows ?? []) as any[])[0]?.payload));
  const { data: accessRows } = await admin.from("practice_access_log")
    .select("detail, actor_id").eq("workspace_id", wsA).eq("actor_id", LOCUM);
  ok("IT CANNOT BE TAKEN QUIETLY (2): an access-log entry too",
    ((accessRows ?? []) as any[]).some(r => /Emergency access taken/.test(r.detail ?? "")),
    JSON.stringify(((accessRows ?? []) as any[])[0]));

  const { data: grantRows } = await admin.from("practice_role_assignment")
    .select("source, break_glass_id").eq("break_glass_id", glass.data.id);
  ok("the grants are marked break_glass, never delegation -- the team page cannot confuse them",
    ((grantRows ?? []) as any[]).length > 0 && ((grantRows ?? []) as any[]).every(g => g.source === "break_glass"),
    JSON.stringify(((grantRows ?? []) as any[]).map(g => g.source)));

  const twiceOpen = await breakGlass(admin, {
    workspaceId: wsA, userId: LOCUM, reason: "Another emergency entirely", correlationId: "h",
  });
  ok("a second episode cannot be opened while one is live",
    !twiceOpen.ok && twiceOpen.code === "ALREADY_OPEN");

  // ── 5. It expires on its own ─────────────────────────────────────────────
  await admin.from("practice_role_assignment")
    .update({ effective_to: new Date(Date.now() - 1000).toISOString() }).eq("break_glass_id", glass.data.id);
  const afterExpiry = await capsOf(wsA, LOCUM);
  ok("IT EXPIRES ON ITS OWN -- the resolver stops returning it with nothing having run",
    !afterExpiry.includes("patient.view"), afterExpiry.join(","));

  // ── 6. Ending is not reviewing, and nobody reviews their own ─────────────
  const selfReview = await reviewBreakGlass(admin, {
    workspaceId: wsA, breakGlassId: glass.data.id, note: "It was fine", actorId: LOCUM, correlationId: "h",
  });
  ok("NOBODY REVIEWS THEIR OWN EMERGENCY ACCESS",
    !selfReview.ok && selfReview.code === "SELF_REVIEW", selfReview.ok ? "reviewed" : selfReview.code);

  const ended = await endBreakGlass(admin, { workspaceId: wsA, breakGlassId: glass.data.id, ...base });
  ok("it can be ended early", ended.ok, ended.ok ? "" : ended.message);
  const afterEnd = await breakGlassLog(admin, wsA);
  ok("ENDING IS NOT REVIEWING -- an ended episode is still awaiting review",
    afterEnd.awaitingReview === 1 && afterEnd.live === 0,
    JSON.stringify({ awaiting: afterEnd.awaitingReview, live: afterEnd.live }));

  const emptyReview = await reviewBreakGlass(admin, { workspaceId: wsA, breakGlassId: glass.data.id, note: " ", ...base });
  ok("a review with no words is refused -- that is a tick, not a review", !emptyReview.ok);
  const reviewed = await reviewBreakGlass(admin, {
    workspaceId: wsA, breakGlassId: glass.data.id, note: "Checked the notes; appropriate.", ...base,
  });
  ok("CONTROL: somebody else reviews it, with words", reviewed.ok, reviewed.ok ? "" : reviewed.message);
  ok("and it leaves the awaiting-review list", (await breakGlassLog(admin, wsA)).awaitingReview === 0);

  await updateSecurityPolicy(admin, { workspaceId: wsA, breakGlassEnabled: false, ...base });
  const disabled = await breakGlass(admin, {
    workspaceId: wsA, userId: LOCUM, reason: "Another genuine emergency here", correlationId: "h",
  });
  ok("a practice can turn emergency access off entirely",
    !disabled.ok && disabled.code === "BREAK_GLASS_DISABLED");
  await updateSecurityPolicy(admin, { workspaceId: wsA, breakGlassEnabled: true, ...base });

  // ── 8. Consent ───────────────────────────────────────────────────────────
  const backwards = await recordConsent(admin, {
    workspaceId: wsA, patientId: patient.data.id, consentType: "data_sharing",
    grantedOn: "2026-01-10", expiresOn: "2026-01-01", ...base,
  });
  ok("a consent that expires before it was given is refused",
    !backwards.ok && backwards.code === "EXPIRES_BEFORE_GRANTED");

  const consent = await recordConsent(admin, {
    workspaceId: wsA, patientId: patient.data.id, consentType: "data_sharing",
    scope: "Nakasero Hospital", evidence: "Signed form in the paper file", ...base,
  });
  const expiring = await recordConsent(admin, {
    workspaceId: wsA, patientId: patient.data.id, consentType: "photography",
    expiresOn: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), ...base,
  });
  const expired = await recordConsent(admin, {
    workspaceId: wsA, patientId: patient.data.id, consentType: "research",
    grantedOn: "2024-01-01", expiresOn: "2024-06-01", ...base,
  });
  ok("consents are recorded", consent.ok && expiring.ok && expired.ok);
  if (!consent.ok) return report();

  const list = (await patientConsents(admin, wsA, patient.data.id)).consents;
  ok("EXPIRY IS DERIVED -- an old consent reads as expired with nothing having run",
    list.find((c: any) => c.consent_type === "research")?.state === "expired",
    JSON.stringify(list.map((c: any) => [c.consent_type, c.state])));
  ok("one expiring within 30 days is flagged, and an open-ended one is not",
    list.find((c: any) => c.consent_type === "photography")?.expiringSoon === true &&
    list.find((c: any) => c.consent_type === "data_sharing")?.expiringSoon === false,
    JSON.stringify(list.map((c: any) => [c.consent_type, c.expiringSoon])));

  const noReasonWithdraw = await withdrawConsent(admin, { workspaceId: wsA, consentId: consent.data.id, reason: " ", ...base });
  ok("withdrawing without a reason is refused", !noReasonWithdraw.ok && noReasonWithdraw.code === "REASON_REQUIRED");

  const withdrawn = await withdrawConsent(admin, {
    workspaceId: wsA, consentId: consent.data.id, reason: "Patient asked us to stop sharing", ...base,
  });
  ok("a consent is withdrawn", withdrawn.ok, withdrawn.ok ? "" : withdrawn.message);
  const afterWithdraw = (await patientConsents(admin, wsA, patient.data.id)).consents;
  ok("A WITHDRAWN CONSENT IS KEPT, NEVER DELETED -- it is the row saying we may no longer do this",
    afterWithdraw.length === 3 &&
    afterWithdraw.find((c: any) => c.id === consent.data.id)?.state === "withdrawn" &&
    /asked us to stop/.test(afterWithdraw.find((c: any) => c.id === consent.data.id)?.withdrawal_reason ?? ""),
    JSON.stringify(afterWithdraw.map((c: any) => c.state)));
  ok("withdrawn, expired and active are three distinct states, never collapsed",
    new Set(afterWithdraw.map((c: any) => c.state)).size === 3,
    afterWithdraw.map((c: any) => c.state).join(","));

  const summary = await consentSummary(admin, wsA);
  ok("the summary counts them and contains no percentage",
    summary.active === 1 && summary.withdrawn === 1 && summary.expired === 1 &&
    !/%/.test(JSON.stringify(summary)),
    JSON.stringify(summary));

  // ── 9. The posture ───────────────────────────────────────────────────────
  const posture = await securityPosture(admin, wsA);
  const serialised = JSON.stringify(posture);
  ok("THE POSTURE CARRIES NO SECURITY SCORE AND NO PERCENTAGE",
    !/\d+(\.\d+)?%/.test(serialised) && !/"(securityScore|score|rate|coverage|readiness)"/i.test(serialised));
  ok("AND NO COMPLIANCE BADGE -- HIPAA, GDPR and the rest are certifications, not properties of code",
    !/HIPAA|GDPR|compliant/i.test(serialised), serialised.slice(0, 120));
  ok("it names what it CANNOT know from here, rather than guessing",
    posture.notKnowableFromHere.length >= 4 &&
    posture.notKnowableFromHere.some((s: string) => /Encryption/i.test(s)) &&
    posture.notKnowableFromHere.some((s: string) => /reside/i.test(s)),
    JSON.stringify(posture.notKnowableFromHere));
  ok("and states the two places this product's reach ends, as FIELDS",
    posture.revocationEndsPlatformSession === false && posture.mfaEnrolmentIsPlatformLevel === true);
  ok("its guarantees are properties of the code, each one asserted elsewhere in this harness",
    posture.guarantees.length >= 4 && posture.guarantees.every((g: string) => g.length > 20));

  const policy = await getSecurityPolicy(admin, wsA);
  ok("MFA IS OFF BY DEFAULT -- a migration must never lock a practice out of itself",
    policy.mfa_required === false);
  const badMinutes = await updateSecurityPolicy(admin, { workspaceId: wsA, breakGlassMinutes: 5000, ...base });
  ok("an emergency lasting three days is refused", !badMinutes.ok);

  // ── 11. A FAILED READ IS NEVER A PASS, A ZERO OR A SUCCESS ───────────────
  //
  // COMP-SECURITY-SURVEY-001 s0.3, and the same class as the four in fc2de9a2. Each block SIMULATES the
  // failure and asserts a probe first, so none of it can pass against a query that quietly worked.

  const failPolicy = adminFailingTable("practice_security_policy");
  const probe = await failPolicy.from("practice_security_policy")
    .select("*").eq("workspace_id", wsA).maybeSingle();
  ok("PROBE: the injected fault really does make the policy read fail -- nothing below is vacuous",
    probe.error != null && probe.data == null, JSON.stringify(probe));
  const probeControl = await admin.from("practice_security_policy")
    .select("workspace_id").eq("workspace_id", wsA).maybeSingle();
  ok("CONTROL: the same read on the real client succeeds, so it is the injection failing and not the fixture",
    probeControl.error == null && probeControl.data != null, JSON.stringify(probeControl.error));

  const unread = await getSecurityPolicy(failPolicy, wsA);
  ok("AN UNREADABLE POLICY SAYS SO -- it no longer reads as 'MFA off, emergency access on'",
    unread.readable === false, JSON.stringify(unread));
  ok("CONTROL: a policy that WAS read says that too, so `readable` is not hardcoded false",
    (await getSecurityPolicy(admin, wsA)).readable === true);

  // The MFA gate: three answers, and a failed check is not either of the two that let somebody in.
  const gateOnError = mfaGate({ policyReadable: true, mfaRequired: true, aal: { data: null, error: FAULT } });
  ok("THE MFA GATE ANSWERS 'COULD NOT TELL' WHEN THE ASSURANCE-LEVEL CALL ERRORS -- it used to OPEN",
    gateOnError.decision === "UNAVAILABLE" && (gateOnError as any).check === "mfa_status",
    JSON.stringify(gateOnError));
  const gateOnUnreadablePolicy = mfaGate({ policyReadable: false, mfaRequired: false, aal: null });
  ok("AND AN UNREADABLE POLICY IS 'COULD NOT TELL' TOO -- never 'this practice does not require MFA'",
    gateOnUnreadablePolicy.decision === "UNAVAILABLE" && (gateOnUnreadablePolicy as any).check === "mfa_policy",
    JSON.stringify(gateOnUnreadablePolicy));
  ok("THE SHELL'S OWN PATH: the unreadable policy read above, fed to the gate, refuses to open",
    mfaGate({ policyReadable: unread.readable, mfaRequired: unread.mfa_required === true, aal: null })
      .decision === "UNAVAILABLE");

  const gateNotEnrolled = mfaGate({ policyReadable: true, mfaRequired: true, aal: { data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null } });
  const gateEnrolled = mfaGate({ policyReadable: true, mfaRequired: true, aal: { data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null } });
  ok("A REFUSAL IS A DIFFERENT ANSWER FROM A FAILED CHECK, and it carries whether they are enrolled",
    gateNotEnrolled.decision === "REFUSE" && (gateNotEnrolled as any).enrolled === false &&
    gateEnrolled.decision === "REFUSE" && (gateEnrolled as any).enrolled === true,
    JSON.stringify([gateNotEnrolled, gateEnrolled]));
  ok("a caller with no session at all is REFUSED, not 'could not tell' -- that is a real answer",
    mfaGate({ policyReadable: true, mfaRequired: true, aal: { data: { currentLevel: null, nextLevel: null }, error: null } }).decision === "REFUSE");
  ok("CONTROL: the gate is not refusing everything -- a second factor held, and a practice not asking for one, both open",
    mfaGate({ policyReadable: true, mfaRequired: true, aal: { data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null } }).decision === "OPEN" &&
    mfaGate({ policyReadable: true, mfaRequired: false, aal: null }).decision === "OPEN");

  // Emergency access, on an unreadable policy: the placeholder says break-glass is ON, so this is the
  // branch where a database blip would have granted it inside a practice that switched it off.
  const glassBefore = (await breakGlassLog(admin, wsA)).episodes.length;
  const glassOnUnreadable = await breakGlass(failPolicy, {
    workspaceId: wsA, userId: LOCUM, reason: "Testing an unreadable policy", correlationId: "h",
  });
  ok("EMERGENCY ACCESS IS REFUSED ON AN UNREADABLE POLICY -- a failed read is not a permission",
    !glassOnUnreadable.ok && glassOnUnreadable.code === "POLICY_UNREADABLE",
    glassOnUnreadable.ok ? "GRANTED" : glassOnUnreadable.code);
  ok("and it wrote nothing while refusing -- no episode, no grant",
    (await breakGlassLog(admin, wsA)).episodes.length === glassBefore);

  const policyOnUnreadable = await updateSecurityPolicy(failPolicy, { workspaceId: wsA, mfaRequired: true, ...base });
  ok("A POLICY CANNOT BE CHANGED AGAINST A POLICY NOBODY COULD READ -- the diff would be against fiction",
    !policyOnUnreadable.ok && policyOnUnreadable.code === "POLICY_UNREADABLE",
    policyOnUnreadable.ok ? "CHANGED" : policyOnUnreadable.code);
  ok("and the stored policy is untouched by the refusal",
    (await getSecurityPolicy(admin, wsA)).mfa_required === false);

  // The revoke write. THE ASSERTION THAT MATTERS IS THE LAST ONE: the device is still allowed in, which
  // is exactly what a false success would have hidden.
  const clinic = await touchSession(admin, { workspaceId: wsA, userId: OWNER, deviceId: "device-clinic" });
  ok("a device to revoke is registered and allowed", clinic.allowed && !!clinic.sessionId);
  const { count: revokeAuditBefore } = await admin.from("practice_audit_event")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("event_type", "practice.session_revoked");

  const revokeErrored = await revokeSession(adminFailingUpdate("practice_session", { data: null, error: FAULT }), {
    workspaceId: wsA, sessionId: clinic.sessionId!, reason: "Write will fail", ...base,
  });
  ok("A REVOKE WHOSE WRITE ERRORS IS REPORTED AS A FAILURE, never as a completed lockout",
    !revokeErrored.ok && revokeErrored.code === "REVOKE_FAILED",
    revokeErrored.ok ? "REPORTED AS SUCCESS" : revokeErrored.code);

  const revokeLanded = await revokeSession(adminFailingUpdate("practice_session", { data: [], error: null }), {
    workspaceId: wsA, sessionId: clinic.sessionId!, reason: "Write will land nothing", ...base,
  });
  ok("AND SO IS ONE THAT ERRORS NOWHERE BUT CHANGES NOUGHT ROWS -- the shape RLS produces",
    !revokeLanded.ok && revokeLanded.code === "REVOKE_FAILED",
    revokeLanded.ok ? "REPORTED AS SUCCESS" : revokeLanded.code);

  const { count: revokeAuditAfter } = await admin.from("practice_audit_event")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("event_type", "practice.session_revoked");
  ok("neither failed attempt was audited as a revocation that happened",
    (revokeAuditAfter ?? -1) === (revokeAuditBefore ?? -2),
    JSON.stringify({ before: revokeAuditBefore, after: revokeAuditAfter }));

  const stillIn = await touchSession(admin, { workspaceId: wsA, userId: OWNER, deviceId: "device-clinic" });
  ok("⚠ AND THE DEVICE IS STILL ALLOWED IN. That is what a reported success would have hidden from the "
    + "person who pressed the button after losing a laptop",
    stillIn.allowed, JSON.stringify(stillIn));

  const revokeReal = await revokeSession(admin, { workspaceId: wsA, sessionId: clinic.sessionId!, reason: "For real", ...base });
  ok("CONTROL: the same device, the same call, a working client -- it revokes", revokeReal.ok,
    revokeReal.ok ? "" : revokeReal.message);
  ok("CONTROL: and is then refused, so the failed attempts were failing for the right reason",
    !(await touchSession(admin, { workspaceId: wsA, userId: OWNER, deviceId: "device-clinic" })).allowed);

  // The posture: the sentence a practitioner reads must be the behaviour asserted above.
  const postureAfter = await securityPosture(admin, wsA);
  ok("THE POSTURE PROMISES WHAT THE CODE NOW DOES: a failed lock-out is reported as a failure",
    postureAfter.guarantees.some((g: string) => /lock-out whose write did not land is reported as a failure/i.test(g)),
    JSON.stringify(postureAfter.guarantees));
  ok("and that a check which could not be completed refuses entry rather than counting as a pass",
    postureAfter.guarantees.some((g: string) => /never counted as a passed one/i.test(g)));
  ok("it says whether the policy beside it was actually read",
    postureAfter.policyReadable === true &&
    (await securityPosture(failPolicy, wsA)).policyReadable === false);
  ok("AND IT DOES NOT PRETEND THIS PRODUCT CAN ENROL A SECOND FACTOR -- there is no such screen",
    postureAfter.mfaEnrolmentIsPlatformLevel === true && postureAfter.mfaEnrolmentBuiltHere === false);

  // ── 12. THE DEVICE REGISTER: the cookie that was never planted ───────────
  //
  // COMP-SECURITY-SURVEY-001 s0.2. `shell.ts` called `cookies().set` in a Server Component -- where it
  // ALWAYS throws -- and fell back to a fresh `crypto.randomUUID()`, so every request was a new device:
  // 13,114 rows for 8 memberships, a lock-out nothing would ever present again, and an idle rule that
  // could never measure an interval. The decision now lives in a pure function the proxy calls.

  ok("A SIGNED-IN PRACTICE REQUEST WITH NO DEVICE COOKIE GETS ONE",
    needsDeviceCookie({ signedIn: true, pathname: "/practice/home", existing: undefined }) === true);
  ok("⚠ AND ONE THAT ALREADY HAS ONE DOES NOT -- an identifier that is re-minted is not an identifier",
    needsDeviceCookie({ signedIn: true, pathname: "/practice/home", existing: "already-here" }) === false);
  ok("an anonymous visitor to the public pages is given nothing -- this register refuses fingerprinting",
    needsDeviceCookie({ signedIn: false, pathname: "/practice/home", existing: undefined }) === false);
  ok("and a signed-in request outside Practice is given nothing either",
    needsDeviceCookie({ signedIn: true, pathname: "/unit-manager/dashboard", existing: undefined }) === false
    && isPracticePath("/unit-manager/dashboard") === false
    && isPracticePath("/api/v1/practice/security") === true);

  // The behaviour the cookie buys, proved against the table rather than against the cookie: a browser
  // that presents the same identifier is ONE row however many times it asks.
  const stableDevice = mintDeviceId();
  const t1 = await touchSession(admin, { workspaceId: wsA, userId: OWNER, deviceId: stableDevice, userAgent: "browser-1" });
  const t2 = await touchSession(admin, { workspaceId: wsA, userId: OWNER, deviceId: stableDevice, userAgent: "browser-1" });
  const t3 = await touchSession(admin, { workspaceId: wsA, userId: OWNER, deviceId: stableDevice, userAgent: "browser-1" });
  const { count: stableRows } = await admin.from("practice_session").select("*", { count: "exact", head: true })
    .eq("workspace_id", wsA).eq("user_id", OWNER).eq("device_id", stableDevice);
  ok("⚠ THREE REQUESTS FROM ONE BROWSER ARE ONE DEVICE, NOT THREE. This is the whole bug",
    stableRows === 1 && t1.sessionId === t2.sessionId && t2.sessionId === t3.sessionId,
    JSON.stringify({ stableRows, ids: [t1.sessionId, t2.sessionId, t3.sessionId] }));
  ok("the first of the three was the registration and the other two were not",
    t1.created === true && t2.created === undefined && t3.created === undefined,
    JSON.stringify([t1.created, t2.created, t3.created]));
  const otherBrowser = await touchSession(admin, { workspaceId: wsA, userId: OWNER, deviceId: mintDeviceId() });
  ok("CONTROL: a genuinely different browser IS a different device -- the test is not asserting a constant",
    otherBrowser.sessionId !== t1.sessionId && otherBrowser.created === true);

  const deviceEvents = await authTrail(admin, { workspaceId: wsA, types: [AUTH_EVENT.DEVICE_REGISTERED] });
  ok("and registering a device is written down, once per device",
    deviceEvents.readable
    && deviceEvents.events.filter(e => e.payload.sessionId === t1.sessionId).length === 1,
    JSON.stringify({ readable: deviceEvents.readable, n: deviceEvents.events.length }));

  // ── 13. THE IDLE RULE, AND THE WAY BACK OUT OF IT ────────────────────────
  //
  // ⚠ THIS IS THE BEHAVIOUR CHANGE THE COOKIE FIX CAUSES. `session_idle_minutes` was dead code: with a
  // new device on every request, `existing` was never found and no interval could be measured. It is real
  // now -- and a real idle rule over a STABLE device id would otherwise ban a browser permanently, since
  // nothing in this product un-revokes a row. Signing in again is the way back, and only from the clock's
  // lock-out, never from a person's.

  await updateSecurityPolicy(admin, { workspaceId: wsA, sessionIdleMinutes: 5, ...base });
  const lockedOutAt = new Date(Date.now() - 60 * 60_000).toISOString();
  await admin.from("practice_session").update({ last_seen_at: lockedOutAt }).eq("id", t1.sessionId!);

  const wentIdle = await touchSession(admin, {
    workspaceId: wsA, userId: OWNER, deviceId: stableDevice, authSignInAt: lockedOutAt,
  });
  ok("an idle device is locked out, and the register says it was checked",
    !wentIdle.allowed && wentIdle.reason === "idle" && wentIdle.checked === true, JSON.stringify(wentIdle));

  const { data: idleRow } = await admin.from("practice_session")
    .select("revoked_at, revoked_by, revoked_reason").eq("id", t1.sessionId!).maybeSingle();
  ok("⚠ AND THE CLOCK'S LOCK-OUT LEAVES `revoked_by` NULL -- that null is what makes it reversible",
    idleRow?.revoked_at != null && idleRow?.revoked_by === null && idleRow?.revoked_reason === IDLE_REVOKED_REASON,
    JSON.stringify(idleRow));

  const idleEvents = await authTrail(admin, { workspaceId: wsA, types: [AUTH_EVENT.IDLE_TIMEOUT] });
  ok("the idle lock-out is written into the authentication trail, with how long it had been",
    idleEvents.readable && idleEvents.events.some(e => e.payload.sessionId === t1.sessionId
      && typeof e.payload.idleMinutes === "number" && (e.payload.idleMinutes as number) >= 5),
    JSON.stringify(idleEvents.events.map(e => e.payload)));

  const staleSignIn = await touchSession(admin, {
    workspaceId: wsA, userId: OWNER, deviceId: stableDevice, authSignInAt: lockedOutAt,
  });
  ok("⚠ A SIGN-IN FROM BEFORE THE LOCK-OUT DOES NOT LIFT IT. Without this the resume would be automatic "
    + "and the idle rule would mean nothing",
    !staleSignIn.allowed && staleSignIn.reason === "idle", JSON.stringify(staleSignIn));
  const noSignInMarker = await touchSession(admin, { workspaceId: wsA, userId: OWNER, deviceId: stableDevice });
  ok("and neither does no sign-in marker at all", !noSignInMarker.allowed && noSignInMarker.reason === "idle");

  const freshSignIn = new Date(Date.now() + 1000).toISOString();
  const resumed = await touchSession(admin, {
    workspaceId: wsA, userId: OWNER, deviceId: stableDevice, authSignInAt: freshSignIn,
  });
  ok("SIGNING IN AGAIN CLEARS AN IDLE LOCK-OUT -- otherwise the timer is a permanent ban on that browser",
    resumed.allowed && resumed.resumed === true && resumed.sessionId === t1.sessionId,
    JSON.stringify(resumed));
  const { data: resumedRow } = await admin.from("practice_session")
    .select("revoked_at, revoked_reason").eq("id", t1.sessionId!).maybeSingle();
  ok("and the row is genuinely live again rather than merely reported so",
    resumedRow?.revoked_at === null && resumedRow?.revoked_reason === null, JSON.stringify(resumedRow));
  const resumeEvents = await authTrail(admin, { workspaceId: wsA, types: [AUTH_EVENT.IDLE_SESSION_RESUMED] });
  ok("the resume is written down too -- nothing about a lock-out happens quietly",
    resumeEvents.readable && resumeEvents.events.some(e => e.payload.sessionId === t1.sessionId));

  // ⚠ THE CONTROL THAT MATTERS MOST IN THIS BLOCK.
  const byHand = await revokeSession(admin, {
    workspaceId: wsA, sessionId: t1.sessionId!, reason: "Laptop stolen from the car", ...base,
  });
  const afterHand = await touchSession(admin, {
    workspaceId: wsA, userId: OWNER, deviceId: stableDevice,
    authSignInAt: new Date(Date.now() + 60_000).toISOString(),
  });
  ok("⚠ A DEVICE A PERSON LOCKED OUT IS NOT LET BACK IN BY SIGNING IN AGAIN. If the resume above did not "
    + "discriminate, losing a laptop would be undone by whoever found it",
    byHand.ok && !afterHand.allowed && afterHand.reason === "revoked", JSON.stringify(afterHand));
  await updateSecurityPolicy(admin, { workspaceId: wsA, sessionIdleMinutes: null, ...base });

  // ── 14. THE AUTHENTICATION TRAIL ─────────────────────────────────────────
  //
  // Nothing in this product recorded a sign-in until this release: 2,480 audit events across 38 types and
  // not one authentication event, beneath a public page promising "Every sign-in recorded".

  const run = `harness-${Date.now()}`;
  const firstSignIn = await recordAuthEvent(admin, {
    workspaceId: wsA, actorId: OWNER, eventType: AUTH_EVENT.SIGN_IN, dedupeKey: `${run}:one`,
    payload: { authSignInAt: "2026-08-07T09:00:00.000Z", shellState: "READY" }, correlationId: "harness-sec",
  });
  ok("A SIGN-IN IS RECORDED",
    firstSignIn.recorded === true && (firstSignIn as any).dedupeCheck === "clear", JSON.stringify(firstSignIn));
  const repeat = await recordAuthEvent(admin, {
    workspaceId: wsA, actorId: OWNER, eventType: AUTH_EVENT.SIGN_IN, dedupeKey: `${run}:one`,
    payload: { authSignInAt: "2026-08-07T09:00:00.000Z" },
  });
  ok("and reloading the page does not record it a second time -- one row per sign-in, not per request",
    repeat.recorded === false && (repeat as any).reason === "already_recorded", JSON.stringify(repeat));
  const second = await recordAuthEvent(admin, {
    workspaceId: wsA, actorId: OWNER, eventType: AUTH_EVENT.SIGN_IN, dedupeKey: `${run}:two`,
    payload: { authSignInAt: "2026-08-07T11:00:00.000Z" },
  });
  ok("CONTROL: a genuinely different sign-in IS recorded -- the deduplication is not swallowing everything",
    second.recorded === true, JSON.stringify(second));

  ok("the occasion is GoTrue's own sign-in timestamp, and a missing one falls back to the day rather "
    + "than to a row per request",
    signInOccasion("2026-08-07T09:00:00.000Z").key === "2026-08-07T09:00:00.000Z"
    && signInOccasion(null, new Date("2026-08-07T09:00:00Z")).key === "no-sign-in-timestamp:2026-08-07"
    && signInOccasion(null).marker === "unavailable");

  const trail = await authTrail(admin, { workspaceId: wsA, userId: OWNER, types: [AUTH_EVENT.SIGN_IN] });
  ok("EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN: the sign-ins are readable and countable",
    trail.readable && trail.events.length === 2, JSON.stringify({ readable: trail.readable, n: trail.events.length }));

  // The deduplication read failing must not lose the row. Select is broken; insert still works.
  const failAuditSelect = adminFailingVerb("practice_audit_event", "select", { data: null, error: FAULT });
  const auditSelectProbe = await failAuditSelect.from("practice_audit_event").select("id").limit(1);
  ok("PROBE: the injected fault really does break the trail's deduplication read",
    auditSelectProbe.error != null, JSON.stringify(auditSelectProbe));
  const blindWrite = await recordAuthEvent(failAuditSelect, {
    workspaceId: wsA, actorId: OWNER, eventType: AUTH_EVENT.SIGN_IN, dedupeKey: `${run}:one`,
    payload: { authSignInAt: "2026-08-07T09:00:00.000Z" },
  });
  ok("⚠ A FAILED DEDUPLICATION READ RECORDS ANYWAY -- an audit trail's value is that nothing is missing",
    blindWrite.recorded === true && (blindWrite as any).dedupeCheck === "failed", JSON.stringify(blindWrite));
  const afterBlind = await authTrail(admin, { workspaceId: wsA, userId: OWNER, types: [AUTH_EVENT.SIGN_IN] });
  ok("AND THE DUPLICATE SAYS WHY IT IS A DUPLICATE, rather than being an unexplained second row",
    afterBlind.events.filter(e => e.payload.dedupeKey === `${run}:one`).length === 2
    && afterBlind.events.some(e => e.payload.dedupeKey === `${run}:one` && e.payload.dedupeCheckFailed === true),
    JSON.stringify(afterBlind.events.map(e => [e.payload.dedupeKey, e.payload.dedupeCheckFailed])));

  const failAuditInsert = adminFailingVerb("practice_audit_event", "insert", { data: null, error: FAULT });
  const auditInsertProbe = await failAuditInsert.from("practice_audit_event").insert({ event_type: "probe" });
  ok("PROBE: the injected fault really does break the trail's write",
    auditInsertProbe.error != null, JSON.stringify(auditInsertProbe));
  const lostWrite = await recordAuthEvent(failAuditInsert, {
    workspaceId: wsA, actorId: OWNER, eventType: AUTH_EVENT.SIGN_IN, dedupeKey: `${run}:three`,
  });
  ok("A TRAIL WRITE THAT FAILS SAYS SO, and says why -- it never reports a recorded event",
    lostWrite.recorded === false && (lostWrite as any).reason === "write_failed"
    && /simulated/.test((lostWrite as any).message ?? ""), JSON.stringify(lostWrite));

  const failAudit = adminFailingTable("practice_audit_event");
  const auditProbe = await failAudit.from("practice_audit_event").select("id").limit(1);
  ok("PROBE: the injected fault really does make the whole trail unreadable",
    auditProbe.error != null, JSON.stringify(auditProbe));
  const unreadableTrail = await authTrail(failAudit, { workspaceId: wsA });
  ok("⚠ AN UNREADABLE TRAIL IS NOT AN EMPTY ONE -- on the page whose subject is that sign-ins are recorded",
    unreadableTrail.readable === false && unreadableTrail.events.length === 0, JSON.stringify(unreadableTrail));
  const unreadableSummary = await authTrailSummary(failAudit, wsA);
  ok("AND ITS FIGURES ARE NULL, NEVER NOUGHT. '0 sign-ins recorded' is a claim about a practice",
    unreadableSummary.readable === false && unreadableSummary.signInsLast7Days === null
    && unreadableSummary.refusalsLast7Days === null, JSON.stringify(unreadableSummary));
  const readableSummary = await authTrailSummary(admin, wsA);
  ok("CONTROL: the same summary on a working client counts the rows that are actually there",
    readableSummary.readable === true && (readableSummary.signInsLast7Days ?? 0) >= 2,
    JSON.stringify({ n: readableSummary.signInsLast7Days }));
  ok("and it names what the trail CANNOT see, failed sign-in attempts first among them",
    readableSummary.notRecordedHere.length >= 3
    && readableSummary.notRecordedHere.some(n => /failed sign-in attempt/i.test(n.what))
    && AUTH_EVENTS_NOT_RECORDED_HERE.some(n => /password change/i.test(n.what)),
    JSON.stringify(readableSummary.notRecordedHere.map(n => n.what)));

  // ── 15. THE READS THAT USED TO RENDER AS NOUGHT ──────────────────────────

  const failSessions = adminFailingTable("practice_session");
  const sessionProbe = await failSessions.from("practice_session").select("id").limit(1);
  ok("PROBE: the injected fault really does break the device read",
    sessionProbe.error != null, JSON.stringify(sessionProbe));
  const unreadableSessions = await listSessions(failSessions, wsA);
  ok("⚠ AN UNREADABLE DEVICE LIST IS NOT AN EMPTY PRACTICE. Somebody hunting a lost laptop was shown none",
    unreadableSessions.readable === false && unreadableSessions.sessions.length === 0,
    JSON.stringify(unreadableSessions));
  const readableSessions = await listSessions(admin, wsA);
  ok("CONTROL: the same call on a working client is readable AND has rows, so the test is not vacuous",
    readableSessions.readable === true && readableSessions.sessions.length > 0,
    JSON.stringify({ n: readableSessions.sessions.length }));

  const uncheckedTouch = await touchSession(failSessions, {
    workspaceId: wsA, userId: OWNER, deviceId: stableDevice, authSignInAt: new Date().toISOString(),
  });
  ok("⚠ AND A DEVICE CHECK THAT COULD NOT RUN SAYS SO. It still lets the clinician through -- bookkeeping "
    + "must not block a clinical record -- but `checked: false` is the difference from a silent pass",
    uncheckedTouch.allowed === true && uncheckedTouch.checked === false, JSON.stringify(uncheckedTouch));
  ok("CONTROL: a working client reports the check as having run",
    (await touchSession(admin, { workspaceId: wsA, userId: OWNER, deviceId: mintDeviceId() })).checked === true);

  const failGlass = adminFailingTable("practice_break_glass");
  const glassProbe = await failGlass.from("practice_break_glass").select("id").limit(1);
  ok("PROBE: the injected fault really does break the emergency-access read", glassProbe.error != null);
  const unreadableGlass = await breakGlassLog(failGlass, wsA);
  ok("⚠ 'NONE. THAT IS THE USUAL STATE.' IS REASSURANCE, and a failed read used to produce it",
    unreadableGlass.readable === false && unreadableGlass.awaitingReview === null
    && unreadableGlass.live === null, JSON.stringify(unreadableGlass));
  const readableGlass = await breakGlassLog(admin, wsA);
  ok("CONTROL: the same call on a working client returns a real count, not null",
    readableGlass.readable === true && typeof readableGlass.awaitingReview === "number"
    && readableGlass.episodes.length > 0, JSON.stringify({ n: readableGlass.episodes.length }));

  const failConsent = adminFailingTable("practice_consent");
  const consentProbe = await failConsent.from("practice_consent").select("id").limit(1);
  ok("PROBE: the injected fault really does break the consent read", consentProbe.error != null);
  const unreadableConsents = await consentSummary(failConsent, wsA);
  ok("⚠ '0 ACTIVE CONSENTS' IS A STATEMENT ABOUT A PRACTICE, and a failed read used to make it",
    unreadableConsents.readable === false && unreadableConsents.active === null
    && unreadableConsents.withdrawn === null, JSON.stringify(unreadableConsents));
  const unreadablePatientConsents = await patientConsents(failConsent, wsA, patient.data.id);
  ok("and a patient with unreadable consents is not a patient who has consented to nothing",
    unreadablePatientConsents.readable === false && unreadablePatientConsents.consents.length === 0);
  ok("CONTROL: both are readable and non-empty on a working client",
    (await consentSummary(admin, wsA)).active === 1
    && (await patientConsents(admin, wsA, patient.data.id)).consents.length === 3);

  // ⚠ THE ONE THE SURVEY CALLED OUT BY NAME.
  const failAccessLog = adminFailingTable("practice_access_log");
  const accessProbe = await failAccessLog.from("practice_access_log")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA);
  ok("PROBE: the injected fault really does break the access-log count",
    accessProbe.error != null, JSON.stringify(accessProbe));
  const postureNoLog = await securityPosture(failAccessLog, wsA);
  ok("⚠ A FAILED COUNT IS NOT '0 RECORD READS LOGGED IN THE LAST 7 DAYS'. That sentence sat under the "
    + "guarantee that every read of a patient record is logged, and said none had been",
    postureNoLog.accessEventsLast7Days === null && postureNoLog.accessLogReadable === false,
    JSON.stringify({ n: postureNoLog.accessEventsLast7Days, readable: postureNoLog.accessLogReadable }));
  const postureWithLog = await securityPosture(admin, wsA);
  ok("CONTROL: the working client counts real access-log rows, so null above means the failure and not "
    + "an empty log",
    postureWithLog.accessLogReadable === true && (postureWithLog.accessEventsLast7Days ?? 0) > 0,
    JSON.stringify({ n: postureWithLog.accessEventsLast7Days }));
  ok("and the same posture reports its device, emergency-access and consent figures as read",
    postureWithLog.sessionsReadable === true && postureWithLog.breakGlassReadable === true
    && postureWithLog.consents.readable === true && typeof postureWithLog.liveSessions === "number");

  // ── 16. THE WRITES THAT USED TO REPORT SUCCESS ───────────────────────────
  //
  // ⚠ IN EVERY BLOCK BELOW THE ASSERTION THAT MATTERS IS THE SECOND ONE: that the thing the caller was
  // told had happened DID NOT HAPPEN. A refusal code alone would pass against an engine that refused and
  // wrote anyway, and against one that wrote nothing but had never been asked to.

  const toWithdraw = await recordConsent(admin, {
    workspaceId: wsA, patientId: patient.data.id, consentType: "contact",
    scope: "Reminders by SMS", ...base,
  });
  if (!toWithdraw.ok) { ok("a consent to withdraw is recorded", false, toWithdraw.message); return report(); }

  const withdrawErrored = await withdrawConsent(adminFailingUpdate("practice_consent", { data: null, error: FAULT }), {
    workspaceId: wsA, consentId: toWithdraw.data.id, reason: "Patient asked us to stop texting", ...base,
  });
  ok("A WITHDRAWAL WHOSE WRITE ERRORS IS REPORTED AS A FAILURE, never as a completed withdrawal",
    !withdrawErrored.ok && withdrawErrored.code === "WITHDRAW_FAILED",
    withdrawErrored.ok ? "REPORTED AS SUCCESS" : withdrawErrored.code);
  const withdrawLanded = await withdrawConsent(adminFailingUpdate("practice_consent", { data: [], error: null }), {
    workspaceId: wsA, consentId: toWithdraw.data.id, reason: "Patient asked us to stop texting", ...base,
  });
  ok("AND SO IS ONE THAT ERRORS NOWHERE BUT CHANGES NOUGHT ROWS -- the shape RLS produces",
    !withdrawLanded.ok && withdrawLanded.code === "WITHDRAW_FAILED",
    withdrawLanded.ok ? "REPORTED AS SUCCESS" : withdrawLanded.code);
  const stillConsented = (await patientConsents(admin, wsA, patient.data.id)).consents
    .find((c: any) => c.id === toWithdraw.data.id);
  ok("⚠ AND THE CONSENT IS STILL LIVE. A patient asked this practice to stop; a reported success would "
    + "have closed the matter while the permission carried on standing",
    stillConsented?.state === "active" && stillConsented?.withdrawn_at === null,
    JSON.stringify({ state: stillConsented?.state }));
  const { count: withdrawAudits } = await admin.from("practice_audit_event")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA)
    .eq("event_type", "practice.consent_withdrawn");
  const withdrawReal = await withdrawConsent(admin, {
    workspaceId: wsA, consentId: toWithdraw.data.id, reason: "Patient asked us to stop texting", ...base,
  });
  const { count: withdrawAuditsAfter } = await admin.from("practice_audit_event")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA)
    .eq("event_type", "practice.consent_withdrawn");
  ok("CONTROL: the same call on a working client withdraws it, and only that one was audited",
    withdrawReal.ok && (withdrawAuditsAfter ?? 0) === (withdrawAudits ?? 0) + 1,
    JSON.stringify({ before: withdrawAudits, after: withdrawAuditsAfter }));

  // Emergency access: ending it is two writes, and the dangerous order is the wrong one.
  const glass2 = await breakGlass(admin, {
    workspaceId: wsA, userId: LOCUM, reason: "Second collapse in reception this week", correlationId: "harness-sec",
  });
  if (!glass2.ok) { ok("a second emergency access is taken", false, glass2.message); return report(); }

  const endGrantsFailed = await endBreakGlass(adminFailingUpdate("practice_role_assignment", { data: null, error: FAULT }), {
    workspaceId: wsA, breakGlassId: glass2.data.id, ...base,
  });
  ok("ENDING EMERGENCY ACCESS WHOSE GRANT WITHDRAWAL FAILS IS REPORTED AS A FAILURE",
    !endGrantsFailed.ok && endGrantsFailed.code === "END_FAILED",
    endGrantsFailed.ok ? "REPORTED AS SUCCESS" : endGrantsFailed.code);
  const stillOpen = (await breakGlassLog(admin, wsA)).episodes.find((e: any) => e.id === glass2.data.id);
  const stillGranted = await capsOf(wsA, LOCUM);
  ok("⚠ AND THE EPISODE IS STILL OPEN WITH ITS ACCESS STILL LIVE. Closed-but-still-granted is the one "
    + "state this control exists to make impossible, and it is what a reported success would have created",
    stillOpen?.ended_at === null && stillGranted.includes("patient.view"),
    JSON.stringify({ ended: stillOpen?.ended_at, caps: stillGranted.length }));

  const endCloseFailed = await endBreakGlass(adminFailingUpdate("practice_break_glass", { data: null, error: FAULT }), {
    workspaceId: wsA, breakGlassId: glass2.data.id, ...base,
  });
  ok("and one whose episode could not be marked ended is reported as a failure too",
    !endCloseFailed.ok && endCloseFailed.code === "END_FAILED",
    endCloseFailed.ok ? "REPORTED AS SUCCESS" : endCloseFailed.code);
  const afterCloseFailed = (await breakGlassLog(admin, wsA)).episodes.find((e: any) => e.id === glass2.data.id);
  const afterCloseCaps = await capsOf(wsA, LOCUM);
  ok("⚠ AND IT LEFT THE SAFE HALF DONE: the grants went first, so the episode reads as open with no "
    + "access behind it rather than as closed with access still running",
    afterCloseFailed?.ended_at === null && !afterCloseCaps.includes("patient.view"),
    JSON.stringify({ ended: afterCloseFailed?.ended_at, caps: afterCloseCaps.join(",") }));

  const endReal = await endBreakGlass(admin, { workspaceId: wsA, breakGlassId: glass2.data.id, ...base });
  ok("CONTROL: the same call on a working client ends it", endReal.ok, endReal.ok ? "" : endReal.message);

  const reviewErrored = await reviewBreakGlass(adminFailingUpdate("practice_break_glass", { data: null, error: FAULT }), {
    workspaceId: wsA, breakGlassId: glass2.data.id, note: "Read the notes; appropriate.", ...base,
  });
  ok("A REVIEW WHOSE WRITE ERRORS IS REPORTED AS A FAILURE, never as a completed review",
    !reviewErrored.ok && reviewErrored.code === "REVIEW_FAILED",
    reviewErrored.ok ? "REPORTED AS SUCCESS" : reviewErrored.code);
  const reviewLanded = await reviewBreakGlass(adminFailingUpdate("practice_break_glass", { data: [], error: null }), {
    workspaceId: wsA, breakGlassId: glass2.data.id, note: "Read the notes; appropriate.", ...base,
  });
  ok("AND SO IS ONE THAT CHANGES NOUGHT ROWS", !reviewLanded.ok && reviewLanded.code === "REVIEW_FAILED");
  const stillAwaiting = await breakGlassLog(admin, wsA);
  ok("⚠ AND THE EPISODE IS STILL AWAITING REVIEW. The list IS the control, and a reviewer who was told "
    + "they had finished stops looking while nobody else knows they should start",
    stillAwaiting.episodes.find((e: any) => e.id === glass2.data.id)?.awaitingReview === true
    && (stillAwaiting.awaitingReview ?? 0) >= 1,
    JSON.stringify({ awaiting: stillAwaiting.awaitingReview }));
  const reviewReal = await reviewBreakGlass(admin, {
    workspaceId: wsA, breakGlassId: glass2.data.id, note: "Read the notes; appropriate.", ...base,
  });
  ok("CONTROL: the same call on a working client records it",
    reviewReal.ok && (await breakGlassLog(admin, wsA)).episodes
      .find((e: any) => e.id === glass2.data.id)?.awaitingReview === false,
    reviewReal.ok ? "" : reviewReal.message);

  // ── 17. WHAT THE PAGE IS ALLOWED TO SAY ──────────────────────────────────

  const finalPosture = await securityPosture(admin, wsA);
  ok("THE POSTURE PROMISES THE SIGN-IN RECORD ONLY NOW THAT ONE EXISTS",
    finalPosture.guarantees.some((g: string) => /Every sign-in that opens this practice is recorded/i.test(g))
    && finalPosture.guarantees.some((g: string) => /same browser is the same device/i.test(g)),
    JSON.stringify(finalPosture.guarantees));
  ok("⚠ AND IT NAMES THE THING IT STILL CANNOT DO: failed sign-in attempts are counted nowhere, which is "
    + "also why there is no account lockout",
    finalPosture.notKnowableFromHere.some((s: string) => /failed to sign in/i.test(s))
    && finalPosture.accountLockoutBuiltHere === false
    && finalPosture.failedSignInAttemptsVisibleHere === false,
    JSON.stringify(finalPosture.notKnowableFromHere));
  ok("it says whether an idle limit is set and that the limit now takes effect",
    finalPosture.idleLimitEnforced === false && finalPosture.idleLimitMinutes === null
    && finalPosture.idleLockOutClearedBySigningInAgain === true,
    JSON.stringify({ e: finalPosture.idleLimitEnforced, m: finalPosture.idleLimitMinutes }));
  await updateSecurityPolicy(admin, { workspaceId: wsA, sessionIdleMinutes: 30, ...base });
  const postureIdle = await securityPosture(admin, wsA);
  ok("CONTROL: with a limit set, the posture says so with the number -- it is not hardcoded off",
    postureIdle.idleLimitEnforced === true && postureIdle.idleLimitMinutes === 30,
    JSON.stringify({ e: postureIdle.idleLimitEnforced, m: postureIdle.idleLimitMinutes }));
  await updateSecurityPolicy(admin, { workspaceId: wsA, sessionIdleMinutes: null, ...base });
  ok("STILL NO SCORE, NO PERCENTAGE AND NO COMPLIANCE BADGE after all of the above",
    !/\d+(\.\d+)?%/.test(JSON.stringify(finalPosture)) && !/HIPAA|GDPR|compliant/i.test(JSON.stringify(finalPosture)));

  // ── 18. THE PUBLIC PAGE MAY NOT CLAIM WHAT THE ENGINE DENIES ─────────────
  //
  // ⚠ NOTHING ANYWHERE ASSERTED AGAINST THE MARKETING COPY, WHICH IS HOW THREE FALSE SECURITY CLAIMS
  // STOOD ON A PUBLIC PAGE UNDER GREEN TICKS. `/practice/login` renders PRACTICE_LOGIN.security beneath
  // the heading "How access is protected", so every line in it is a present-tense claim about a control.
  // These assertions tie that list to the engine's own account of itself: a claim can only go back on the
  // page when the field that denies it changes.

  const claims = PRACTICE_LOGIN.security.join(" | ");
  ok("⚠ THE PUBLIC PAGE NO LONGER CLAIMS ACCOUNT LOCKOUT, because the posture says there is none",
    finalPosture.accountLockoutBuiltHere === false
    && !/lockout|brute[- ]force/i.test(claims)
    && PRACTICE_LOGIN.planned.some(p => /lockout/i.test(p)),
    claims);
  ok("the sign-in claim is the narrow one the code can keep, not the unqualified one it could not",
    /Every sign-in that opens your practice is recorded/i.test(claims)
    && !PRACTICE_LOGIN.security.includes("Every sign-in recorded"),
    claims);
  ok("and the idle claim says it is something a practice sets rather than something every practice has",
    /idle sign-out limit your practice can set/i.test(claims) && !/^Session timeout$/m.test(claims),
    claims);
  ok("⚠ AND THE PATIENT PAGE DOES NOT TICK A SIGN-IN RECORD FOR A SIGN-IN THAT DOES NOT EXIST",
    !PATIENT_LOGIN.privacy.some(p => /sign-in is recorded/i.test(p))
    && PATIENT_LOGIN.planned.some(p => /patient sign-in/i.test(p)),
    PATIENT_LOGIN.privacy.join(" | "));
  ok("CONTROL: both lists still make the claims that ARE true, so this is not asserting an empty page",
    PRACTICE_LOGIN.security.length >= 4
    && PRACTICE_LOGIN.security.some(s => /Role-based routing/i.test(s))
    && PATIENT_LOGIN.privacy.some(p => /only your own information/i.test(p)));

  // ── 10. Isolation ────────────────────────────────────────────────────────
  const crossRevoke = await revokeSession(admin, {
    workspaceId: wsB, sessionId: fresh.sessionId!, actorId: OTHER, correlationId: "h",
  });
  ok("another workspace's device cannot be revoked", !crossRevoke.ok && crossRevoke.code === "NOT_FOUND");
  const crossGlass = await breakGlass(admin, {
    workspaceId: wsB, userId: LOCUM, reason: "Trying it on from another practice", correlationId: "h",
  });
  ok("and a member of A has no emergency claim on B", !crossGlass.ok && crossGlass.code === "NOT_A_MEMBER");
  ok("B has no consents", (await consentSummary(admin, wsB)).active === 0);
  ok("A does (the isolation test is not vacuous)", (summary.active ?? 0) > 0);
  ok("B has no break-glass episodes", (await breakGlassLog(admin, wsB)).episodes.length === 0);

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
