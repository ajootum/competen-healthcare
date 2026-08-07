/**
 * Appointment notice harness -- the three templates migration 224 wrote and nothing ever called.
 *
 * NOTHING IN THIS FILE SENDS ANYTHING. The transport is injected, so every "send" below is recorded by a
 * function in this file and never reaches a gateway, a phone or an inbox.
 *
 * WHY IT EXISTS. sendMessage() had exactly one caller -- issueOtp -- so appointment_confirmation,
 * appointment_reminder and appointment_cancelled were unreachable. The day a provider key is configured,
 * this product would have sent sign-in codes and nothing else.
 *
 * WHAT IT PROVES:
 *   1. ONLY THE STATE MACHINE MAY SAY "CONFIRMED". A REQUESTED booking tells nobody, and says why.
 *   2. A CONFIRMED APPOINTMENT REACHES THE PATIENT, from the template, naming who and when.
 *   3. THE TIME IS THE PRACTICE'S CLOCK, not the server's.
 *   4. NO CLINICAL CONTENT: the reason for the appointment never leaves.
 *   5. WHO IT IS WITH IS READ, NOT INVENTED -- the practitioner on an individual practice, the practice
 *      itself otherwise.
 *   6. CANCELLING TELLS THE PATIENT TOO; arriving and completing do not, and say why.
 *   7. ⚠ WITH NO PROVIDER CONFIGURED NOTHING CLAIMS TO SEND. It refuses, the refusal is a ROW with a
 *      reason, and nothing reaches the transport.
 *   8. THE WHOLE CONSENT LADDER STILL GOVERNS -- these messages get no exemption from it.
 *   9. A PATIENT WITH NO CONTACT DETAILS IS A STATED REASON, not silence and not a row.
 *  10. ANOTHER PRACTICE CANNOT NOTIFY THIS ONE'S APPOINTMENT.
 *  11. AN UNREADABLE APPOINTMENT IS AN OUTAGE, NOT AN ABSENCE -- 503, never 404.
 *  12. THE HTTP WRAPPER NEVER THROWS AND NEVER FAILS, so a gateway can never undo a booking.
 *  13. EVERY OUTCOME IS AUDITED.
 *
 *   npx --yes tsx scripts/practice-appointment-notice-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { recordConsent, updatePatientAdmin } from "../src/lib/practice/relationships";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { bookAppointment, transitionAppointment } from "../src/lib/practice/scheduling";
import { notifyAppointment, appointmentNotice, type Transport } from "../src/lib/practice/messaging";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

// A PROVIDER IS PRETENDED INTO EXISTENCE so the engine's own configured-check passes. No request is made:
// the transport below is what actually runs. Assertion 7 removes these again, deliberately.
process.env.TWILIO_ACCOUNT_SID ||= "AC_harness_only";
process.env.TWILIO_AUTH_TOKEN ||= "harness_only";
process.env.TWILIO_FROM ||= "+15550000000";
process.env.RESEND_API_KEY ||= "re_harness_only";
process.env.RESEND_FROM ||= "harness@example.invalid";

const OWNER = "00000000-0000-4000-8000-0000000ab001";
const OTHER = "00000000-0000-4000-8000-0000000ab002";

/* eslint-disable @typescript-eslint/no-explicit-any */

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const outbox: { kind: string; destination: string; body: string; subject?: string }[] = [];
const recorder: Transport = async (kind, destination, body, subject) => {
  outbox.push({ kind, destination, body, subject });
  return { ok: true, providerMessageId: `harness-${outbox.length}`, response: '{"harness":true}' };
};

/** Points a named table at one that does not exist, so PostgREST produces the real failure. */
const brokenFor = (tables: string[]) => ({
  from(table: string) { return (admin as any).from(tables.includes(table) ? "table_that_does_not_exist_notice_harness" : table); },
}) as any;

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-apn-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-apn",
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: "harness-apn", workspace_id: null }, payload(name));
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
      await admin.from("practice_workspace").delete().eq("id", w.id);
    }
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
}

const base = { actorId: OWNER, correlationId: "harness-apn" };
const notify = (workspaceId: string, appointmentId: string, client: any = admin) =>
  notifyAppointment(client, { workspaceId, appointmentId, actorId: OWNER, correlationId: "harness-apn", transport: recorder });

/** 07:30Z on a Tuesday. Kampala is UTC+3, so the practice's clock says 10:30. */
const WHEN_UTC = "2026-09-15T07:30:00.000Z";

async function main() {
  console.log("\nAppointment notice harness -- the three templates nothing called\n");
  await cleanup();

  const wsA = await provision(OWNER, "HARNESS Notice A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Notice B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  if (!a.ok) { ok("workspace context resolves", false); return report(); }

  // Provisioning names the identity and the practice the same thing, which would make assertions 5 and
  // 5b indistinguishable -- the practitioner's name has to differ from the practice's for "which of the
  // two did it use" to be a question with an answer.
  await admin.from("practice_practitioner_identity")
    .update({ display_name: "Dr Amina Nakato (synthetic)" }).eq("user_id", OWNER);

  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Namuli Grace", sex: "female", birthDate: "1990-03-03",
    phone: "+256701000001", ...base,
  });
  if (!p1.ok) { ok("a patient registers", false, p1.message); return report(); }
  ok("a patient registers", true);

  const appt = await bookAppointment(admin, {
    workspaceId: wsA, patientId: p1.data.id, patientName: "Namuli Grace",
    appointmentType: "new_consultation", scheduledAt: WHEN_UTC, durationMinutes: 30,
    reason: "chest pain on exertion", ...base,
  });
  if (!appt.ok) { ok("an appointment is booked", false, appt.message); return report(); }
  ok("an appointment is booked", true);

  // ── 1. Only the state machine may say "confirmed" ──────────────────────────
  const atRequested = await notify(wsA, appt.data.id);
  ok("1. A REQUESTED APPOINTMENT TELLS NOBODY -- only the state machine may claim it is confirmed",
    atRequested.ok && atRequested.data.attempted === null &&
    /REQUESTED/.test(atRequested.data.notAttempted ?? "") && /nothing to tell/i.test(atRequested.data.notAttempted ?? ""),
    JSON.stringify(atRequested));
  ok("1b. AND NOTHING REACHED THE TRANSPORT", outbox.length === 0, String(outbox.length));

  // ── The channel and consent, so the happy path can exist ──────────────────
  const { setChannel } = await import("../src/lib/practice/messaging");
  const enabled = await setChannel(admin, a.ctx, {
    kind: "sms", enabled: true, senderName: "Kampala Clinic", correlationId: "harness-apn",
  });
  ok("the practice switches sms on", enabled.ok, enabled.ok ? "" : enabled.message);

  // ── 8. Consent still governs -- these messages get no exemption ────────────
  await transitionAppointment(admin, { workspaceId: wsA, appointmentId: appt.data.id, to: "CONFIRMED", ...base });
  const noConsent = await notify(wsA, appt.data.id);
  ok("8. THE CONSENT LADDER STILL GOVERNS -- a confirmation is not exempt from it",
    noConsent.ok && noConsent.data.attempted?.status === "refused" &&
    /not been asked/i.test(noConsent.data.attempted?.refusedReason ?? ""),
    JSON.stringify(noConsent));
  ok("8b. and nothing reached the transport", outbox.length === 0, String(outbox.length));

  await recordConsent(admin, a.ctx, {
    patientId: p1.data.id, consentType: "contact_by_practice", state: "given",
    noticeVersion: "privacy-1", correlationId: "harness-apn",
  });

  // ── 2, 3, 4, 5. The happy path ─────────────────────────────────────────────
  const confirmed = await notify(wsA, appt.data.id);
  ok("2. A CONFIRMED APPOINTMENT REACHES THE PATIENT",
    confirmed.ok && confirmed.data.purpose === "appointment_confirmation" &&
    confirmed.data.attempted?.status === "handed_over" && confirmed.data.notAttempted === null,
    JSON.stringify(confirmed));
  ok("2b. and exactly one message was handed over", outbox.length === 1, String(outbox.length));

  const { data: identity } = await admin.from("practice_practitioner_identity")
    .select("display_name").eq("user_id", OWNER).maybeSingle();
  ok("5. WHO IT IS WITH IS READ FROM THE PRACTITIONER'S OWN IDENTITY, not invented",
    !!identity?.display_name && outbox[0].body.includes(identity.display_name as string),
    `${identity?.display_name} / ${outbox[0]?.body}`);
  ok("2c. and the sentence is the template's, not the caller's",
    outbox[0].body === `Your appointment with ${identity?.display_name} is confirmed for ${outbox[0].body.split("confirmed for ")[1]}`,
    outbox[0].body);

  ok("3. THE TIME IS THE PRACTICE'S CLOCK -- Kampala is UTC+3, and the patient is told 10:30, not 07:30",
    outbox[0].body.includes("10:30") && !outbox[0].body.includes("07:30"), outbox[0].body);

  // ⚠ ASSERTION 3 ALONE IS VACUOUS ON A MACHINE WHOSE OWN CLOCK IS EAST AFRICAN, which this one is:
  // deleting the timezone argument entirely left it passing, because the runtime zone gave the same
  // answer. A time assertion that a developer's laptop can satisfy by coincidence proves nothing. So the
  // practice is moved to a zone no runtime here shares, and the rendered time has to follow the ROW.
  await admin.from("practice_workspace").update({ timezone: "Pacific/Auckland" }).eq("id", wsA);
  const moved = await notify(wsA, appt.data.id);
  await admin.from("practice_workspace").update({ timezone: "Africa/Kampala" }).eq("id", wsA);
  ok("3b. AND IT COMES FROM THE PRACTICE'S OWN ROW, not from whatever clock this process runs on -- the same instant reads 19:30 for a practice in Auckland",
    moved.ok && moved.data.attempted?.status === "handed_over" &&
    outbox[outbox.length - 1].body.includes("19:30") && !outbox[outbox.length - 1].body.includes("10:30"),
    outbox[outbox.length - 1]?.body);
  ok("4. NO CLINICAL CONTENT LEAVES -- the reason for the appointment is not in the message",
    !/chest pain|exertion|new_consultation/i.test(outbox[0].body), outbox[0].body);

  // ── 5b. The fallback, on a practice with more than one practitioner ────────
  await admin.from("practice_workspace").update({ type: "managed_practice" }).eq("id", wsA);
  const { data: wsRow } = await admin.from("practice_workspace").select("name").eq("id", wsA).maybeSingle();
  const managed = await notify(wsA, appt.data.id);
  await admin.from("practice_workspace").update({ type: "individual_practice" }).eq("id", wsA);
  ok("5b. ON A PRACTICE WITH MORE THAN ONE PRACTITIONER IT NAMES THE PRACTICE -- naming a person the appointment does not record would be an invention",
    managed.ok && managed.data.attempted?.status === "handed_over" &&
    outbox[outbox.length - 1].body.includes(wsRow?.name as string) &&
    !outbox[outbox.length - 1].body.includes(identity?.display_name as string),
    `${wsRow?.name} / ${outbox[outbox.length - 1]?.body}`);

  // ── 7. ⚠ Nothing claims to send when no provider is configured ─────────────
  const before7 = outbox.length;
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN;
  const noProvider = await notify(wsA, appt.data.id);
  process.env.TWILIO_ACCOUNT_SID = sid; process.env.TWILIO_AUTH_TOKEN = token;
  ok("7. ⚠ WITH NO PROVIDER CONFIGURED IT REFUSES AND SAYS SO -- it never reports a message it did not hand over",
    noProvider.ok && noProvider.data.attempted?.status === "refused" &&
    /no sms provider is configured/i.test(noProvider.data.attempted?.refusedReason ?? ""),
    JSON.stringify(noProvider));
  ok("7b. AND NOTHING REACHED THE TRANSPORT", outbox.length === before7, `${before7} -> ${outbox.length}`);
  const { data: refusedRow } = await admin.from("practice_message")
    .select("status, refused_reason, purpose, handed_to_provider_at")
    .eq("id", noProvider.ok ? noProvider.data.attempted?.messageId ?? "" : "").maybeSingle();
  ok("7c. AND THE REFUSAL IS A ROW WITH A REASON -- 'why did my patient never hear from us' is what this log answers",
    refusedRow?.status === "refused" && !!refusedRow?.refused_reason &&
    refusedRow?.purpose === "appointment_confirmation" && refusedRow?.handed_to_provider_at === null,
    JSON.stringify(refusedRow));

  // ── 8c. "Do not contact" outranks everything ───────────────────────────────
  await updatePatientAdmin(admin, a.ctx, {
    patientId: p1.data.id, preferredContactMethod: "none", correlationId: "harness-apn",
  });
  const doNotContact = await notify(wsA, appt.data.id);
  ok("8c. 'DO NOT CONTACT' OUTRANKS THE APPOINTMENT -- an appointment is not a reason to override it",
    doNotContact.ok && doNotContact.data.attempted?.status === "refused" &&
    /asked not to be contacted/i.test(doNotContact.data.attempted?.refusedReason ?? ""),
    JSON.stringify(doNotContact));

  // ── The email preference routes to email ──────────────────────────────────
  const p2 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Okot Simon", sex: "male", birthDate: "1978-06-06",
    phone: "+256701000002", email: "okot.simon@example.invalid", ...base,
  });
  if (!p2.ok) { ok("a second patient registers", false, p2.message); return report(); }
  await recordConsent(admin, a.ctx, {
    patientId: p2.data.id, consentType: "contact_by_practice", state: "given",
    noticeVersion: "privacy-1", correlationId: "harness-apn",
  });
  await updatePatientAdmin(admin, a.ctx, {
    patientId: p2.data.id, preferredContactMethod: "email", correlationId: "harness-apn",
  });
  await setChannel(admin, a.ctx, { kind: "email", enabled: true, senderName: "Kampala Clinic", correlationId: "harness-apn" });
  const appt2 = await bookAppointment(admin, {
    workspaceId: wsA, patientId: p2.data.id, patientName: "Okot Simon",
    appointmentType: "walk_in", scheduledAt: WHEN_UTC, allowOverlap: true, ...base,
  });
  const emailed = appt2.ok ? await notify(wsA, appt2.data.id) : null;
  ok("A PATIENT WHO ASKED FOR EMAIL GETS EMAIL -- the preference decides the channel",
    !!emailed?.ok && emailed.data.attempted?.kind === "email" && emailed.data.attempted?.status === "handed_over" &&
    outbox[outbox.length - 1].kind === "email" && !!outbox[outbox.length - 1].subject,
    JSON.stringify([emailed, outbox[outbox.length - 1]?.kind]));

  // ── 6. Cancelling tells them; arriving and completing do not ──────────────
  if (appt2.ok) {
    await transitionAppointment(admin, { workspaceId: wsA, appointmentId: appt2.data.id, to: "ARRIVED", ...base });
    const arrived = await notify(wsA, appt2.data.id);
    ok("6. ARRIVING SAYS NOTHING, AND SAYS WHY -- the patient is standing at the desk",
      arrived.ok && arrived.data.attempted === null && /ARRIVED/.test(arrived.data.notAttempted ?? ""),
      JSON.stringify(arrived));

    await transitionAppointment(admin, { workspaceId: wsA, appointmentId: appt2.data.id, to: "CANCELLED", ...base });
    const cancelled = await notify(wsA, appt2.data.id);
    ok("6b. CANCELLING TELLS THE PATIENT, with the cancellation template",
      cancelled.ok && cancelled.data.purpose === "appointment_cancelled" &&
      cancelled.data.attempted?.status === "handed_over" &&
      /has been cancelled\.$/.test(outbox[outbox.length - 1].body),
      `${JSON.stringify(cancelled)} / ${outbox[outbox.length - 1]?.body}`);
  }

  // ── 9. A patient with nowhere to reach them ───────────────────────────────
  const before9 = outbox.length;
  const { count: msgsBefore } = await admin.from("practice_message")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA);
  const anon = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Walk-in, no contact", appointmentType: "walk_in",
    scheduledAt: WHEN_UTC, allowOverlap: true, ...base,
  });
  const noWhere = anon.ok ? await notify(wsA, anon.data.id) : null;
  const { count: msgsAfter } = await admin.from("practice_message")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA);
  ok("9. A PATIENT WITH NO PHONE AND NO EMAIL IS A STATED REASON, not silence",
    !!noWhere?.ok && noWhere.data.attempted === null &&
    /no phone number or email address/i.test(noWhere.data.notAttempted ?? ""),
    JSON.stringify(noWhere));
  ok("9b. and no message row was written for an attempt that never had a destination",
    msgsAfter === msgsBefore && outbox.length === before9, `${msgsBefore} -> ${msgsAfter}`);

  // ── 10. Isolation ─────────────────────────────────────────────────────────
  const cross = await notify(wsB, appt.data.id);
  ok("10. ANOTHER PRACTICE CANNOT NOTIFY THIS ONE'S APPOINTMENT",
    !cross.ok && cross.code === "NOT_FOUND", JSON.stringify(cross));

  // ── 11. An outage is not an absence ───────────────────────────────────────
  const unreadable = await notifyAppointment(brokenFor(["practice_appointment"]), {
    workspaceId: wsA, appointmentId: appt.data.id, actorId: OWNER, correlationId: "harness-apn", transport: recorder,
  });
  ok("11. AN UNREADABLE APPOINTMENT IS 503, NOT 404 -- reporting an outage as 'there was nobody to tell' is the one answer that stops anybody looking",
    !unreadable.ok && unreadable.code === "APPOINTMENT_UNREADABLE" && unreadable.status === 503,
    JSON.stringify(unreadable));
  const wsUnreadable = await notifyAppointment(brokenFor(["practice_workspace"]), {
    workspaceId: wsA, appointmentId: appt.data.id, actorId: OWNER, correlationId: "harness-apn", transport: recorder,
  });
  ok("11b. and so is an unreadable practice",
    !wsUnreadable.ok && wsUnreadable.code === "WORKSPACE_UNREADABLE", JSON.stringify(wsUnreadable));

  // ── 12. The HTTP wrapper can never undo a booking ─────────────────────────
  const exploding = { from() { throw new Error("harness: the database went away"); } } as any;
  const survived = await appointmentNotice(exploding, {
    workspaceId: wsA, appointmentId: appt.data.id, actorId: OWNER, correlationId: "harness-apn",
  });
  ok("12. THE HTTP WRAPPER NEVER THROWS -- a gateway or a database can never turn a successful booking into a 500",
    survived.attempted === null && /database went away/.test(survived.notAttempted ?? ""),
    JSON.stringify(survived));
  const wrapped503 = await appointmentNotice(brokenFor(["practice_appointment"]), {
    workspaceId: wsA, appointmentId: appt.data.id, actorId: OWNER, correlationId: "harness-apn",
  });
  ok("12b. and it carries the engine's refusal through as a sentence rather than swallowing it",
    wrapped503.attempted === null && /could not be read/i.test(wrapped503.notAttempted ?? ""),
    JSON.stringify(wrapped503));

  // ── 13. Audited ───────────────────────────────────────────────────────────
  const { data: audits } = await admin.from("practice_audit_event")
    .select("event_type, payload").eq("workspace_id", wsA).eq("event_type", "practice.appointment_notice");
  const rows = (audits ?? []) as any[];
  ok("13. EVERY OUTCOME IS AUDITED, refusals included",
    rows.length >= 5 && rows.some(r => r.payload?.status === "handed_over") && rows.some(r => r.payload?.status === "refused"),
    `${rows.length} rows: ${rows.map(r => r.payload?.status).join(",")}`);
  ok("13b. and the audit names the purpose, so 'what did we tell them' is answerable",
    rows.every(r => ["appointment_confirmation", "appointment_cancelled"].includes(r.payload?.purpose)),
    rows.map(r => r.payload?.purpose).join(","));

  await cleanup();
  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  console.log(`  (${outbox.length} message(s) recorded by the harness transport -- none left this process)\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
