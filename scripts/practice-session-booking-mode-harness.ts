/**
 * CPR-V5-007 s4.3 AND s8 -- `booking_mode` IS A RULE, NOT A LABEL.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG, AND WHY IT WAS WORTH A FILE.
 *
 * Migration 240 has stored a session's booking_mode since Phase 1. Two places that decide whether a
 * patient may have a time did not read it:
 *
 *   bookableSlots()   offered every OPEN slot whose session offered the type -- including slots generated
 *                     by a session the practitioner had marked `internal` or `none`. The public page was
 *                     therefore offering strangers times inside a ward round.
 *   checkPlacement()  did not check it either. So even after the page stopped offering those times, the
 *                     only thing standing between a crafted request and an internal session would have
 *                     been the page's own good manners.
 *
 * ⚠ AND THE SECOND IS THE ONE THAT MATTERS. "Only valid options are visible" is not a rule; this codebase
 * learned that from "only free times are visible", which is why migration 255's exclusion constraint
 * exists. Every refusal below is therefore reached by CONSTRUCTING THE REQUEST DIRECTLY through
 * bookUnderRules, so the offering filter cannot be what refuses it.
 *
 * ⚠ THE THING THAT MUST NOT BREAK, ASSERTED AS LOUDLY AS THE THING THAT MUST. A practitioner books into
 * internal sessions constantly and legitimately -- that is most of what a diary is for. Section 2's
 * practitioner control books THE SAME INTERNAL SESSION and must succeed; without it this change would be
 * indistinguishable from breaking internal booking.
 *
 * ---- THE STANDARD ----------------------------------------------------------------------------------
 *
 * Every refusal is reached with everything else already satisfied, and every one has a control that
 * changes EXACTLY ONE thing and shows the booking succeed. A deliberate break that reds more than its own
 * assertion means the fixture is not isolating what it claims to.
 *
 * WHAT IT PROVES:
 *   1. A patient is offered ONLY times in patient-facing sessions -- with a control proving the very same
 *      session becomes offerable when only its mode changes, and unofferable again when it changes back.
 *   2. A patient booking into a non-patient-facing session is REFUSED BY THE ENGINE, with the slot proved
 *      to exist and be free so the refusal cannot be the absence of an offer.
 *   3. ⚠ A PRACTITIONER BOOKING INTO THAT SAME INTERNAL SESSION IS ACCEPTED.
 *   4. The refusal names its own rule, distinctly from SESSION_WALK_IN_LIMIT and PRACTICE_NOT_BOOKABLE --
 *      both of which are provoked for real, in the same session, at the same time.
 *   5. A s14 window override does NOT lift it: the override is recorded, the lead time IS lifted, and the
 *      booking is still refused on the mode.
 *   6. ⚠ A LIMITATION, ASSERTED RATHER THAN HIDDEN: a time no session governs is not refused.
 *
 *   npx --yes tsx scripts/practice-session-booking-mode-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { issueIdentity, claimHandle, updateIdentity } from "../src/lib/practice/identity-service";
import { saveSession, setAppointmentTypes } from "../src/lib/practice/practice-sessions";
import { generateSlots } from "../src/lib/practice/availability-config";
import { saveBookingAccess, setPublishState } from "../src/lib/practice/patient-access";
import { saveBookingRule, bookUnderRules } from "../src/lib/practice/booking-rules";
import { bookAppointment } from "../src/lib/practice/scheduling";
import {
  requestBookingCode, confirmBookingCode, bookableSlots,
} from "../src/lib/practice/patient-booking";
import { checkPatientSession } from "../src/lib/practice/patient-session";
import type { Transport } from "../src/lib/practice/messaging";
import { purgeWorkspacesOwnedBy, cleanupOnKill } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000fc0d1";
/** ⚠ A FIXED-OFFSET ZONE (+03, no DST), which is what lets the minute arithmetic below be exact. */
const TZ = "Africa/Kampala";
const CORR = "harness-bmode";
/** ⚠ UNIQUE PER RUN. practice_audit_event is append-only (migration 247), so section 4's override count
 *  must be scoped to this run or it measures every run this database has ever seen. */
const CORR_OVERRIDE = `harness-bmode-override-${Date.now()}`;
const HANDLE = "harnessbmode";

let phoneSeq = 0;
// ⚠ A FRESH NUMBER PER SESSION. issueOtp rate-limits per destination per hour, correctly -- so reusing
// one number would make TOO_MANY_CODES the thing this file measures instead of what it claims to.
const nextPhone = () => `+2567725557${String(10 + phoneSeq++).padStart(2, "0")}`;

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const section = (n: string) => console.log(`\n  -- ${n} --`);

/* eslint-disable @typescript-eslint/no-explicit-any */

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-bmode-${suffix}-${Date.now()}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: user, correlation_id: CORR, workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", OWNER);
  for (const w of (ws ?? []) as { id: string }[]) {
    const { data: reqs } = await admin.from("practice_booking_request").select("challenge_id").eq("workspace_id", w.id);
    await admin.from("practice_booking_request").delete().eq("workspace_id", w.id);
    await admin.from("practice_booking_access").delete().eq("workspace_id", w.id);
    for (const r of (reqs ?? []) as any[])
      if (r.challenge_id) await admin.from("practice_patient_session").delete().eq("challenge_id", r.challenge_id);
    await admin.from("practice_otp_challenge").delete().eq("workspace_id", w.id);
    await admin.from("practice_message").delete().eq("workspace_id", w.id);
    await admin.from("practice_message_channel").delete().eq("workspace_id", w.id);
    await admin.from("practice_queue_entry").delete().eq("workspace_id", w.id);
    await admin.from("practice_arrival").delete().eq("workspace_id", w.id);
    await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient").delete().eq("workspace_id", w.id);
    await admin.from("practice_booking_rule").delete().eq("workspace_id", w.id);
    await admin.from("practice_session_appointment_type").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_slot").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_template").delete().eq("workspace_id", w.id);
    await admin.from("practice_registration_template").delete().eq("workspace_id", w.id);
    await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().eq("user_id", OWNER);
  await admin.from("provisioning_request").delete().eq("target_user_id", OWNER);
  await admin.from("practice_otp_challenge").delete().like("destination", "+2567725557%");
  // ⚠ NO practice_audit_event DELETE. Migration 247 makes it append-only and REFUSES it; every call that
  // makes one has been a silent no-op since. Section 4 counts audit rows, which is exactly why it scopes
  // itself to CORR_OVERRIDE rather than assuming an empty table.
  // ⚠ The workspace delete itself is purgeWorkspacesOwnedBy, never a hand-rolled loop: it unpicks the six
  // tables that reference practice_parameter_definition with no on-delete clause and REPORTS what survived.
  await purgeWorkspacesOwnedBy(admin, [OWNER]);
}

/** Everything "sent" lands here. No request leaves the process, and no code is ever printed. */
const outbox: { kind: string; destination: string; body: string }[] = [];
const recorder: Transport = async (kind, destination, body) => {
  outbox.push({ kind, destination, body });
  return { ok: true, providerMessageId: `harness-${outbox.length}`, response: '{"harness":true}' };
};
const codeFrom = (body: string) => (body.match(/\b(\d{6})\b/) ?? [])[1] ?? "";

/**
 * A live patient session, the number it verified, and its own id.
 *
 * ⚠ THE SESSION ID IS THE ACTOR, exactly as patient-booking.ts uses it: created_by is a uuid column and a
 * patient has no user id. Inventing a literal here would have made every patient booking below fail at
 * the INSERT with a uuid syntax error -- a fixture defect that would have looked like an engine one.
 */
async function freshPair(workspaceId: string): Promise<{ token: string; phone: string; sessionId: string }> {
  const phone = nextPhone();
  const req = await requestBookingCode(admin, {
    handle: HANDLE, channel: "sms", destination: phone, correlationId: CORR, transport: recorder,
  });
  if (!req.ok) throw new Error(`code request refused: ${req.code} ${req.message}`);
  const confirmed = await confirmBookingCode(admin, {
    challengeId: req.data.challengeId, code: codeFrom(outbox[outbox.length - 1]?.body ?? ""),
  });
  if (!confirmed.ok) throw new Error(`code confirm refused: ${confirmed.code} ${confirmed.message}`);
  const proof = await checkPatientSession(admin, {
    token: confirmed.data.token, workspaceId, destination: phone,
  });
  if (!proof.ok) throw new Error(`session did not verify: ${proof.code}`);
  return { token: confirmed.data.token, phone, sessionId: proof.proof.sessionId };
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** The minute-of-day a UTC instant falls on in the practice's own +03 day. */
const localMinute = (iso: string, dayBaseMs: number) => Math.floor((Date.parse(iso) - dayBaseMs) / 60000);

async function main() {
  console.log("\nCPR-V5-007 s4.3 -- a session's booking mode is enforced, not displayed\n");
  await cleanup();

  // ══ 0. A PRACTICE WITH ONE PATIENT-FACING SESSION AND ONE INTERNAL ONE, SIDE BY SIDE ═══════════
  //
  // ⚠ TWO BANDS ON THE SAME DAY AT THE SAME PLACE, differing in NOTHING BUT THE MODE -- same location,
  // same appointment type, same rules, same diary. Anything that refuses one and not the other is the
  // mode, because there is nothing else left for it to be.
  section("0. Fixture");

  const ws = await provision(OWNER, "Booking Mode Harness", "a");
  const res = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!res.ok) { ok("0-control. context resolves", false); return report(); }
  const ctx: WorkspaceContext = res.ctx;

  ok("0a-control. the owner holds the two capabilities the practitioner and override sections need -- without them section 2b and section 4 would refuse for the wrong reason",
    ctx.capabilities.includes("appointment.manage") && ctx.capabilities.includes("practice.settings.manage"),
    `${ctx.capabilities.length} capabilities`);

  const { data: wsRow } = await admin.from("practice_workspace").select("status").eq("id", ws).maybeSingle();
  const liveStatus = (wsRow?.status as string) ?? "ACTIVE";

  const { data: locRow } = await admin.from("practice_location")
    .insert({ workspace_id: ws, name: "Kampala Rooms", type: "clinic", active: true, travel_buffer_minutes: 0 })
    .select("id").single();
  const locId = locRow!.id as string;

  const identity = await issueIdentity(admin, { userId: OWNER, displayName: "Dr Mode Harness", workspaceId: ws, correlationId: CORR });
  ok("0b-control. an identity was issued", identity.ok, identity.ok ? "" : (identity as any).message);
  const claimed = await claimHandle(admin, { userId: OWNER, handle: HANDLE, correlationId: CORR });
  ok("0c-control. the handle was claimed", claimed.ok, claimed.ok ? "" : (claimed as any).message);
  await updateIdentity(admin, { userId: OWNER, discovery: "link_only", correlationId: CORR });
  await admin.from("practice_practitioner_identity").update({ status: "active" }).eq("user_id", OWNER);

  // Both bands on every weekday, so any date works whenever this runs. 08:00-12:00 local is the patient
  // clinic and 13:00-17:00 local is the internal one; the gap keeps sessionConflict out of it.
  const PATIENT_FROM = 8 * 60, PATIENT_TO = 12 * 60;
  const INTERNAL_FROM = 13 * 60, INTERNAL_TO = 17 * 60;
  const patientTemplates: string[] = [];
  const internalTemplates: string[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const open = await saveSession(admin, ctx, {
      weekday, startsMinute: PATIENT_FROM, endsMinute: PATIENT_TO, locationId: locId,
      sessionName: `Patient clinic ${weekday}`, bookingMode: "link_only",
      appointmentTypes: ["new_consultation"], actorId: OWNER, correlationId: CORR,
    });
    if (open.ok) {
      await setAppointmentTypes(admin, ctx, { templateId: open.data.id, types: ["new_consultation"] });
      patientTemplates.push(open.data.id);
    }
    const shut = await saveSession(admin, ctx, {
      weekday, startsMinute: INTERNAL_FROM, endsMinute: INTERNAL_TO, locationId: locId,
      sessionName: `Internal round ${weekday}`, bookingMode: "internal",
      // ⚠ THE SAME APPOINTMENT TYPE AS THE OPEN ONE. s4.3's "zero linked types means not patient-bookable"
      // is a DIFFERENT rule, and leaving this session with no types would let that rule do the refusing --
      // which would make every assertion below pass for a reason that is not the mode.
      appointmentTypes: ["new_consultation"],
      // Section 3b provokes the per-session walk-in limit in this very session, to prove the two refusals
      // are told apart. Zero is a real limit; null would be no limit at all.
      walkInsAllowed: true, walkInLimit: 0,
      actorId: OWNER, correlationId: CORR,
    });
    if (shut.ok) {
      await setAppointmentTypes(admin, ctx, { templateId: shut.data.id, types: ["new_consultation"] });
      internalTemplates.push(shut.data.id);
    }
  }
  ok("0d-control. seven patient-facing and seven internal sessions exist, each offering new_consultation -- otherwise every refusal below is just an empty diary or an unlinked type",
    patientTemplates.length === 7 && internalTemplates.length === 7,
    `${patientTemplates.length} open, ${internalTemplates.length} internal`);
  if (patientTemplates.length !== 7 || internalTemplates.length !== 7) return report();

  await admin.from("practice_registration_template").insert({
    workspace_id: ws, name: "Booking intake", status: "published", is_default: true,
  });

  const generated = await generateSlots(admin, ctx, {
    fromDate: isoDate(new Date()), toDate: isoDate(new Date(Date.now() + 30 * 86400000)),
    actorId: OWNER, correlationId: CORR,
  });
  ok("0e-control. the diary has generated session windows",
    generated.ok && generated.data.slotsCreated > 0,
    generated.ok ? JSON.stringify(generated.data) : (generated as any).message);

  const savedAccess = await saveBookingAccess(admin, ctx, {
    mode: "link_only", otpRequired: true, visibleLocationIds: [locId],
    visibleAppointmentTypes: ["new_consultation"], consentRequired: false,
    brandDisplayName: "Kampala Rooms", actorId: OWNER, correlationId: CORR,
  });
  ok("0f-control. a booking page was configured", savedAccess.ok, savedAccess.ok ? "" : (savedAccess as any).message);
  await admin.from("practice_booking_access").update({ handle: HANDLE }).eq("workspace_id", ws);

  const allowRule = await saveBookingRule(admin, ctx, {
    name: "Patients may book", status: "active", priority: 10,
    channel: "patient_self", leadTimeMinutes: 0, bookingHorizonDays: 365,
    cancellationNoticeMinutes: 0, actorId: OWNER, correlationId: CORR,
  });
  ok("0g-control. a rule in force covers the patient channel with no notice period -- so nothing but the mode can refuse a patient here",
    allowRule.ok, allowRule.ok ? "" : (allowRule as any).message);

  await admin.from("practice_message_channel").insert([
    { workspace_id: ws, kind: "sms", enabled: true, sender_name: "Harness" },
  ]);
  process.env.AFRICASTALKING_API_KEY = "harness-only";
  process.env.AFRICASTALKING_USERNAME = "harness";

  const published = await setPublishState(admin, ctx, {
    to: "published", acceptWarnings: true, actorId: OWNER, correlationId: CORR,
  });
  ok("0h-control. the page is published", published.ok, published.ok ? "" : (published as any).message);
  if (!published.ok) return report();

  // ── THE INSTANTS, COMPUTED FROM THE PRACTICE'S OWN DAY ─────────────────────────────────────────
  //
  // Kampala is +03 with no DST, so a local minute-of-day is exact arithmetic rather than a guess. Every
  // instant below is named for the band it falls in, and each refusal gets its OWN time: sharing one
  // means a break in the first assertion occupies the slot the control needs and the control then fails
  // on DOUBLE_BOOKED, which controls nothing.
  const day = isoDate(new Date(Date.now() + 3 * 86400000 + 3 * 3600000));
  const dayBase = Date.parse(`${day}T00:00:00+03:00`);
  const at = (minute: number) => new Date(dayBase + minute * 60000).toISOString();

  const T_OPEN_A = at(9 * 60);          // 09:00 local -- inside the patient clinic
  const T_OPEN_B = at(10 * 60);
  const T_OPEN_C = at(11 * 60);
  const T_INTERNAL_A = at(14 * 60);      // 14:00 local -- inside the internal round
  const T_INTERNAL_B = at(14 * 60 + 20);
  const T_INTERNAL_C = at(14 * 60 + 40);
  const T_INTERNAL_D = at(15 * 60);
  const T_INTERNAL_E = at(15 * 60 + 30);
  const T_INTERNAL_F = at(16 * 60);
  const T_UNGOVERNED = at(20 * 60);     // 20:00 local -- no session covers it at all

  /**
   * A patient booking, constructed directly. ⚠ THE CONTEXT CARRIES NO CAPABILITY AND MUST NOT: a patient
   * holds none, and bookUnderRules substitutes the session proof for the capability test on this channel
   * alone. This is the same shape patient-booking.ts builds.
   */
  const bookAsPatient = async (scheduledAt: string, over: Record<string, any> = {}) => {
    const { token, phone, sessionId } = await freshPair(ws);
    const patientCtx: WorkspaceContext = {
      userId: sessionId, workspaceId: ws, workspaceName: "", workspaceType: "", workspaceStatus: "active",
      roleCodes: [], capabilities: [], entitled: true, entitlementStatus: null,
      onboardingComplete: true, onboardingStep: null,
    };
    return bookUnderRules(admin, patientCtx, {
      channel: "patient_self", patientName: "Amina Nabirye", appointmentType: "new_consultation",
      // ⚠ THE INTAKE THE ENGINE NOW DEMANDS (2ae30's enforcement, migs 268/269, landed AFTER this
      // fixture was written). Without these two always-required answers every patient-channel
      // booking below is refused INTAKE_INCOMPLETE before the MODE -- the thing under test -- is
      // ever consulted, and the harness cannot tell one refusal from the other. Supplied rather
      // than switched off, per this file's own control discipline: every refusal is reached with
      // everything ELSE satisfied.
      intake: { given_name: "Amina", family_name: "Nabirye" },
      scheduledAt, locationId: locId, patientSessionToken: token, patientContact: phone,
      actorId: sessionId, correlationId: CORR, ...over,
    });
  };

  // ══ 1. THE OFFERING: ONLY PATIENT-FACING SESSIONS ARE ON THE PAGE ═════════════════════════════
  section("1. What a patient is offered");

  const window = () => ({
    fromIso: new Date(dayBase).toISOString(),
    toIso: new Date(dayBase + 86400000).toISOString(),
  });

  const { data: internalSlotRows } = await admin.from("practice_availability_slot")
    .select("id, starts_at, status").eq("workspace_id", ws)
    .in("generated_from_template_id", internalTemplates).eq("status", "OPEN");
  const internalSlotIds = new Set(((internalSlotRows ?? []) as any[]).map(s => String(s.id)));
  ok("1-control-a. ⚠ THE INTERNAL SESSION GENERATED REAL, OPEN SLOTS. Without this, 1a would pass because that half of the diary is empty rather than because the mode filtered it",
    internalSlotIds.size > 0, String(internalSlotIds.size));

  const offered = await bookableSlots(admin, { handle: HANDLE, appointmentType: "new_consultation", ...window() });
  ok("1-control-b. the page offers real times at all, so 1a is asserting over something",
    offered.ok && offered.data.slots.length > 0,
    offered.ok ? String(offered.data.slots.length) : `${(offered as any).code}: ${(offered as any).message}`);
  if (!offered.ok) return report();

  ok("1a. ⚠ NO OFFERED TIME COMES OUT OF A SESSION THAT IS NOT OPEN TO PATIENTS -- neither by its source slot nor by falling in that session's hours",
    offered.data.slots.every(s => !internalSlotIds.has(s.sourceSlotId))
    && offered.data.slots.every(s => localMinute(s.startsAt, dayBase) < INTERNAL_FROM
      || localMinute(s.startsAt, dayBase) >= INTERNAL_TO),
    JSON.stringify(offered.data.slots.slice(0, 3)));

  // ⚠ THE CONTROL: CHANGE ONLY THE MODE. Nothing else moves -- not the slots, not the types, not the
  // rules, not the diary. The same session becomes offerable, which is what makes 1a about the mode.
  await admin.from("practice_availability_template")
    .update({ booking_mode: "link_only" }).in("id", internalTemplates);
  const reopened = await bookableSlots(admin, { handle: HANDLE, appointmentType: "new_consultation", ...window() });
  ok("1b-control. ⚠ THE SAME SESSION IS OFFERED THE MOMENT ITS MODE CHANGES, with nothing else touched -- so 1a is the mode and not the slot, the type or the hour",
    reopened.ok && reopened.data.slots.some(s => internalSlotIds.has(s.sourceSlotId)),
    reopened.ok ? `${offered.data.slots.length} -> ${reopened.data.slots.length}` : (reopened as any).message);

  await admin.from("practice_availability_template")
    .update({ booking_mode: "internal" }).in("id", internalTemplates);
  const reclosed = await bookableSlots(admin, { handle: HANDLE, appointmentType: "new_consultation", ...window() });
  ok("1b-control-2. and they go again when it changes back -- the filter follows the column in both directions rather than in one",
    reclosed.ok && !reclosed.data.slots.some(s => internalSlotIds.has(s.sourceSlotId))
    && reclosed.data.slots.length === offered.data.slots.length,
    reclosed.ok ? String(reclosed.data.slots.length) : (reclosed as any).message);

  // ══ 2. THE ENGINE: THE REFUSAL IS A RULE, NOT THE ABSENCE OF AN OFFER ═════════════════════════
  section("2. The engine refuses it");

  // ⚠ THE SLOT IS PROVED TO EXIST AND BE FREE FIRST. A refusal at a time with no slot in it proves
  // nothing about the mode -- it is the diary refusing, which is the very confusion this section exists
  // to avoid. checkPlacement never reads slots, so the proof has to be made here.
  const { data: coveringSlot } = await admin.from("practice_availability_slot")
    .select("id, starts_at, ends_at, status").eq("workspace_id", ws)
    .in("generated_from_template_id", internalTemplates).eq("status", "OPEN")
    .lte("starts_at", T_INTERNAL_A).gt("ends_at", T_INTERNAL_A).maybeSingle();
  ok("2-control-a. ⚠ AN OPEN SLOT COVERS THE INTERNAL TIME, so 2a cannot be the absence of a slot",
    !!coveringSlot, JSON.stringify(coveringSlot));

  const patientIntoInternal = await bookAsPatient(T_INTERNAL_A);
  ok("2a. ⚠ A PATIENT BOOKING INTO A NON-PATIENT-FACING SESSION IS REFUSED BY THE ENGINE, with a live session, a valid rule, a free slot and the request constructed directly rather than chosen from the page",
    !patientIntoInternal.ok && (patientIntoInternal as any).code === "SESSION_NOT_PATIENT_BOOKABLE",
    patientIntoInternal.ok ? "it booked" : `${(patientIntoInternal as any).code}: ${(patientIntoInternal as any).message}`);
  ok("2a-detail. and the refusal NAMES THE SESSION and says the mode is the session's own, so nobody goes and reopens the whole practice",
    !patientIntoInternal.ok && /Internal round/.test((patientIntoInternal as any).message)
    && /that session's own booking mode/i.test((patientIntoInternal as any).message),
    patientIntoInternal.ok ? "" : (patientIntoInternal as any).message);

  const { count: internalAppts } = await admin.from("practice_appointment")
    .select("*", { count: "exact", head: true }).eq("workspace_id", ws).eq("scheduled_at", T_INTERNAL_A);
  ok("2a-detail-2. and NOTHING was written -- a refusal that still leaves an appointment is not a refusal",
    (internalAppts ?? -1) === 0, String(internalAppts));

  // ⚠ THE ASSERTION WITHOUT WHICH THIS WHOLE CHANGE IS INDISTINGUISHABLE FROM BREAKING INTERNAL BOOKING.
  //
  // ⚠ TWENTY MINUTES LATER, NOT THE SAME MINUTE, AND THAT IS NOT A WEAKER CLAIM -- it is the same session,
  // the same day, the same location and the same appointment type, which is everything the mode check
  // reads. Sharing 2a's minute read better and coupled the two: a break that let 2a THROUGH occupied the
  // slot, and this control then failed on DOUBLE_BOOKED -- a control failing for a reason that has
  // nothing to do with what it controls. Found by breaking the engine check on purpose.
  const practitionerIntoInternal = await bookUnderRules(admin, ctx, {
    channel: "practitioner", patientName: "Ward Round Patient", appointmentType: "new_consultation",
    scheduledAt: T_INTERNAL_B, locationId: locId, actorId: OWNER, correlationId: CORR,
  });
  ok("2b-control. ⚠ THE PRACTITIONER BOOKS THAT SAME INTERNAL SESSION, minutes from where 2a was refused. The check is channel-aware, and a practice can still use its own diary",
    practitionerIntoInternal.ok,
    practitionerIntoInternal.ok ? "" : `${(practitionerIntoInternal as any).code}: ${(practitionerIntoInternal as any).message}`);

  const staffIntoInternal = await bookUnderRules(admin, ctx, {
    channel: "staff", patientName: "Delegated Booking", appointmentType: "new_consultation",
    scheduledAt: T_INTERNAL_C, locationId: locId, actorId: OWNER, correlationId: CORR,
  });
  ok("2b-control-2. and so does an authorised STAFF delegate -- the refusal is scoped to patient_self, not to every channel that is not a practitioner",
    staffIntoInternal.ok,
    staffIntoInternal.ok ? "" : `${(staffIntoInternal as any).code}: ${(staffIntoInternal as any).message}`);

  const patientIntoOpen = await bookAsPatient(T_OPEN_A);
  ok("2c-control. ⚠ THE SAME PATIENT BOOKING, MOVED ONLY INTO THE OPEN SESSION, SUCCEEDS -- so 2a is the session's mode and not the patient channel",
    patientIntoOpen.ok, patientIntoOpen.ok ? "" : `${(patientIntoOpen as any).code}: ${(patientIntoOpen as any).message}`);

  // ⚠ AND THE OTHER DIRECTION: THE SAME BAND, WITH ONLY THE MODE CHANGED.
  await admin.from("practice_availability_template")
    .update({ booking_mode: "link_only" }).in("id", internalTemplates);
  const patientIntoReopened = await bookAsPatient(T_INTERNAL_D);
  ok("2d-control. ⚠ AND A PATIENT BOOKS THAT VERY SESSION ONCE ITS MODE CHANGES, with nothing else touched -- so 2a is the mode and not the hour of the day",
    patientIntoReopened.ok, patientIntoReopened.ok ? "" : `${(patientIntoReopened as any).code}: ${(patientIntoReopened as any).message}`);
  await admin.from("practice_availability_template")
    .update({ booking_mode: "internal" }).in("id", internalTemplates);

  // ══ 3. WHICH RULE REFUSED, TOLD APART FROM THE TWO IT SITS BESIDE ═════════════════════════════
  //
  // ⚠ "Not bookable" over three different rules is the message that sends somebody to change the wrong
  // setting. All three are provoked FOR REAL below -- in the same practice, the same session and the same
  // hour -- rather than compared as strings.
  section("3. Three refusals, three names");

  await admin.from("practice_workspace").update({ status: "SUSPENDED" }).eq("id", ws);
  const suspended = await bookAsPatient(T_OPEN_B);
  ok("3a. a SUSPENDED practice refuses with PRACTICE_NOT_BOOKABLE -- at a time the mode allows, so the two cannot be confused",
    !suspended.ok && (suspended as any).code === "PRACTICE_NOT_BOOKABLE",
    suspended.ok ? "it booked" : `${(suspended as any).code}: ${(suspended as any).message}`);
  await admin.from("practice_workspace").update({ status: liveStatus }).eq("id", ws);

  const restored = await bookAsPatient(T_OPEN_B);
  ok("3a-control. ⚠ AND THE SAME BOOKING SUCCEEDS ONCE THE PRACTICE IS RESTORED -- so 3a is the lifecycle state and 2a is not",
    restored.ok, restored.ok ? "" : `${(restored as any).code}: ${(restored as any).message}`);

  // The per-session walk-in limit, in the SAME internal session, at an hour inside it. bookAppointment
  // names no channel, so the mode check does not run for it -- which is also the point.
  const walkIn = await bookAppointment(admin, {
    workspaceId: ws, patientName: "Arrived Unannounced", appointmentType: "walk_in",
    scheduledAt: T_INTERNAL_E, locationId: locId, actorId: OWNER, correlationId: CORR,
  });
  ok("3b. the SAME session at the SAME hour refuses a walk-in with SESSION_WALK_IN_LIMIT -- a different rule, a different code, and it names walk-ins rather than booking modes",
    !walkIn.ok && (walkIn as any).code === "SESSION_WALK_IN_LIMIT"
    && /walk-in/i.test((walkIn as any).message),
    walkIn.ok ? "it booked" : `${(walkIn as any).code}: ${(walkIn as any).message}`);

  ok("3c. ⚠ THREE DISTINCT CODES FOR THREE DISTINCT RULES, each provoked for real rather than asserted as a list of strings",
    new Set([
      (patientIntoInternal as any).code, (suspended as any).code, (walkIn as any).code,
    ]).size === 3,
    JSON.stringify([(patientIntoInternal as any).code, (suspended as any).code, (walkIn as any).code]));

  // ══ 4. AN OVERRIDE OF THE NOTICE PERIOD IS NOT AN OVERRIDE OF WHO MAY BOOK ════════════════════
  section("4. The s14 window override does not lift it");

  const noticeRule = await saveBookingRule(admin, ctx, {
    name: "A week's notice", status: "active", priority: 90,
    channel: "patient_self", locationId: locId, leadTimeMinutes: 7 * 24 * 60, bookingHorizonDays: 365,
    actorId: OWNER, correlationId: CORR,
  });
  ok("4-control-a. a rule needing a week's notice is in force, against times three days out -- so there IS a window refusal for an override to lift",
    noticeRule.ok, noticeRule.ok ? "" : (noticeRule as any).message);

  // ⚠ THE OVERRIDE IS EXERCISED BY SOMEBODY WHO ACTUALLY HOLDS practice.settings.manage, on the patient
  // channel, with a real patient session. A patient's own context could never reach the override branch
  // at all (practice-patient-intake-harness proves that separately), so using one here would make 4a pass
  // for the wrong reason -- the override would be refused before the mode was ever consulted.
  const overridePair = await freshPair(ws);
  const overrideIntoOpen = await bookUnderRules(admin, ctx, {
    channel: "patient_self", patientName: "Seen Sooner", appointmentType: "new_consultation",
    scheduledAt: T_OPEN_C, locationId: locId,
    intake: { given_name: "Seen", family_name: "Sooner" },
    patientSessionToken: overridePair.token, patientContact: overridePair.phone,
    override: { reason: "clinically urgent, agreed by telephone" },
    actorId: OWNER, correlationId: CORR_OVERRIDE,
  });
  ok("4-control-b. ⚠ THE OVERRIDE GENUINELY LIFTS THE NOTICE PERIOD in the open session -- without this, 4a would be a refusal by a window that was never lifted",
    overrideIntoOpen.ok && (overrideIntoOpen as any).data?.overridden?.includes("LEAD_TIME"),
    overrideIntoOpen.ok ? JSON.stringify((overrideIntoOpen as any).data.overridden) : `${(overrideIntoOpen as any).code}: ${(overrideIntoOpen as any).message}`);

  const overridePair2 = await freshPair(ws);
  const overrideIntoInternal = await bookUnderRules(admin, ctx, {
    channel: "patient_self", patientName: "Seen Sooner Still", appointmentType: "new_consultation",
    scheduledAt: T_INTERNAL_F, locationId: locId,
    intake: { given_name: "Seen", family_name: "Sooner Still" },
    patientSessionToken: overridePair2.token, patientContact: overridePair2.phone,
    override: { reason: "clinically urgent, agreed by telephone" },
    actorId: OWNER, correlationId: CORR_OVERRIDE,
  });
  ok("4a. ⚠ THE SAME OVERRIDE, AT THE SAME NOTICE, IN THE INTERNAL SESSION IS STILL REFUSED ON THE MODE -- s14 lifts a notice period and never lifts who may book",
    !overrideIntoInternal.ok && (overrideIntoInternal as any).code === "SESSION_NOT_PATIENT_BOOKABLE",
    overrideIntoInternal.ok ? "the override let it through" : `${(overrideIntoInternal as any).code}: ${(overrideIntoInternal as any).message}`);
  // ⚠ THERE IS NO "and it was not LEAD_TIME" ASSERTION HERE, DELIBERATELY. 4a already names the code, so
  // a second assertion saying it is not a different code would red alongside it on every break and prove
  // nothing on its own -- and a break that reds two assertions cannot tell you which claim it broke.

  const { count: overrideRecords } = await admin.from("practice_audit_event")
    .select("*", { count: "exact", head: true })
    .eq("event_type", "practice.booking_rule_overridden").eq("correlation_id", CORR_OVERRIDE);
  ok("4b. ⚠ AND BOTH OVERRIDES WERE RECORDED BEFORE THE BOOKING WAS ATTEMPTED, so the refused one leaves an audit row describing an override that produced nothing. Stated rather than hidden: it is the same consequence DOUBLE_BOOKED and SESSION_WALK_IN_LIMIT already have",
    (overrideRecords ?? 0) === 2, String(overrideRecords));

  // ⚠ PAUSED, NOT DELETED, AND THAT IS A FINDING RATHER THAN A PREFERENCE. 4-control-b's booking carries
  // this rule's id and version (AC-13), and deleting the row nulls applied_rule_id while leaving
  // applied_rule_version -- which practice_appointment_applied_rule_complete refuses outright. A rule
  // that has decided a booking cannot be deleted, which is exactly what `paused` is for.
  //
  // ⚠ AND IT GOES THROUGH THE ENGINE, not a raw update of `status`. resolveBookingRule reads the legacy
  // `active` flag, and saveBookingRule is what keeps the two in step since migration 245 -- a status
  // written by hand would leave the rule still refusing everything within a week, and section 5 would
  // then measure a notice period and call it a booking mode.
  const pausedNotice = noticeRule.ok
    ? await saveBookingRule(admin, ctx, {
      ruleId: noticeRule.data.id, status: "paused", actorId: OWNER, correlationId: CORR,
    })
    : { ok: false as const, code: "NOT_CREATED", message: "the rule was never created", status: 500 };
  const { data: noticeNow } = await admin.from("practice_booking_rule")
    .select("status, active").eq("id", noticeRule.ok ? noticeRule.data.id : "").maybeSingle();
  ok("4c-control. the notice rule is out of force, read back rather than assumed -- both its status and the legacy flag resolveBookingRule actually reads",
    pausedNotice.ok && noticeNow?.status === "paused" && noticeNow?.active === false,
    JSON.stringify({ saved: pausedNotice.ok ? "ok" : (pausedNotice as any).message, row: noticeNow }));

  // ══ 5. ⚠ A LIMITATION ASSERTED RATHER THAN HIDDEN ════════════════════════════════════════════
  //
  // A time NO session governs is not refused by the mode check, and it must not be: a one-off extra
  // session and a stretch of extended hours carry no template, and bookableSlots offers those under the
  // booking page's own visible types. Refusing ungoverned time here would close the extra Saturday a
  // practice opened by hand.
  //
  // The consequence is real and belongs on the screen rather than in a comment: a request naming a time
  // outside every session is not stopped by this rule. It is not OFFERED -- there is no slot, so
  // bookableSlots returns nothing there -- and closing it properly would mean a separate rule saying a
  // patient may only book inside a session at all, which is not a rule anybody has written.
  section("5. What this rule does not do");

  const { data: ungovernedSlot } = await admin.from("practice_availability_slot")
    .select("id").eq("workspace_id", ws)
    .lte("starts_at", T_UNGOVERNED).gt("ends_at", T_UNGOVERNED).maybeSingle();
  ok("5-control. no slot covers 20:00, so nothing offers that time -- which is what makes 5a a statement about the ENGINE rather than about the page",
    !ungovernedSlot, JSON.stringify(ungovernedSlot));

  const ungoverned = await bookAsPatient(T_UNGOVERNED);
  ok("5a. ⚠ A TIME NO SESSION GOVERNS IS NOT REFUSED BY THE MODE CHECK. Asserted so the gap shows up on every run instead of being found by the first practice that meets it -- if this starts refusing, a rule about booking outside a session has been added and this assertion must be turned round",
    ungoverned.ok,
    ungoverned.ok ? "" : `it refused with ${(ungoverned as any).code}: ${(ungoverned as any).message}`);

  const stillOffered = await bookableSlots(admin, { handle: HANDLE, appointmentType: "new_consultation", ...window() });
  ok("5b. and the offering read still shows only patient-facing times after everything above -- the filter is not something one test left switched off",
    stillOffered.ok && !stillOffered.data.slots.some(s => internalSlotIds.has(s.sourceSlotId)),
    stillOffered.ok ? String(stillOffered.data.slots.length) : (stillOffered as any).message);

  ok("5c-control. and 5b is not vacuous -- times are still on offer at this point in the run",
    stillOffered.ok && stillOffered.data.slots.length > 0,
    stillOffered.ok ? String(stillOffered.data.slots.length) : "");

  await cleanup();
  report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`   FAILED: ${f}`); process.exit(1); }
  console.log("");
}

// ⚠ TEARDOWN ON A KILL, NOT ONLY ON A THROW. The catch below covers a run that FAILS; it does not
// cover one that is KILLED, which in this environment is the ordinary case -- a command timeout, an
// agent watchdog, a stopped task. Six abandoned Practice workspaces accumulated that way and the
// landlord Mission Control counted every one of them as a real practice. Best effort: SIGKILL cannot
// be caught, and scripts/estate-hygiene-harness.ts is the backstop for what still gets through.
cleanupOnKill(cleanup);
main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
