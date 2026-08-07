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
  BREAK_GLASS_CAPABILITIES,
} from "../src/lib/practice/security";

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
  for (const u of [OWNER, OTHER]) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) await admin.from("practice_workspace").delete().eq("id", w.id);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
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

/** `admin`, except that `update()` on `table` answers with `result` and writes nothing. */
const adminFailingUpdate = (table: string, result: { data: unknown; error: unknown }): any => new Proxy(admin, {
  get(target: any, prop) {
    if (prop === "from") return (t: string) => {
      const real = target.from(t);
      if (t !== table) return real;
      return new Proxy(real, {
        get(bt: any, bp) {
          if (bp === "update") return () => stubBuilder(result);
          const v = Reflect.get(bt, bp);
          return typeof v === "function" ? v.bind(bt) : v;
        },
      });
    };
    const v = Reflect.get(target, prop);
    return typeof v === "function" ? v.bind(target) : v;
  },
});

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
    sessions.every((s: any) => s.device_id === undefined), JSON.stringify(Object.keys(sessions[0] ?? {})));

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

  const list = await patientConsents(admin, wsA, patient.data.id);
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
  const afterWithdraw = await patientConsents(admin, wsA, patient.data.id);
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
  ok("A does (the isolation test is not vacuous)", summary.active > 0);
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
