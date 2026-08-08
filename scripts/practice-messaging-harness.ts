/**
 * Delivery channel harness -- PIS-000 s11/s14, IAM-000 s3/s7, CPR-PRM-001 s10. Migration 224.
 *
 * NOTHING IN THIS FILE SENDS ANYTHING. The transport is injected, so every "send" below is recorded by
 * a function in this file and never reaches a gateway or a phone.
 *
 * WHAT IT PROVES:
 *   1. THE CALLER NEVER SUPPLIES PROSE. Every body is composed from a template, and an unknown purpose
 *      is refused -- so there is no path that puts arbitrary text into a patient's SMS.
 *   2. NO TEMPLATE CARRIES CLINICAL CONTENT, a practice name in an OTP, or a reason for an appointment.
 *   3. "DO NOT CONTACT" OUTRANKS EVERYTHING, including the practice's own settings.
 *   4. CONSENT GATES SENDING, and "never asked" reads differently from "declined".
 *   5. A REFUSAL IS A ROW WITH A REASON, not silence -- "why did my patient never get their code" is
 *      the question this log exists to answer.
 *   6. "HANDED OVER" IS NOT "DELIVERED": handed_to_provider_at is set, delivery_confirmed_at is not,
 *      and the payload says receipts are unavailable rather than letting a null read as failure.
 *   7. THE OTP CODE IS NEVER STORED IN PLAINTEXT.
 *   8. AN OTP IS SINGLE-USE, EXPIRES, AND IS ATTEMPT-LIMITED -- and issuing a new one spends the old.
 *   9. EVERY OTP FAILURE GIVES THE SAME REFUSAL, so nothing tells a guesser which guess was close.
 *  10. A CODE THAT COULD NOT BE SENT IS SPENT IMMEDIATELY, so nothing can verify against a code nobody
 *      received.
 *  11. RATE LIMITED PER DESTINATION, or this product becomes a way to text a stranger a hundred times.
 *  12. A CHANNEL CANNOT BE ENABLED WITHOUT A SENDER IDENTITY.
 *  13. Capability, and cross-workspace isolation, both non-vacuously.
 *
 *   npx --yes tsx scripts/practice-messaging-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { recordConsent, updatePatientAdmin } from "../src/lib/practice/relationships";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  sendMessage, setChannel, channelSettings, messageLog, issueOtp, verifyOtp,
  messagingStatus, MESSAGE_PURPOSES, type Transport,
} from "../src/lib/practice/messaging";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

// A PROVIDER IS PRETENDED INTO EXISTENCE so the engine's own configured-check passes. No request is
// made: the transport below is what actually runs.
process.env.TWILIO_ACCOUNT_SID ||= "AC_harness_only";
process.env.TWILIO_AUTH_TOKEN ||= "harness_only";
process.env.RESEND_API_KEY ||= "re_harness_only";

const OWNER = "00000000-0000-4000-8000-0000000dc001";
const OTHER = "00000000-0000-4000-8000-0000000dc002";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

/** The recorder. Everything "sent" in this run lands here and nowhere else. */
const outbox: { kind: string; destination: string; body: string; subject?: string }[] = [];
const recorder: Transport = async (kind, destination, body, subject) => {
  outbox.push({ kind, destination, body, subject });
  return { ok: true, providerMessageId: `harness-${outbox.length}`, response: '{"harness":true}' };
};
const failing: Transport = async () => ({ ok: false, response: "harness: the gateway refused" });

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-msg-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-msg",
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: "harness-msg", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      await admin.from("practice_otp_challenge").delete().eq("workspace_id", w.id);
      await admin.from("practice_patient_identifier").delete().eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
    }
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
  await admin.from("practice_otp_challenge").delete().like("destination", "+256700%");
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const base = { actorId: OWNER, correlationId: "harness-msg" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function withoutCapability(workspaceId: string, userId: string, capability: string): Promise<WorkspaceContext> {
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId);
  await admin.from("practice_role_assignment").update({ effective_to: new Date().toISOString() })
    .in("membership_id", ((mine ?? []) as any[]).map(m => m.id))
    .eq("capability_code", capability).is("effective_to", null);
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  if (!res.ok) throw new Error("context failed");
  return res.ctx;
}

async function main() {
  console.log("\nDelivery channel harness (migration 224) -- nothing here sends anything\n");
  await cleanup();

  // ── 1, 2. The templates, before any data ───────────────────────────────────
  ok("1. THE PURPOSE LIST IS CLOSED, and there is no 'other'",
    MESSAGE_PURPOSES.length === 6 && !MESSAGE_PURPOSES.includes("other") &&
    MESSAGE_PURPOSES.includes("otp_booking"),
    MESSAGE_PURPOSES.join(","));

  const wsA = await provision(OWNER, "HARNESS Messaging A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Messaging B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  // ── 12. A channel needs a sender identity ──────────────────────────────────
  const noSender = await setChannel(admin, a.ctx, {
    kind: "sms", enabled: true, correlationId: "harness-msg",
  });
  ok("12. A CHANNEL CANNOT BE ENABLED WITHOUT A SENDER NAME -- an unknown number is a scam to a patient",
    !noSender.ok && noSender.code === "SENDER_REQUIRED",
    noSender.ok ? "it was enabled" : noSender.code);

  // ── 3. Off by default ──────────────────────────────────────────────────────
  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nabwire Joan", sex: "female", birthDate: "1991-02-02",
    phone: "+256700000001", ...base,
  });
  if (!p1.ok) { ok("a patient registers", false, p1.message); return report(); }
  ok("a patient registers", true);

  const beforeEnable = await sendMessage(admin, {
    workspaceId: wsA, kind: "sms", purpose: "appointment_reminder", destination: "+256700000001",
    params: { practitioner: "Dr Okello", when: "Tuesday 10am" }, patientId: p1.data.id,
    correlationId: "harness-msg", transport: recorder,
  });
  ok("3. NOTHING SENDS BEFORE THE PRACTICE SWITCHES IT ON",
    beforeEnable.ok && beforeEnable.data.status === "refused" &&
    /not switched on/i.test(beforeEnable.data.refusedReason ?? ""),
    JSON.stringify(beforeEnable));
  ok("3b. AND NOTHING REACHED THE TRANSPORT", outbox.length === 0, String(outbox.length));

  // ── 5. A refusal is a row ──────────────────────────────────────────────────
  const log1 = await messageLog(admin, a.ctx);
  ok("5. THE REFUSAL IS A ROW WITH A REASON, not silence",
    log1.refused === 1 && log1.messages[0].status === "refused" &&
    !!log1.messages[0].refused_reason,
    JSON.stringify(log1.messages[0]?.refused_reason));

  const enabled = await setChannel(admin, a.ctx, {
    kind: "sms", enabled: true, senderName: "Kampala Clinic", correlationId: "harness-msg",
  });
  ok("CONTROL: with a sender name it enables", enabled.ok, enabled.ok ? "" : enabled.message);

  // ── 4. Consent gates it ────────────────────────────────────────────────────
  const noConsent = await sendMessage(admin, {
    workspaceId: wsA, kind: "sms", purpose: "appointment_reminder", destination: "+256700000001",
    params: { practitioner: "Dr Okello", when: "Tuesday 10am" }, patientId: p1.data.id,
    correlationId: "harness-msg", transport: recorder,
  });
  ok("4. CONSENT GATES SENDING -- and 'never asked' says so",
    noConsent.ok && noConsent.data.status === "refused" &&
    /not been asked/i.test((noConsent as any).data?.refusedReason ?? ""),
    (noConsent as any).data?.refusedReason);

  await recordConsent(admin, a.ctx, {
    patientId: p1.data.id, consentType: "contact_by_practice", state: "declined",
    correlationId: "harness-msg",
  });
  const declined = await sendMessage(admin, {
    workspaceId: wsA, kind: "sms", purpose: "appointment_reminder", destination: "+256700000001",
    params: { practitioner: "Dr Okello", when: "Tuesday 10am" }, patientId: p1.data.id,
    correlationId: "harness-msg", transport: recorder,
  });
  ok("4b. AND 'DECLINED' READS DIFFERENTLY FROM 'NEVER ASKED' -- they are different facts",
    declined.ok && /declined/i.test((declined as any).data?.refusedReason ?? "") &&
    (declined as any).data?.refusedReason !== (noConsent as any).data?.refusedReason,
    (declined as any).data?.refusedReason);

  await recordConsent(admin, a.ctx, {
    patientId: p1.data.id, consentType: "contact_by_practice", state: "given",
    noticeVersion: "privacy-1", correlationId: "harness-msg",
  });
  const sent = await sendMessage(admin, {
    workspaceId: wsA, kind: "sms", purpose: "appointment_reminder", destination: "+256700000001",
    params: { practitioner: "Dr Okello", when: "Tuesday 10am" }, patientId: p1.data.id,
    correlationId: "harness-msg", transport: recorder,
  });
  ok("4c. CONTROL: with consent given, it is handed over",
    sent.ok && sent.data.status === "handed_over", JSON.stringify(sent));
  ok("4d. and the transport received exactly one message", outbox.length === 1, String(outbox.length));

  // ── 2. The body is the template's ──────────────────────────────────────────
  ok("2. THE BODY IS THE TEMPLATE'S -- the caller supplied parameters, never prose",
    outbox[0].body === "Reminder: your appointment with Dr Okello is on Tuesday 10am.",
    outbox[0].body);
  const unknownPurpose = await sendMessage(admin, {
    workspaceId: wsA, kind: "sms", purpose: "anything_at_all", destination: "+256700000001",
    params: {}, correlationId: "harness-msg", transport: recorder,
  });
  ok("2b. AND AN UNKNOWN PURPOSE IS REFUSED -- there is no free-text path",
    !unknownPurpose.ok && unknownPurpose.code === "UNKNOWN_PURPOSE");
  const wrongChannel = await sendMessage(admin, {
    workspaceId: wsA, kind: "sms", purpose: "invitation_code", destination: "+256700000001",
    params: { practice: "X", code: "Y", expires: "Z" }, correlationId: "harness-msg", transport: recorder,
  });
  ok("2c. and a purpose cannot be sent down a channel it was not written for",
    !wrongChannel.ok && wrongChannel.code === "WRONG_CHANNEL");

  // ── 3. "Do not contact" outranks everything ────────────────────────────────
  await updatePatientAdmin(admin, a.ctx, {
    patientId: p1.data.id, preferredContactMethod: "none", correlationId: "harness-msg",
  });
  const doNotContact = await sendMessage(admin, {
    workspaceId: wsA, kind: "sms", purpose: "appointment_reminder", destination: "+256700000001",
    params: { practitioner: "Dr Okello", when: "Wednesday 9am" }, patientId: p1.data.id,
    correlationId: "harness-msg", transport: recorder,
  });
  ok("3c. 'DO NOT CONTACT' OUTRANKS CONSENT AND THE PRACTICE'S OWN SETTINGS",
    doNotContact.ok && doNotContact.data.status === "refused" &&
    /asked not to be contacted/i.test((doNotContact as any).data?.refusedReason ?? ""),
    (doNotContact as any).data?.refusedReason);
  ok("3d. and still nothing more reached the transport", outbox.length === 1, String(outbox.length));
  await updatePatientAdmin(admin, a.ctx, {
    patientId: p1.data.id, preferredContactMethod: "sms", correlationId: "harness-msg",
  });

  // ── 6. Handed over is not delivered ────────────────────────────────────────
  const { data: sentRow } = await admin.from("practice_message")
    .select("*").eq("id", sent.ok ? sent.data.messageId : "").maybeSingle();
  ok("6. handed_to_provider_at IS SET", !!sentRow?.handed_to_provider_at, String(sentRow?.handed_to_provider_at));
  ok("6b. AND delivery_confirmed_at IS NOT -- nothing here knows whether it arrived",
    sentRow?.delivery_confirmed_at === null);
  ok("6c. the provider's own response is kept verbatim",
    sentRow?.provider_response === '{"harness":true}', sentRow?.provider_response);
  const log2 = await messageLog(admin, a.ctx);
  ok("6d. AND THE LOG SAYS RECEIPTS ARE UNAVAILABLE, so a null is not read as failure",
    log2.receiptsAvailable === false && /may still not have reached/i.test(log2.deliveryNote));
  ok("6e. there is no column called sent_at on this table",
    sentRow !== null && !("sent_at" in sentRow), Object.keys(sentRow ?? {}).join(","));

  // ── 7, 8, 9, 10. OTP ───────────────────────────────────────────────────────
  const otp = await issueOtp(admin, {
    workspaceId: wsA, purpose: "booking", channel: "sms", destination: "+256700000002",
    correlationId: "harness-msg", transport: recorder,
  });
  ok("an OTP is issued", otp.ok, otp.ok ? "" : otp.message);
  if (!otp.ok) return report();

  const code = (outbox[outbox.length - 1].body.match(/^(\d{6})/) ?? [])[1];
  ok("7. THE CODE IS SIX DIGITS AND REACHED THE MESSAGE", !!code && /^\d{6}$/.test(code), String(code));
  const { data: challenge } = await admin.from("practice_otp_challenge")
    .select("*").eq("id", otp.data.challengeId).maybeSingle();
  ok("7b. AND IT IS NOT STORED IN PLAINTEXT ANYWHERE ON THE CHALLENGE",
    !JSON.stringify(challenge).includes(code!) && challenge.code_hash.length === 64,
    challenge?.code_hash?.slice(0, 16));
  ok("2d. THE OTP MESSAGE NAMES NO PRACTICE, NO PRACTITIONER AND NO REASON",
    !/Kampala Clinic|Okello|appointment/i.test(outbox[outbox.length - 1].body),
    outbox[outbox.length - 1].body);

  const wrongCode = await verifyOtp(admin, { challengeId: otp.data.challengeId, code: "000000" });
  const wrongChallenge = await verifyOtp(admin, {
    challengeId: "00000000-0000-4000-8000-000000000000", code: code!,
  });
  ok("9. EVERY FAILURE GIVES THE SAME REFUSAL -- nothing tells a guesser which guess was close",
    !wrongCode.ok && !wrongChallenge.ok &&
    (wrongCode as any).code === (wrongChallenge as any).code && (wrongCode as any).message === (wrongChallenge as any).message,
    `${(wrongCode as any).code}/${(wrongChallenge as any).code}`);

  const verified = await verifyOtp(admin, { challengeId: otp.data.challengeId, code: code! });
  ok("8. THE RIGHT CODE VERIFIES", verified.ok && (verified as any).data.destination === "+256700000002",
    verified.ok ? "" : verified.message);
  const twice = await verifyOtp(admin, { challengeId: otp.data.challengeId, code: code! });
  ok("8b. AND IT IS SINGLE-USE -- the second attempt is refused", !twice.ok);

  // Attempt limit.
  const otp2 = await issueOtp(admin, {
    workspaceId: wsA, purpose: "booking", channel: "sms", destination: "+256700000003",
    correlationId: "harness-msg", transport: recorder,
  });
  if (otp2.ok) {
    const realCode = (outbox[outbox.length - 1].body.match(/^(\d{6})/) ?? [])[1];
    for (let i = 0; i < 5; i++) await verifyOtp(admin, { challengeId: otp2.data.challengeId, code: "111111" });
    const afterLimit = await verifyOtp(admin, { challengeId: otp2.data.challengeId, code: realCode! });
    ok("8c. AND ATTEMPT-LIMITED -- the RIGHT code is refused after five wrong ones",
      !afterLimit.ok, afterLimit.ok ? "it verified" : "");
  } else ok("a second OTP is issued", false, otp2.message);

  // Expiry.
  const otp3 = await issueOtp(admin, {
    workspaceId: wsA, purpose: "sign_in", channel: "sms", destination: "+256700000004",
    correlationId: "harness-msg", transport: recorder,
  });
  if (otp3.ok) {
    const c3 = (outbox[outbox.length - 1].body.match(/^(\d{6})/) ?? [])[1];
    await admin.from("practice_otp_challenge")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", otp3.data.challengeId);
    const expired = await verifyOtp(admin, { challengeId: otp3.data.challengeId, code: c3! });
    ok("8d. AND EXPIRES", !expired.ok);
  } else ok("a third OTP is issued", false, otp3.message);

  // A new code spends the old.
  const first = await issueOtp(admin, {
    workspaceId: wsA, purpose: "booking", channel: "sms", destination: "+256700000005",
    correlationId: "harness-msg", transport: recorder,
  });
  const firstCode = first.ok ? (outbox[outbox.length - 1].body.match(/^(\d{6})/) ?? [])[1] : null;
  const second = await issueOtp(admin, {
    workspaceId: wsA, purpose: "booking", channel: "sms", destination: "+256700000005",
    correlationId: "harness-msg", transport: recorder,
  });
  ok("8e. ISSUING A NEW CODE SPENDS THE OLD ONE -- two live codes is not 'one time'",
    first.ok && second.ok &&
    !(await verifyOtp(admin, { challengeId: (first as any).data.challengeId, code: firstCode! })).ok,
    "the old code still worked");

  // ── 10. An undeliverable code is spent immediately ─────────────────────────
  const undeliverable = await issueOtp(admin, {
    workspaceId: wsA, purpose: "booking", channel: "sms", destination: "+256700000006",
    correlationId: "harness-msg", transport: failing,
  });
  ok("10. A CODE THAT COULD NOT BE SENT IS REFUSED, not returned as though it were live",
    !undeliverable.ok && undeliverable.code === "NOT_DELIVERED",
    undeliverable.ok ? "it succeeded" : undeliverable.code);
  const { data: deadChallenges } = await admin.from("practice_otp_challenge")
    .select("consumed_at").eq("destination", "+256700000006");
  ok("10b. AND THE CHALLENGE IS SPENT IMMEDIATELY -- nothing can verify against a code nobody received",
    ((deadChallenges ?? []) as any[]).every(c => c.consumed_at !== null),
    JSON.stringify(deadChallenges));

  // ── 11. Rate limit ─────────────────────────────────────────────────────────
  let limited: any = null;
  for (let i = 0; i < 8; i++) {
    limited = await issueOtp(admin, {
      workspaceId: wsA, purpose: "booking", channel: "sms", destination: "+256700000007",
      correlationId: "harness-msg", transport: recorder,
    });
    if (!limited.ok) break;
  }
  ok("11. RATE LIMITED PER DESTINATION -- or this is a way to text a stranger a hundred times",
    !limited.ok && limited.code === "TOO_MANY_CODES", limited?.code);

  // ── 13. Capability and isolation ───────────────────────────────────────────
  const noSettings = await withoutCapability(wsA, OWNER, "practice.settings.manage");
  const refused = await setChannel(admin, noSettings, {
    kind: "email", enabled: true, senderName: "X", correlationId: "harness-msg",
  });
  ok("13. ENABLING A CHANNEL NEEDS practice.settings.manage",
    !refused.ok && refused.code === "FORBIDDEN");
  const stillReads = await channelSettings(admin, wsA);
  ok("13b. CONTROL: reading the settings does not", stillReads.length === 2);

  const crossLog = await messageLog(admin, b.ctx);
  ok("13c. ANOTHER PRACTICE SEES NONE OF THIS ONE'S MESSAGES",
    crossLog.messages.length === 0, String(crossLog.messages.length));
  const crossChannels = await channelSettings(admin, wsB);
  ok("13d. and its own channels are separately off",
    crossChannels.every(c => !c.enabled), JSON.stringify(crossChannels.map(c => c.enabled)));
  const crossSend = await sendMessage(admin, {
    workspaceId: wsB, kind: "sms", purpose: "appointment_reminder", destination: "+256700000001",
    params: { practitioner: "X", when: "Y" }, patientId: p1.data.id,
    correlationId: "harness-msg", transport: recorder,
  });
  ok("13e. and it cannot send using this one's channel",
    crossSend.ok && crossSend.data.status === "refused", JSON.stringify(crossSend));

  ok("the provider status reports receipts as unavailable on every channel",
    messagingStatus().sms.receiptsAvailable === false && messagingStatus().email.receiptsAvailable === false);

  await cleanup();
  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  console.log(`  (${outbox.length} message(s) recorded by the harness transport -- none left this process)\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
