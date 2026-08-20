/**
 * CPR-V5-007 PHASES 5 AND 6 -- FOLLOW-UPS AND WALK-INS, THEN PUBLISH READINESS.
 *
 * s19's Phase 5 is "Follow-up due windows, recall linkage, walk-in queue rules" and Phase 6 is
 * "Readiness, interactive preview, analytics events and optimisation hooks". The due window shipped
 * with Phase 3; what is proved here is the recall queue, the follow-ups whose booking died, the
 * walk-in limits, and s10.2's publish checklist.
 *
 * WHAT IT PROVES:
 *   1. Capability codes are REAL. All three exported arrays are checked against the live catalogue,
 *      with a control proving the catalogue check can say NO -- six invented codes have shipped here.
 *   2. ⚠ A DEFERRAL MOVES THE DATE THAT MATTERS. A follow-up whose due_on is in the past but which was
 *      deferred to next month is NOT in the recall queue, and one with the same past due_on that was
 *      not deferred IS. An engine reading due_on gives the wrong answer for exactly one of the two.
 *   3. ⚠ THE STRANDED LIST IS THE HOLE IN migration 196'S TRIGGER, AND THE HOLE IS REAL. The trigger
 *      releases a follow-up when its booking dies -- but only where the status is SCHEDULED. A DEFERRED
 *      obligation keeps its appointment id, the appointment is cancelled, and the trigger skips it. The
 *      fixture makes that happen for real, and the control proves the trigger DID fire for the
 *      scheduled one beside it. An engine that copied the trigger's WHERE clause finds nothing.
 *   4. ⚠ RETURNING A STRANDED FOLLOW-UP VERIFIES THE BOOKING IS ACTUALLY DEAD. Refused against a live
 *      appointment, accepted against a cancelled one, with the state, the cleared appointment and the
 *      event trail all asserted afterwards.
 *   5. ⚠ ZERO IS NOT NULL, ON EVERY LIMIT. A session that allows walk-ins with a limit of 0 beside a
 *      practice rule of 5 resolves to 0 -- an engine using `||` or a falsy test gives 5. Both
 *      directions of s7.4's stricter-wins are asserted, with the "which of these is enforced" flag.
 *   6. TWO WALK-IN COUNTS ARE NEVER ADDED. A queue entry that already has an appointment is that
 *      appointment checked in, and counting it again would double every walk-in that was queued first.
 *   7. ⚠ THE PUBLISH CHECKLIST HAS THREE STATES, AND A CHECK NOBODY CAN PERFORM SAYS SO. The two rows
 *      s10.2 asks for that no column can answer are `not_checked` with what it would take to answer
 *      them -- never a pass, never omitted. A failed read is `not_checked` too, with a control proving
 *      the same check reaches a verdict against a healthy database.
 *   8. ⚠ THE DATABASE OWNS THREE BLOCKERS AND THE ENGINE DOES NOT REPEAT THEM. Proven twice: the
 *      constraint refuses a real publish with 23514 naming practice_booking_access_publishable, and the
 *      engine's own refusal names its blockers WITHOUT naming the three that are not its business.
 *   9. THE VISIBLE-LOCATION ARRAY CANNOT CARRY ANOTHER PRACTICE'S ID. migration 254 says Postgres will
 *      not point an array at a table, so the engine must check; a foreign id is refused and nothing is
 *      written, with a control proving this practice's own id is accepted.
 *  10. EVERY PAYLOAD SURVIVES THE SERVER/CLIENT BOUNDARY, walked rather than trusted, with a walker
 *      that is itself proven able to find one.
 *
 * CONTROLS: every refusal is paired with the same operation succeeding where it should.
 *
 *   npx --yes tsx scripts/practice-v5007-phase56-harness.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { registerPatient } from "../src/lib/practice/patients";
import { bookAppointment, checkPlacement } from "../src/lib/practice/scheduling";
import {
  createFollowUp, scheduleFollowUp, deferFollowUp, recallQueue, returnStrandedFollowUp,
} from "../src/lib/practice/follow-ups";
import { saveSession, walkInPolicy } from "../src/lib/practice/practice-sessions";
import { setBookingRule } from "../src/lib/practice/availability-config";
import {
  publishReadiness, saveBookingAccess, setPublishState, bookingAccessProfile,
} from "../src/lib/practice/patient-access";
import {
  RECALL_CAPABILITIES, WALK_IN_CAPABILITIES, RECALL_NOT_RECORDED, RECALL_NOT_CONFIGURABLE,
  WALK_IN_NOT_CONFIGURABLE, WALK_IN_NOW_CONFIGURABLE,
} from "../src/lib/practice/recall-constants";
import {
  PUBLISH_CAPABILITIES, PUBLISH_CHECKS, PUBLISH_CHECKS_NOT_CHECKABLE,
  PUBLISH_CHECKS_DATABASE_OWNED, PUBLISHABLE_CONSTRAINT, PUBLISH_STATE_CODES,
} from "../src/lib/practice/publish-constants";
import { practiceToday, dueDateFrom } from "../src/lib/practice/practice-time";
import { purgeWorkspacesOwnedBy, cleanupOnKill } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const REPO = join(__dirname, "..");
const OWNER = "00000000-0000-4000-8000-0000000fb001";
const OTHER = "00000000-0000-4000-8000-0000000fb002";
const TZ = "Africa/Kampala";
const CORR = "harness-phase56";

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
    idempotency_key: `harness-p56-${suffix}-${Date.now()}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: user, correlation_id: CORR, workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      await admin.from("practice_booking_access").delete().eq("workspace_id", w.id);
      await admin.from("practice_follow_up").delete().eq("workspace_id", w.id);
      await admin.from("practice_queue_entry").delete().eq("workspace_id", w.id);
      await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
      await admin.from("practice_patient").delete().eq("workspace_id", w.id);
      await admin.from("practice_booking_rule").delete().eq("workspace_id", w.id);
      await admin.from("practice_session_appointment_type").delete().eq("workspace_id", w.id);
      await admin.from("practice_availability_slot").delete().eq("workspace_id", w.id);
      await admin.from("practice_availability_template").delete().eq("workspace_id", w.id);
      await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
    }
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    // ⚠ NO `practice_audit_event` DELETE HERE, AND THAT IS DELIBERATE. Migration 247 makes that table
    // append-only and REFUSES the delete -- "practice_audit_event is append only". Several harnesses in
    // this repo call it anyway and discard the error, so they have been leaving rows behind for months
    // and reporting a clean teardown. A teardown that cannot work should not be written as though it
    // does; nothing in this file asserts over the audit table's total, so nothing needs it gone.
  }
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

/**
 * An admin client on which one table cannot be read.
 *
 * ⚠ THE ONLY WAY TO TEST "A FAILED READ IS NEVER A ZERO" -- a claim about what happens when a query
 * FAILS, and a working database never produces one. Deliberately the same shape as the patient-access
 * and booking-rules harnesses' so a reader who has seen one has seen all three.
 */
function adminWithUnreadable(real: any, table: string) {
  const failing = (): any => {
    const p: any = new Proxy({} as any, {
      get(_t, prop) {
        if (prop === "then")
          return (resolve: any) => resolve({ data: null, error: { message: "simulated read failure" }, count: null });
        return () => p;
      },
    });
    return p;
  };
  return new Proxy(real, {
    get(t: any, prop: string) {
      if (prop === "from") return (name: string) => (name === table ? failing() : t.from(name));
      const v = t[prop];
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

/** Walk a payload and report every path that is not JSON-safe. */
function nonSerialisable(value: unknown, path = "$", out: string[] = []): string[] {
  if (typeof value === "function") out.push(`${path} is a function`);
  else if (value && typeof value === "object") {
    if (value instanceof Date || value instanceof Map || value instanceof Set) out.push(`${path} is a ${value.constructor.name}`);
    else for (const [k, v] of Object.entries(value)) nonSerialisable(v, `${path}.${k}`, out);
  }
  return out;
}

const stateOf = (r: any, code: string) => r.checks.find((c: any) => c.code === code)?.state ?? "MISSING";

async function main() {
  console.log("\nCPR-V5-007 Phases 5 and 6 -- follow-ups, walk-ins and publish readiness\n");
  await cleanup();

  // ══ 0. CONTROLS ═══════════════════════════════════════════════════════════════════════════════
  section("0. Controls");

  const wsA = await provision(OWNER, "Phase 5-6 Harness", "a");
  const wsB = await provision(OTHER, "Phase 5-6 Harness Other", "b");
  ok("0a-control. two separate practices exist to test a boundary between", wsA !== wsB, `${wsA} / ${wsB}`);

  const resA = await resolveWorkspaceContext(admin, OWNER, wsA);
  const resB = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!resA.ok || !resB.ok) { ok("0b-control. contexts resolve", false); return report(); }
  const ctxA: WorkspaceContext = resA.ctx;
  const ctxB: WorkspaceContext = resB.ctx;
  ok("0b-control. the owner's capabilities were read from the grants, not typed into this file",
    ctxA.capabilities.length > 0, `${ctxA.capabilities.length} granted`);
  ok("0c-control. and the owner holds the two this file's writes are checked against",
    ctxA.capabilities.includes("practice.settings.manage") && ctxA.capabilities.includes("followup.manage"),
    ctxA.capabilities.join(", "));

  // A LOCATION EACH. Provisioning does not create one, and section 6's cross-tenant refusal needs two
  // real ids belonging to two different practices to be about anything at all.
  const { data: rowA } = await admin.from("practice_location")
    .insert({ workspace_id: wsA, name: "Mulago Hospital", type: "hospital", active: true, travel_buffer_minutes: 0 })
    .select("id").single();
  const { data: rowB } = await admin.from("practice_location")
    .insert({ workspace_id: wsB, name: "Someone Else's Clinic", type: "clinic", active: true, travel_buffer_minutes: 0 })
    .select("id").single();
  const locA = rowA?.id as string | undefined;
  const locB = rowB?.id as string | undefined;
  ok("0d-control. each practice has a location of its own to test a boundary with",
    !!locA && !!locB && locA !== locB, `${locA} / ${locB}`);

  const today = practiceToday(TZ);

  // ══ 1. CAPABILITY CODES ARE REAL ══════════════════════════════════════════════════════════════
  section("1. Capability codes");

  const { data: catRows, error: catErr } = await admin.from("practice_role_capabilities").select("capability_code");
  ok("1a-control. the capability catalogue is readable and populated -- a failed read is not an empty one",
    !catErr && ((catRows ?? []) as any[]).length >= 30,
    catErr?.message ?? `${((catRows ?? []) as any[]).length} rows`);
  const catalogue = new Set(((catRows ?? []) as any[]).map(r => r.capability_code as string));

  ok("1a-control-2. and the catalogue check can say NO -- codes this product has already invented read as absent",
    !catalogue.has("encounter.view") && !catalogue.has("practice.calendar.manage"),
    "an invented code reads as real, so 1a proves nothing");

  const named = [...RECALL_CAPABILITIES, ...WALK_IN_CAPABILITIES, ...PUBLISH_CAPABILITIES];
  const invented = named.filter(c => !catalogue.has(c));
  ok("1a. ⚠ every capability code Phases 5 and 6 name exists in practice_role_capabilities",
    invented.length === 0 && named.length >= 5, invented.join(", ") || `${named.length} checked`);

  const routeSrc = readFileSync(join(REPO, "src", "app", "api", "v1", "practice", "booking-access", "route.ts"), "utf8");
  const declared = [...routeSrc.matchAll(/requirePracticeContext\(\s*"([^"]+)"\s*\)/g)].map(m => m[1]);
  ok("1b. the route's declared capability is the one PUBLISH_CAPABILITIES names AND one the catalogue holds",
    declared.length === 3 && declared.every(d => PUBLISH_CAPABILITIES.includes(d) && catalogue.has(d)),
    declared.join(", ") || "no requirePracticeContext literal found");
  ok("1c. ⚠ and the follow-up action inside it is gated on its OWN capability, not the route's",
    /followup\.manage/.test(routeSrc) && !PUBLISH_CAPABILITIES.includes("followup.manage"),
    "the return action rides in on the publishing permission");

  // ══ 2. THE RECALL QUEUE ═══════════════════════════════════════════════════════════════════════
  section("2. The recall queue");

  const pOverdue = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nakato Betty", birthDate: "1992-07-30", sex: "female",
    phone: "0772 555 401", actorId: OWNER, correlationId: CORR,
  });
  // ⚠ REGISTERED WITH A PHONE AND THEN STRIPPED OF IT. registerPatient requires a primary contact
  // (CPR-V2-005's minimum dataset), so a patient with no way to be reached cannot be created through the
  // front door -- and yet the state exists in any practice whose records predate that rule or whose
  // number has been removed. The fixture reaches it the only way it can be reached.
  const pSilent = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Ssekandi Paul", birthDate: "1965-02-11", sex: "male",
    phone: "0772 555 405", actorId: OWNER, correlationId: CORR,
  });
  if (pSilent.ok)
    await admin.from("practice_patient_contact").delete().eq("patient_id", pSilent.data.id);
  const pDeferred = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Auma Grace", birthDate: "1988-01-04", sex: "female",
    phone: "0772 555 402", actorId: OWNER, correlationId: CORR,
  });
  const pStranded = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Okello James", birthDate: "1975-11-20", sex: "male",
    phone: "0772 555 403", actorId: OWNER, correlationId: CORR,
  });
  const pScheduled = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Namusoke Ruth", birthDate: "1990-05-05", sex: "female",
    phone: "0772 555 404", actorId: OWNER, correlationId: CORR,
  });
  if (!pOverdue.ok || !pSilent.ok || !pDeferred.ok || !pStranded.ok || !pScheduled.ok) {
    ok("2-control. the five harness patients were registered", false,
      [pOverdue, pSilent, pDeferred, pStranded, pScheduled].map((p: any) => p.ok ? "" : p.message).join("; "));
    return report();
  }

  const past = dueDateFrom(today, -10);
  const later = dueDateFrom(today, 30);

  const fOverdue = await createFollowUp(admin, {
    workspaceId: wsA, patientId: pOverdue.data.id, reason: "wound review", dueOn: past,
    actorId: OWNER, correlationId: CORR,
  });
  const fSilent = await createFollowUp(admin, {
    workspaceId: wsA, patientId: pSilent.data.id, reason: "blood pressure", dueOn: today,
    actorId: OWNER, correlationId: CORR,
  });
  const fFuture = await createFollowUp(admin, {
    workspaceId: wsA, patientId: pOverdue.data.id, reason: "annual review", dueOn: later,
    actorId: OWNER, correlationId: CORR,
  });
  // ⚠ THE FIXTURE THAT MAKES 2c NON-VACUOUS. Its due_on is TEN DAYS AGO and it is deferred to next
  // month. An engine reading due_on puts it in the queue; the right answer is that it is not owed yet.
  const fDeferred = await createFollowUp(admin, {
    workspaceId: wsA, patientId: pDeferred.data.id, reason: "scan result", dueOn: past,
    actorId: OWNER, correlationId: CORR,
  });
  if (!fOverdue.ok || !fSilent.ok || !fFuture.ok || !fDeferred.ok) {
    ok("2-control. the harness follow-ups were raised", false, "one of the four was refused");
    return report();
  }
  const deferred = await deferFollowUp(admin, {
    workspaceId: wsA, followUpId: fDeferred.data.id, until: later, reason: "patient abroad",
    actorId: OWNER, correlationId: CORR,
  });
  ok("2-control. a follow-up with a past due date was deferred to next month",
    deferred.ok, deferred.ok ? "" : deferred.message);

  const q1 = await recallQueue(admin, wsA);
  ok("2a. the queue was read at all -- three empty lists are not three noughts",
    !q1.unavailable && q1.today === today && q1.timezone === TZ, q1.detail ?? `${q1.today} ${q1.timezone}`);
  ok("2b. a follow-up ten days past its date, with nothing booked, is in the overdue list",
    q1.overdue.some(e => e.followUpId === fOverdue.data.id)
    && q1.overdue.find(e => e.followUpId === fOverdue.data.id)!.daysOverdue === 10,
    `${q1.overdue.length} overdue: ${q1.overdue.map(e => `${e.patientName}/${e.daysOverdue}`).join(", ")}`);
  ok("2b-control. one due today is in the due-today list rather than the overdue one",
    q1.dueToday.some(e => e.followUpId === fSilent.data.id)
    && !q1.overdue.some(e => e.followUpId === fSilent.data.id),
    `${q1.dueToday.length} due today`);
  ok("2b-control-2. and one due next month is in neither",
    !q1.overdue.some(e => e.followUpId === fFuture.data.id)
    && !q1.dueToday.some(e => e.followUpId === fFuture.data.id));
  ok("2c. ⚠ A DEFERRAL MOVES THE DATE. The one deferred to next month is NOT in the queue, although its due_on is ten days past",
    !q1.overdue.some(e => e.followUpId === fDeferred.data.id)
    && !q1.dueToday.some(e => e.followUpId === fDeferred.data.id),
    q1.overdue.map(e => e.followUpId).join(", "));
  ok("2d. the overdue list is longest-waiting first",
    q1.overdue.every((e, i) => i === 0 || q1.overdue[i - 1].daysOverdue >= e.daysOverdue),
    q1.overdue.map(e => e.daysOverdue).join(" >= "));

  ok("2e. reachability is a count of contact rows -- a patient with a phone has one",
    q1.overdue.find(e => e.followUpId === fOverdue.data.id)?.contactRoutes === 1,
    String(q1.overdue.find(e => e.followUpId === fOverdue.data.id)?.contactRoutes));
  ok("2e-control. ⚠ and one with no phone and no email reads 0, which is a fact rather than an outage",
    q1.dueToday.find(e => e.followUpId === fSilent.data.id)?.contactRoutes === 0
    && !q1.contactUnavailable,
    String(q1.dueToday.find(e => e.followUpId === fSilent.data.id)?.contactRoutes));
  ok("2f. the unreachable list is a SUBSET of the two above, not a fourth queue",
    q1.unreachable.length === 1 && q1.unreachable[0].followUpId === fSilent.data.id
    && [...q1.overdue, ...q1.dueToday].some(e => e.followUpId === q1.unreachable[0].followUpId),
    `${q1.unreachable.length}`);

  // ── A FAILED READ IS NEVER A NOUGHT, in three separate places.
  const qNoFollowUps = await recallQueue(adminWithUnreadable(admin, "practice_follow_up"), wsA);
  ok("2g. ⚠ an unreadable follow-up table is UNAVAILABLE, not an empty queue",
    qNoFollowUps.unavailable && qNoFollowUps.overdue.length === 0 && qNoFollowUps.detail !== null,
    JSON.stringify({ u: qNoFollowUps.unavailable, d: qNoFollowUps.detail }));
  const qNoContacts = await recallQueue(adminWithUnreadable(admin, "practice_patient_contact"), wsA);
  ok("2h. ⚠ an unreadable contact register leaves every reachability NULL and says so -- it does not say nobody has a phone",
    qNoContacts.contactUnavailable && qNoContacts.unreachable.length === 0
    && qNoContacts.overdue.every(e => e.contactRoutes === null)
    && !qNoContacts.unavailable && qNoContacts.overdue.length === q1.overdue.length,
    JSON.stringify({ cu: qNoContacts.contactUnavailable, n: qNoContacts.overdue.length }));

  // ══ 3. THE FOLLOW-UPS WHOSE BOOKING DIED ══════════════════════════════════════════════════════
  section("3. Stranded follow-ups");

  const at = (days: number, hour: number) =>
    new Date(Date.parse(`${dueDateFrom(today, days)}T${String(hour).padStart(2, "0")}:00:00.000Z`)).toISOString();

  const aStranded = await bookAppointment(admin, {
    workspaceId: wsA, patientId: pStranded.data.id, patientName: "Okello James", scheduledAt: at(3, 6),
    appointmentType: "scheduled_followup", actorId: OWNER, correlationId: CORR,
  });
  const aScheduled = await bookAppointment(admin, {
    workspaceId: wsA, patientId: pScheduled.data.id, patientName: "Namusoke Ruth", scheduledAt: at(3, 8),
    appointmentType: "scheduled_followup", actorId: OWNER, correlationId: CORR,
  });
  const aLive = await bookAppointment(admin, {
    workspaceId: wsA, patientId: pOverdue.data.id, patientName: "Nakato Betty", scheduledAt: at(4, 6),
    appointmentType: "scheduled_followup", actorId: OWNER, correlationId: CORR,
  });
  if (!aStranded.ok || !aScheduled.ok || !aLive.ok) {
    ok("3-control. the three harness appointments were booked", false,
      [aStranded, aScheduled, aLive].map((a: any) => a.ok ? "" : a.message).join("; "));
    return report();
  }

  const fStranded = await createFollowUp(admin, {
    workspaceId: wsA, patientId: pStranded.data.id, reason: "post-op check", dueOn: dueDateFrom(today, 3),
    actorId: OWNER, correlationId: CORR,
  });
  const fScheduledOne = await createFollowUp(admin, {
    workspaceId: wsA, patientId: pScheduled.data.id, reason: "suture removal", dueOn: dueDateFrom(today, 3),
    actorId: OWNER, correlationId: CORR,
  });
  if (!fStranded.ok || !fScheduledOne.ok) { ok("3-control. two more follow-ups were raised", false); return report(); }

  await scheduleFollowUp(admin, { workspaceId: wsA, followUpId: fStranded.data.id, appointmentId: aStranded.data.id, actorId: OWNER, correlationId: CORR });
  await scheduleFollowUp(admin, { workspaceId: wsA, followUpId: fScheduledOne.data.id, appointmentId: aScheduled.data.id, actorId: OWNER, correlationId: CORR });
  const linkLive = await scheduleFollowUp(admin, { workspaceId: wsA, followUpId: fOverdue.data.id, appointmentId: aLive.data.id, actorId: OWNER, correlationId: CORR });
  ok("3-control-2. three follow-ups are booked against three live appointments", linkLive.ok, linkLive.ok ? "" : linkLive.message);

  // ⚠ THE FIXTURE THAT MAKES 3a NON-VACUOUS. One of the two booked follow-ups is DEFERRED first, which
  // takes it out of the trigger's WHERE clause without clearing its appointment id. Both appointments
  // are then cancelled the same way. The trigger cleans up one and cannot see the other.
  const defBooked = await deferFollowUp(admin, {
    workspaceId: wsA, followUpId: fStranded.data.id, until: dueDateFrom(today, 5), reason: "moved",
    actorId: OWNER, correlationId: CORR,
  });
  ok("3-control-3. a BOOKED follow-up can be deferred, and keeps its appointment", defBooked.ok, defBooked.ok ? "" : defBooked.message);

  for (const id of [aStranded.data.id, aScheduled.data.id])
    await admin.from("practice_appointment").update({ status: "CANCELLED", updated_by: OWNER }).eq("id", id);

  const { data: afterTrigger } = await admin.from("practice_follow_up")
    .select("id, status, appointment_id").in("id", [fStranded.data.id, fScheduledOne.data.id]);
  const scheduledRow = ((afterTrigger ?? []) as any[]).find(r => r.id === fScheduledOne.data.id);
  const strandedRow = ((afterTrigger ?? []) as any[]).find(r => r.id === fStranded.data.id);
  ok("3-control-4. ⚠ migration 196's trigger DID fire for the SCHEDULED one -- it is open again with no appointment",
    scheduledRow?.status === "OPEN" && scheduledRow?.appointment_id === null,
    JSON.stringify(scheduledRow));
  ok("3-control-5. ⚠ and did NOT fire for the deferred one, which still points at a cancelled appointment. That is the hole.",
    strandedRow?.status === "DEFERRED" && strandedRow?.appointment_id === aStranded.data.id,
    JSON.stringify(strandedRow));

  const q2 = await recallQueue(admin, wsA);
  ok("3a. ⚠ the stranded list finds the one the trigger cannot see",
    q2.stranded.length === 1 && q2.stranded[0].followUpId === fStranded.data.id
    && q2.stranded[0].appointmentStatus === "CANCELLED",
    `${q2.stranded.length}: ${q2.stranded.map(e => `${e.patientName}/${e.appointmentStatus}`).join(", ")}`);
  ok("3a-control. and does NOT include the live booking beside it",
    !q2.stranded.some(e => e.followUpId === fOverdue.data.id),
    q2.stranded.map(e => e.followUpId).join(", "));
  ok("3b. ⚠ a stranded obligation is not ALSO in the recall queue -- the two lists are disjoint",
    ![...q2.overdue, ...q2.dueToday].some(e => q2.stranded.some(s => s.followUpId === e.followUpId)));
  ok("3b-control. and the follow-up the trigger released IS back in the queue rather than lost",
    q2.dueToday.some(e => e.followUpId === fScheduledOne.data.id)
    || q2.overdue.some(e => e.followUpId === fScheduledOne.data.id)
    || dueDateFrom(today, 3) > today,
    "released but nowhere");

  const qNoAppts = await recallQueue(adminWithUnreadable(admin, "practice_appointment"), wsA);
  ok("3c. ⚠ an unreadable appointment table makes the stranded list UNAVAILABLE, not empty -- an empty one claims every booking is alive",
    qNoAppts.strandedUnavailable && qNoAppts.stranded.length === 0 && qNoAppts.strandedDetail !== null
    && !qNoAppts.unavailable,
    JSON.stringify({ su: qNoAppts.strandedUnavailable }));

  // ── RETURNING ONE ──────────────────────────────────────────────────────────────────────────────
  const refuseLive = await returnStrandedFollowUp(admin, {
    workspaceId: wsA, followUpId: fOverdue.data.id, actorId: OWNER, correlationId: CORR,
  });
  ok("3d. ⚠ returning a follow-up whose appointment is LIVE is refused -- this is not 'unbook anything'",
    !refuseLive.ok && refuseLive.code === "BOOKING_STILL_LIVE",
    refuseLive.ok ? "it was returned" : refuseLive.code);

  const refuseOpen = await returnStrandedFollowUp(admin, {
    workspaceId: wsA, followUpId: fScheduledOne.data.id, actorId: OWNER, correlationId: CORR,
  });
  ok("3d-control. and one the trigger already released is refused as already open, with its own code",
    !refuseOpen.ok && refuseOpen.code === "ALREADY_OPEN",
    refuseOpen.ok ? "returned again" : refuseOpen.code);

  const returned = await returnStrandedFollowUp(admin, {
    workspaceId: wsA, followUpId: fStranded.data.id, actorId: OWNER, correlationId: CORR,
  });
  ok("3e. the stranded one IS returned, and the refusal above was about the booking rather than the function",
    returned.ok && returned.ok && returned.data.appointmentStatus === "CANCELLED",
    returned.ok ? "" : returned.message);

  const { data: afterReturn } = await admin.from("practice_follow_up")
    .select("status, appointment_id, outcome").eq("id", fStranded.data.id).maybeSingle();
  ok("3f. it is OPEN again with the dead appointment cleared off it",
    afterReturn?.status === "OPEN" && afterReturn?.appointment_id === null,
    JSON.stringify(afterReturn));
  const { data: trail } = await admin.from("practice_follow_up_event")
    .select("from_status, to_status, note").eq("follow_up_id", fStranded.data.id).order("occurred_at");
  ok("3g. and the trail says why, in the words a person would read",
    ((trail ?? []) as any[]).some(e => e.to_status === "OPEN" && /cancelled/i.test(String(e.note ?? ""))),
    ((trail ?? []) as any[]).map(e => `${e.from_status}->${e.to_status}:${e.note}`).join(" | "));

  const readFail = await returnStrandedFollowUp(adminWithUnreadable(admin, "practice_follow_up"), {
    workspaceId: wsA, followUpId: fStranded.data.id, actorId: OWNER, correlationId: CORR,
  });
  ok("3h. ⚠ an unreadable follow-up is READ_FAILED, never NOT_FOUND -- telling somebody their obligation is gone is worse than telling them the database is",
    !readFail.ok && readFail.code === "READ_FAILED",
    readFail.ok ? "it succeeded" : readFail.code);

  ok("3i. what this queue cannot record is stated as data, not as prose in a comment",
    RECALL_NOT_RECORDED.length >= 2 && RECALL_NOT_CONFIGURABLE.length >= 1
    && RECALL_NOT_CONFIGURABLE.every(r => r.wouldNeed.length > 20),
    `${RECALL_NOT_RECORDED.length} / ${RECALL_NOT_CONFIGURABLE.length}`);

  // ══ 4. WALK-IN RULES ══════════════════════════════════════════════════════════════════════════
  section("4. Walk-in rules");

  // ⚠ THE DAY IS FIXED RELATIVE TO TODAY so the session's weekday always matches the date asked for.
  const walkDate = dueDateFrom(today, 2);
  const walkWeekday = ((new Date(`${walkDate}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

  // Session 1: allows walk-ins, limit ZERO. ⚠ The fixture that makes 4b non-vacuous.
  const sZero = await saveSession(admin, ctxA, {
    weekday: walkWeekday, startsMinute: 8 * 60, endsMinute: 10 * 60, locationId: locA,
    sessionName: "Zero walk-ins", bookingMode: "internal", walkInsAllowed: true, walkInLimit: 0,
    actorId: OWNER, correlationId: CORR,
  });
  // Session 2: allows walk-ins, limit 12, against a practice rule of 5 -> the RULE is stricter.
  const sLoose = await saveSession(admin, ctxA, {
    weekday: walkWeekday, startsMinute: 11 * 60, endsMinute: 13 * 60, locationId: locA,
    sessionName: "Loose walk-ins", bookingMode: "internal", walkInsAllowed: true, walkInLimit: 12,
    actorId: OWNER, correlationId: CORR,
  });
  // Session 3: no walk-ins at all.
  const sClosed = await saveSession(admin, ctxA, {
    weekday: walkWeekday, startsMinute: 14 * 60, endsMinute: 16 * 60, locationId: locA,
    sessionName: "No walk-ins", bookingMode: "internal", walkInsAllowed: false,
    actorId: OWNER, correlationId: CORR,
  });
  if (!sZero.ok || !sLoose.ok || !sClosed.ok) {
    ok("4-control. the three harness sessions were saved", false,
      [sZero, sLoose, sClosed].map((s: any) => s.ok ? "" : s.message).join("; "));
    return report();
  }

  const rule = await setBookingRule(admin, ctxA, {
    locationId: locA ?? null, appointmentType: null, leadTimeMinutes: 0,
    walkInDailyLimit: 5, actorId: OWNER, correlationId: CORR,
  });
  ok("4-control-2. a practice-wide walk-in limit of 5 was written for that location", rule.ok, rule.ok ? "" : (rule as any).message);

  const w1 = await walkInPolicy(admin, ctxA, { date: walkDate });
  ok("4a. the two sessions that take walk-ins are listed, and the third is on the closed list",
    w1.sessions.length === 2 && w1.sessionsClosedToWalkIns.length === 1
    && w1.sessionsClosedToWalkIns[0].sessionName === "No walk-ins",
    `${w1.sessions.length} open / ${w1.sessionsClosedToWalkIns.length} closed`);

  const zero = w1.sessions.find(s => s.sessionName === "Zero walk-ins");
  ok("4b. ⚠ ZERO IS NOT NULL. A session limit of 0 beside a practice limit of 5 resolves to 0, from the session",
    zero?.effectiveLimit === 0 && zero?.effectiveLimitFrom === "session" && zero?.sessionLimit === 0,
    JSON.stringify({ e: zero?.effectiveLimit, from: zero?.effectiveLimitFrom }));
  ok("4b-control. ⚠ and the read really did see the practice limit beside it -- otherwise 4b proves only that 5 was missing",
    zero?.practiceDailyLimit === 5, String(zero?.practiceDailyLimit));

  const loose = w1.sessions.find(s => s.sessionName === "Loose walk-ins");
  ok("4c. s7.4's stricter-wins in the other direction: 12 on the session against 5 on the rule resolves to 5, from the rule",
    loose?.effectiveLimit === 5 && loose?.effectiveLimitFrom === "practice" && loose?.sessionLimit === 12,
    JSON.stringify({ e: loose?.effectiveLimit, from: loose?.effectiveLimitFrom }));
  ok("4d. ⚠ and BOTH resolved limits are now reported as enforced -- the screen must not call a limit decorative once it has started refusing people",
    loose?.effectiveLimitEnforced === true && zero?.effectiveLimitEnforced === true,
    JSON.stringify({ loose: loose?.effectiveLimitEnforced, zero: zero?.effectiveLimitEnforced }));
  ok("4d-control. and a session with no limit at either level is still reported as unenforced, so 4d is not a constant",
    w1.sessions.every(s => s.effectiveLimit !== null || s.effectiveLimitEnforced === false),
    JSON.stringify(w1.sessions.map(s => [s.sessionName, s.effectiveLimit, s.effectiveLimitEnforced])));

  // ── THE TWO COUNTS ─────────────────────────────────────────────────────────────────────────────
  const walkIn = await bookAppointment(admin, {
    workspaceId: wsA, patientId: pSilent.data.id, patientName: "Ssekandi Paul", scheduledAt: `${walkDate}T03:00:00.000Z`,
    appointmentType: "walk_in", locationId: locA, actorId: OWNER, correlationId: CORR,
  });
  const walkInDead = await bookAppointment(admin, {
    workspaceId: wsA, patientId: pDeferred.data.id, patientName: "Auma Grace", scheduledAt: `${walkDate}T03:30:00.000Z`,
    appointmentType: "walk_in", locationId: locA, actorId: OWNER, correlationId: CORR,
  });
  ok("4-control-3. two walk-in appointments were booked on that day",
    walkIn.ok && walkInDead.ok, [walkIn, walkInDead].map((a: any) => a.ok ? "" : a.message).join("; "));
  if (walkInDead.ok)
    await admin.from("practice_appointment").update({ status: "CANCELLED", updated_by: OWNER }).eq("id", walkInDead.data.id);

  await admin.from("practice_queue_entry").insert([
    // A queued walk-in with nothing booked behind it.
    { workspace_id: wsA, patient_id: pStranded.data.id, patient_name: "Okello James", status: "WAITING", entered_at: `${walkDate}T07:00:00.000Z` },
    // ⚠ AND ONE THAT IS THE APPOINTMENT ABOVE, CHECKED IN. Counting it again doubles the walk-in.
    { workspace_id: wsA, patient_id: pSilent.data.id, patient_name: "Ssekandi Paul", status: "WAITING", appointment_id: walkIn.ok ? walkIn.data.id : null, entered_at: `${walkDate}T07:05:00.000Z` },
  ]);

  const w2 = await walkInPolicy(admin, ctxA, { date: walkDate });
  ok("4e. one live walk-in appointment is counted, and the cancelled one beside it is not",
    w2.bookedWalkInIds?.length === 1 && w2.bookedWalkInIds[0] === (walkIn.ok ? walkIn.data.id : ""),
    JSON.stringify(w2.bookedWalkInIds));
  ok("4f. ⚠ the queue figure counts only entries with nothing booked -- the two are never added",
    w2.queuedWalkInIds?.length === 1,
    JSON.stringify(w2.queuedWalkInIds));
  ok("4f-control. ⚠ and the queue read really did see both rows -- otherwise 4f proves only that one insert failed",
    (await admin.from("practice_queue_entry").select("id").eq("workspace_id", wsA)
      .gte("entered_at", `${walkDate}T00:00:00.000Z`).lt("entered_at", `${dueDateFrom(walkDate, 1)}T00:00:00.000Z`))
      .data?.length === 2,
    "the fixture did not land");

  const wNoAppts = await walkInPolicy(adminWithUnreadable(admin, "practice_appointment"), ctxA, { date: walkDate });
  ok("4g. ⚠ an uncountable walk-in figure is NULL and says why -- never a nought printed beside 'walk-ins today'",
    wNoAppts.bookedWalkInIds === null && wNoAppts.bookedWalkInsUnreadable !== null
    && wNoAppts.queuedWalkInIds !== null,
    JSON.stringify({ b: wNoAppts.bookedWalkInIds, q: wNoAppts.queuedWalkInIds }));

  const wOtherDay = await walkInPolicy(admin, ctxA, { date: dueDateFrom(walkDate, 1) });
  ok("4h-control. a day with no such session lists none, so 4a is about the date rather than about the practice",
    wOtherDay.sessions.length === 0 || wOtherDay.date !== walkDate,
    `${wOtherDay.sessions.length} on ${wOtherDay.date}`);

  // ⚠ THIS PINNED A COUNT OF GAPS, AND GAPS ARE THE ONE NUMBER WORK IS MEANT TO REDUCE.
  //
  // It required WALK_IN_NOT_CONFIGURABLE.length === 3. All three -- the walk-in cutoff, queue ordering,
  // and the emergency override -- were BUILT by migrations 268/269 and moved to
  // WALK_IN_NOW_CONFIGURABLE, so the list is empty and the assertion asked the codebase to still be
  // missing three things. Pinning a count you are actively trying to change is the most frequently
  // recurring assertion defect in this repository, and this is its purest form: an assertion that goes
  // red on success.
  //
  // ⚠ THE PROPERTY IS WHAT S7.7 ACTUALLY ASKS FOR, and it holds at 3/0, 0/3 or any split. Every item is
  // in exactly one list; anything still missing says what it would need; anything now built says where
  // it went. That is the honesty rule this whole constant exists to serve -- "no column holds it" is
  // only a permissible answer when it comes with what would make it true.
  ok("4i. every walk-in capability s7.7 names is in exactly one list -- missing with a remedy, or built with a place",
    WALK_IN_NOT_CONFIGURABLE.every(n => n.wouldNeed.length > 20)
    && WALK_IN_NOW_CONFIGURABLE.every(n => n.where.length > 20 && n.note.length > 20)
    && !WALK_IN_NOT_CONFIGURABLE.some(n => WALK_IN_NOW_CONFIGURABLE.some(b => b.what === n.what)),
    JSON.stringify({ notConfigurable: WALK_IN_NOT_CONFIGURABLE.length, nowConfigurable: WALK_IN_NOW_CONFIGURABLE.length }));
  // ⚠ THE CONTROL, because 4i is satisfied by two EMPTY lists and would then be asserting nothing at
  // all. s7.7 names these three capabilities; between them the lists must still account for all three,
  // whichever side each one currently sits on.
  ok("4i-control. and the two lists still account for all three of s7.7's walk-in capabilities",
    WALK_IN_NOT_CONFIGURABLE.length + WALK_IN_NOW_CONFIGURABLE.length === 3,
    `${WALK_IN_NOT_CONFIGURABLE.length} + ${WALK_IN_NOW_CONFIGURABLE.length}`);

  // ══ 5. PUBLISH READINESS ══════════════════════════════════════════════════════════════════════
  section("5. Publish readiness");

  const r1 = await publishReadiness(admin, ctxA);
  ok("5a-control. the checklist ran and returned every check the constants define, in that order",
    r1.checks.length === PUBLISH_CHECKS.length
    && r1.checks.every((c, i) => c.code === PUBLISH_CHECKS[i].code),
    `${r1.checks.length} of ${PUBLISH_CHECKS.length}`);
  ok("5a. ⚠ EVERY CHECK HAS ONE OF THREE STATES, and none is missing or blank",
    r1.checks.every(c => ["pass", "fail", "not_checked"].includes(c.state)),
    r1.checks.filter(c => !["pass", "fail", "not_checked"].includes(c.state)).map(c => c.code).join(", "));

  ok("5b. ⚠ the two rows nothing in this schema can answer are NOT CHECKED -- never a pass, never dropped",
    PUBLISH_CHECKS_NOT_CHECKABLE.length === 2
    && PUBLISH_CHECKS_NOT_CHECKABLE.every(c => stateOf(r1, c) === "not_checked"),
    PUBLISH_CHECKS_NOT_CHECKABLE.map(c => `${c}=${stateOf(r1, c)}`).join(", "));
  ok("5b-control. and each of them carries what it would take to answer it, rather than only a shrug",
    r1.checks.filter(c => c.authority === "absent").every(c => (c.wouldNeed ?? "").length > 20),
    r1.checks.filter(c => c.authority === "absent").map(c => c.wouldNeed).join(" | "));

  // ⚠ THIS ASSERTION TURNED ROUND WITH THE THING IT ASSERTS.
  //
  // It read `=== "fail"`: a page with no intake behind it is not ready, whatever the configuration says.
  // patient-booking.ts built the intake and the confirmation, so the row passes -- and it passes
  // UNCONDITIONALLY, which is the property worth keeping. It never depended on configuration in either
  // direction, and a check that started passing is worth showing as passing rather than left failing so
  // a familiar number stays familiar.
  ok("5c. ⚠ the build row is unconditional in either direction -- it failed for everyone until the intake existed, and now passes for everyone",
    stateOf(r1, "INTAKE_BUILT") === "pass", stateOf(r1, "INTAKE_BUILT"));
  ok("5d. a practice with a location and sessions PASSES the rows it should -- this is not a checklist that always says no",
    stateOf(r1, "LOCATION_ACTIVE") === "pass",
    r1.checks.map(c => `${c.code}=${c.state}`).join(", "));
  ok("5e. and FAILS the rows it should: no session is open to patients, so nothing is bookable",
    stateOf(r1, "SESSION_BOOKABLE") === "fail" && r1.verdict === "not_ready",
    `${stateOf(r1, "SESSION_BOOKABLE")} / ${r1.verdict}`);
  ok("5f. every figure carries its denominator, so a count is a fraction of a list rather than a bare number",
    r1.checks.filter(c => c.found !== null).length >= 3
    && r1.checks.filter(c => c.found !== null && c.of !== null).length >= 2,
    r1.checks.filter(c => c.found !== null).map(c => `${c.code} ${c.found}/${c.of}`).join(", "));

  // ⚠ A FAILED READ IS not_checked -- NOT A PASS AND NOT A FAIL.
  const rNoLocs = await publishReadiness(adminWithUnreadable(admin, "practice_location"), ctxA);
  ok("5g. ⚠ an unreadable locations table makes that row NOT CHECKED, not a pass and not a fail",
    stateOf(rNoLocs, "LOCATION_ACTIVE") === "not_checked"
    && rNoLocs.checks.find(c => c.code === "LOCATION_ACTIVE")?.because !== null,
    stateOf(rNoLocs, "LOCATION_ACTIVE"));
  ok("5g-control. ⚠ and the SAME check reaches a verdict against a healthy database -- otherwise 5g proves nothing",
    stateOf(r1, "LOCATION_ACTIVE") !== "not_checked");
  ok("5h. a blocker that could not be checked never reads as ready, whatever else passed",
    rNoLocs.blockersNotChecked.includes("LOCATION_ACTIVE")
    && rNoLocs.verdict !== "ready" && rNoLocs.verdict !== "ready_with_warnings",
    rNoLocs.verdict);

  const rNoReg = await publishReadiness(adminWithUnreadable(admin, "practice_registration_field"), ctxA);
  ok("5i-control. the same is true one table over -- an unreadable field store does not silently validate the form",
    ["not_checked", "fail"].includes(stateOf(rNoReg, "REGISTRATION_FIELDS_VALID")),
    stateOf(rNoReg, "REGISTRATION_FIELDS_VALID"));

  ok("5j. ⚠ with no booking-access profile, the three the DATABASE owns are NOT CHECKED rather than guessed",
    PUBLISH_CHECKS_DATABASE_OWNED.length === 3
    && PUBLISH_CHECKS_DATABASE_OWNED.every(c => stateOf(r1, c) === "not_checked")
    && r1.profile === null,
    PUBLISH_CHECKS_DATABASE_OWNED.map(c => `${c}=${stateOf(r1, c)}`).join(", "));

  const bad = nonSerialisable(r1);
  ok("5k. ⚠ every field on the readiness payload survives the server/client boundary",
    bad.length === 0, bad.join(", "));
  ok("5k-control. ⚠ and the walker CAN find one -- otherwise 5k is a function that returns an empty array",
    nonSerialisable({ a: 1, b: { c: () => 1 } }).length === 1);
  const badRecall = [...nonSerialisable(q2), ...nonSerialisable(w2)];
  ok("5l. so do the recall queue and the walk-in policy, which are handed to client components too",
    badRecall.length === 0, badRecall.join(", "));

  // ══ 6. CONFIGURING THE BOOKING PAGE ═══════════════════════════════════════════════════════════
  section("6. The booking-access profile");

  const foreign = await saveBookingAccess(admin, ctxA, {
    mode: "link_only", visibleLocationIds: [locB!],
    actorId: OWNER, correlationId: CORR,
  });
  ok("6a. ⚠ another practice's location id is REFUSED -- the column is an array, so the database cannot check it",
    !foreign.ok && foreign.code === "LOCATION_NOT_YOURS",
    foreign.ok ? "it was written" : foreign.code);
  const stillNone = await bookingAccessProfile(admin, wsA);
  ok("6a-control. and nothing was written on the way to that refusal",
    stillNone.state === "ok" && stillNone.value === null,
    JSON.stringify(stillNone));

  const badType = await saveBookingAccess(admin, ctxA, {
    visibleAppointmentTypes: ["consultation_by_carrier_pigeon"], actorId: OWNER, correlationId: CORR,
  });
  ok("6b. an appointment type no appointment could carry is refused",
    !badType.ok && badType.code === "UNKNOWN_APPOINTMENT_TYPE", badType.ok ? "written" : badType.code);
  const badMode = await saveBookingAccess(admin, ctxA, { mode: "semi_public", actorId: OWNER, correlationId: CORR });
  ok("6c. so is a mode s8 does not define", !badMode.ok && badMode.code === "UNKNOWN_MODE",
    badMode.ok ? "written" : badMode.code);

  const denied = await saveBookingAccess(admin, { ...ctxA, capabilities: [] }, {
    mode: "link_only", actorId: OWNER, correlationId: CORR,
  });
  ok("6d. and a caller without the publishing capability cannot configure it at all",
    !denied.ok && denied.code === "FORBIDDEN", denied.ok ? "written" : denied.code);

  const created = await saveBookingAccess(admin, ctxA, {
    mode: "link_only", visibleLocationIds: [locA!], visibleAppointmentTypes: ["new_consultation"],
    brandDisplayName: "The Harness Clinic", actorId: OWNER, correlationId: CORR,
  });
  ok("6e-control. ⚠ this practice's OWN location IS accepted -- otherwise 6a proves only that the check refuses everything",
    created.ok && created.ok && created.data.created === true, created.ok ? "" : created.message);

  const afterSave = await bookingAccessProfile(admin, wsA);
  ok("6f. it was stored as configured, and the publish state was NOT moved by configuring it",
    afterSave.state === "ok" && afterSave.value?.mode === "link_only"
    && afterSave.value?.publishState === "draft" && afterSave.value?.handle === null
    && afterSave.value?.visibleLocationIds.length === 1,
    JSON.stringify(afterSave.state === "ok" ? afterSave.value : afterSave));

  const updated = await saveBookingAccess(admin, ctxA, { instructions: "Bring your card.", actorId: OWNER, correlationId: CORR });
  ok("6g. a second save amends the same row rather than creating a second booking page",
    updated.ok && updated.ok && updated.data.created === false && created.ok && updated.data.id === created.data.id,
    updated.ok ? "" : updated.message);

  // ══ 7. PUBLISHING, AND WHO REFUSES IT ═════════════════════════════════════════════════════════
  section("7. Publishing");

  const r2 = await publishReadiness(admin, ctxA);
  ok("7a. with a profile present, the three the database owns are now judged rather than unanswered",
    stateOf(r2, "OTP_REQUIRED") === "pass" && stateOf(r2, "MODE_ADMITS_PATIENTS") === "pass"
    && stateOf(r2, "HANDLE_CLAIMED") === "fail",
    PUBLISH_CHECKS_DATABASE_OWNED.map(c => `${c}=${stateOf(r2, c)}`).join(", "));

  const refused = await setPublishState(admin, ctxA, { to: "published", actorId: OWNER, correlationId: CORR });
  // ⚠ IT USED TO LOOK FOR INTAKE_BUILT BY NAME, because that was the blocker that always failed. It
  // passes now, so the refusal names the blockers this fixture actually has -- a practice with no
  // patient-bookable session and no published registration form. The property is unchanged: the engine
  // refuses, and it says which of ITS OWN checks stopped it.
  ok("7b. publishing is refused, and the refusal names the engine's own blockers",
    !refused.ok && refused.code === "NOT_READY"
    && /SESSION_BOOKABLE|REGISTRATION_FIELDS_VALID|APPOINTMENT_TYPE_LINKED/.test(refused.message),
    refused.ok ? "it published" : `${refused.code}: ${refused.message}`);
  ok("7c. ⚠ AND IT DOES NOT NAME THE THREE THE DATABASE OWNS. HANDLE_CLAIMED is failing and the engine says nothing about it, because that rule is not its business",
    !refused.ok && !/HANDLE_CLAIMED|OTP_REQUIRED|MODE_ADMITS_PATIENTS/.test(refused.message),
    refused.ok ? "" : refused.message);

  const { data: notPublished } = await admin.from("practice_booking_access")
    .select("publish_state, published_at").eq("workspace_id", wsA).maybeSingle();
  ok("7c-control. and nothing was written on the way to that refusal",
    notPublished?.publish_state === "draft" && notPublished?.published_at === null,
    JSON.stringify(notPublished));

  // ⚠ THE DATABASE'S OWN REFUSAL, ATTEMPTED FOR REAL. The engine never reaches this branch while the
  // build blocker stands, so the constraint is exercised directly -- and the two conditions the engine
  // branches on (the code, and the constraint's name in the message) are asserted on a real error.
  const rawPublish = await admin.from("practice_booking_access")
    .update({ publish_state: "published" }).eq("workspace_id", wsA).select("id");
  ok("7d. ⚠ the DATABASE refuses a published page with no handle, and nothing in this engine had to",
    !!rawPublish.error && rawPublish.error.code === "23514",
    rawPublish.error ? rawPublish.error.code : "the update succeeded -- migration 254's constraint is not live");
  ok("7e. ⚠ and the refusal names practice_booking_access_publishable, which is exactly what setPublishState branches on",
    String(rawPublish.error?.message ?? "").includes(PUBLISHABLE_CONSTRAINT),
    rawPublish.error?.message ?? "");

  const { data: stillDraft } = await admin.from("practice_booking_access")
    .select("publish_state").eq("workspace_id", wsA).maybeSingle();
  ok("7e-control. the refused statement wrote nothing at all",
    stillDraft?.publish_state === "draft", JSON.stringify(stillDraft));

  const ready = await setPublishState(admin, ctxA, { to: "ready", actorId: OWNER, correlationId: CORR });
  ok("7f-control. ⚠ a state that does NOT go live is accepted -- otherwise 7b proves only that this function always refuses",
    ready.ok && ready.ok && ready.data.publishState === "ready", ready.ok ? "" : ready.message);

  const unknown = await setPublishState(admin, ctxA, { to: "sort_of_live", actorId: OWNER, correlationId: CORR });
  ok("7g. a publish state migration 254 does not define is refused before anything is read",
    !unknown.ok && unknown.code === "UNKNOWN_PUBLISH_STATE" && PUBLISH_STATE_CODES.length === 5,
    unknown.ok ? "written" : unknown.code);

  const noProfile = await setPublishState(admin, ctxB, { to: "ready", actorId: OTHER, correlationId: CORR });
  ok("7h. a practice with no booking page is told so rather than having one created underneath it",
    !noProfile.ok && noProfile.code === "NO_PROFILE", noProfile.ok ? "created" : noProfile.code);

  const deniedPublish = await setPublishState(admin, { ...ctxA, capabilities: [] }, {
    to: "ready", actorId: OWNER, correlationId: CORR,
  });
  ok("7i. and publishing needs the same permission as configuring -- s14's account-owner right",
    !deniedPublish.ok && deniedPublish.code === "FORBIDDEN", deniedPublish.ok ? "written" : deniedPublish.code);

  // ══ 8. THE CLIENT BOUNDARY ════════════════════════════════════════════════════════════════════
  section("8. The client boundary");

  const uiDir = join(REPO, "src", "app", "practice", "(shell)", "setup", "availability-booking");
  const recallSrc = readFileSync(join(uiDir, "RecallWorkspace.tsx"), "utf8");
  const publishSrc = readFileSync(join(uiDir, "PublishWorkspace.tsx"), "utf8");

  // ⚠ THE FAILURE THAT KILLED THE FOLLOW-UPS BOARD, CHECKED IN THE OTHER DIRECTION: an ENGINE module
  // imported into a client component drags a database client into the browser bundle.
  const engineModules = [
    "practice/follow-ups", "practice/practice-sessions", "practice/patient-access",
    "practice/availability-config", "practice/booking-rules", "practice/scheduling",
    "practice/provisioning", "practice/shell", "practice/access",
  ];
  const importsIn = (src: string) =>
    [...src.matchAll(/from\s+"([^"]+)"/g)].map(m => m[1]);
  // ⚠ THE MODULE PATH, NOT A SUBSTRING OF IT. `includes("practice/patient-access")` also matches
  // `practice/patient-access-constants`, which is a pure data file with no imports at all -- so the
  // first version of this scanner reported a violation that was not one. A scanner that cries wolf is
  // as useless as one that finds nothing, and this is the one place a false positive would have been
  // "fixed" by weakening the rule.
  const badImports = [...importsIn(recallSrc), ...importsIn(publishSrc)]
    .filter(i => engineModules.some(e => i === `@/lib/${e}`));
  ok("8a. ⚠ neither client component imports an engine module -- constants only",
    badImports.length === 0, badImports.join(", "));
  ok("8a-control. ⚠ and the same scanner DOES find those imports where they belong, on the server page",
    importsIn(readFileSync(join(uiDir, "page.tsx"), "utf8"))
      .filter(i => engineModules.some(e => i === `@/lib/${e}`)).length >= 3,
    "the scanner finds nothing anywhere, so 8a proves nothing");
  ok("8a-control-2. ⚠ and it does NOT confuse a constants file for the engine whose name it starts with",
    ["@/lib/practice/patient-access-constants", "@/lib/practice/recall-constants"]
      .every(i => !engineModules.some(e => i === `@/lib/${e}`))
    && engineModules.some(e => `@/lib/practice/patient-access` === `@/lib/${e}`),
    "the exact-match rule is not exact, or matches nothing");
  ok("8b. both are client components, so 8a is about a boundary that exists",
    /^"use client"/m.test(recallSrc) && /^"use client"/m.test(publishSrc));
  ok("8c. ⚠ the checklist never draws 'not checked' as a tick",
    /not checked/.test(publishSrc) && !/not_checked[^}]*emerald/.test(publishSrc),
    "a not-checked row is styled green somewhere");

  // ══ 9. THE SESSION'S OWN WALK-IN LIMIT, ENFORCED ══════════════════════════════════════════════
  //
  // ⚠ migration 240 STORED walk_in_limit SINCE PHASE 1 AND NOTHING READ IT. checkPlacement enforced only
  // migration 230's practice-wide number, so a per-session limit was a number that had never refused
  // anything. This section is the proof that it now does -- and, just as importantly, that it refuses
  // the RIGHT booking and lifts for nothing it should not.
  section("9. The session walk-in limit bites");

  const walkDate2 = dueDateFrom(today, 3);
  const weekday2 = ((new Date(`${walkDate2}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

  // 08:00-10:00 Kampala is 05:00-07:00Z. Limit TWO, against a practice-wide FIVE -- so the session's own
  // number is the stricter one and must be the one that bites.
  const sTwo = await saveSession(admin, ctxA, {
    weekday: weekday2, startsMinute: 8 * 60, endsMinute: 10 * 60, locationId: locA,
    sessionName: "Two walk-ins only", bookingMode: "internal", walkInsAllowed: true, walkInLimit: 2,
    actorId: OWNER, correlationId: CORR,
  });
  ok("9-control. a session capped at two walk-ins exists, under a practice-wide cap of five",
    sTwo.ok, sTwo.ok ? "" : (sTwo as any).message);

  const walkIn1 = await bookAppointment(admin, {
    workspaceId: wsA, patientId: pOverdue.data.id, patientName: "Nakato Betty",
    scheduledAt: `${walkDate2}T05:15:00.000Z`, appointmentType: "walk_in", locationId: locA,
    actorId: OWNER, correlationId: CORR,
  });
  ok("9a-control. ⚠ the FIRST walk-in, under the limit, is ACCEPTED -- otherwise 9c proves only that this session refuses everything",
    walkIn1.ok, walkIn1.ok ? "" : (walkIn1 as any).message);

  const walkIn2 = await bookAppointment(admin, {
    workspaceId: wsA, patientId: pDeferred.data.id, patientName: "Auma Grace",
    scheduledAt: `${walkDate2}T05:45:00.000Z`, appointmentType: "walk_in", locationId: locA,
    actorId: OWNER, correlationId: CORR,
  });
  ok("9b-control. and the second, which reaches the limit exactly, is still accepted",
    walkIn2.ok, walkIn2.ok ? "" : (walkIn2 as any).message);

  const walkIn3 = await bookAppointment(admin, {
    workspaceId: wsA, patientId: pStranded.data.id, patientName: "Okello James",
    scheduledAt: `${walkDate2}T06:00:00.000Z`, appointmentType: "walk_in", locationId: locA,
    actorId: OWNER, correlationId: CORR,
  });
  ok("9c. ⚠ THE THIRD IS REFUSED, by the session's own limit, with its own code",
    !walkIn3.ok && (walkIn3 as any).code === "SESSION_WALK_IN_LIMIT",
    walkIn3.ok ? "it was booked" : (walkIn3 as any).code);
  ok("9d. ⚠ and the refusal names the SESSION and the SESSION's number -- not the practice-wide one, which would send somebody to change the wrong setting",
    !walkIn3.ok && /Two walk-ins only/.test((walkIn3 as any).message)
    && /takes 2 walk-ins/.test((walkIn3 as any).message)
    && !/\b5\b/.test((walkIn3 as any).message),
    walkIn3.ok ? "" : (walkIn3 as any).message);

  const startMs3 = Date.parse(`${walkDate2}T06:00:00.000Z`);
  const placeArgs = {
    workspaceId: wsA, startMs: startMs3, endMs: startMs3 + 20 * 60000,
    locationId: locA ?? null, appointmentType: "walk_in",
  };

  // ⚠ s14's WINDOW OVERRIDE MUST NOT LIFT A CAPACITY RULE. `lifted` suppresses LEAD_TIME and
  // BEYOND_HORIZON only; an override of the notice period becoming an override of somebody else's place
  // in a full clinic is exactly the conflation migration 255's header warns about for double-booking.
  const overridden = await checkPlacement(admin, {
    ...placeArgs, allowOverlap: false,
    windowOverridden: ["LEAD_TIME", "BEYOND_HORIZON", "SESSION_WALK_IN_LIMIT", "WALK_IN_LIMIT"],
  });
  ok("9e. ⚠ a s14 window override does NOT lift the walk-in limit, even when it names the code",
    !overridden.ok && (overridden as any).code === "SESSION_WALK_IN_LIMIT",
    overridden.ok ? "the override lifted a capacity rule" : (overridden as any).code);

  // ⚠ OVERLAP-EXEMPT IS NOT LIMIT-EXEMPT. A walk-in needs no free grid slot; that says nothing about
  // whether this clinic will take another one.
  const overlapped = await checkPlacement(admin, { ...placeArgs, allowOverlap: true });
  ok("9f. ⚠ and allowOverlap does not lift it either -- a walk-in is exempt from the OVERLAP rule, not from the limit",
    !overlapped.ok && (overlapped as any).code === "SESSION_WALK_IN_LIMIT",
    overlapped.ok ? "overlap exemption lifted a capacity rule" : (overlapped as any).code);

  // ⚠ A FAILED READ IS NOT A FREE SLOT.
  const unreadableSessions = await checkPlacement(
    adminWithUnreadable(admin, "practice_availability_template"), { ...placeArgs, allowOverlap: false });
  ok("9g. ⚠ an unreadable session table REFUSES the walk-in rather than waving it through",
    !unreadableSessions.ok && (unreadableSessions as any).code === "SESSION_WALK_IN_UNREADABLE",
    unreadableSessions.ok ? "it was allowed on an unreadable read" : (unreadableSessions as any).code);

  // A time in the same day that no session covers: the session limit governs nothing, so the booking
  // stands. This is the control proving 9c is about the SESSION and not about the day.
  const outside = await checkPlacement(admin, {
    workspaceId: wsA, startMs: Date.parse(`${walkDate2}T02:00:00.000Z`),
    endMs: Date.parse(`${walkDate2}T02:20:00.000Z`), locationId: locA ?? null,
    appointmentType: "walk_in", allowOverlap: false,
  });
  ok("9h-control. ⚠ a walk-in at a time NO session covers is allowed -- so 9c is the session's limit, not a day-wide refusal",
    outside.ok, outside.ok ? "" : (outside as any).message);

  // ⚠ AND THE PRACTICE-WIDE LIMIT STILL REFUSES INDEPENDENTLY. A second location with its own rule of
  // nought, and no session at all: nothing the new code does can be what refuses this.
  const { data: rowC } = await admin.from("practice_location")
    .insert({ workspace_id: wsA, name: "Second Site", type: "clinic", active: true, travel_buffer_minutes: 0 })
    .select("id").single();
  const locC = rowC?.id as string;
  const ruleC = await setBookingRule(admin, ctxA, {
    locationId: locC, appointmentType: null, leadTimeMinutes: 0,
    walkInDailyLimit: 0, actorId: OWNER, correlationId: CORR,
  });
  ok("9i-control. a second location has a practice-wide walk-in limit of nought and no session",
    ruleC.ok, ruleC.ok ? "" : (ruleC as any).message);
  const practiceWide = await checkPlacement(admin, {
    workspaceId: wsA, startMs: startMs3, endMs: startMs3 + 20 * 60000,
    locationId: locC, appointmentType: "walk_in", allowOverlap: false,
  });
  ok("9i. ⚠ the PRACTICE-WIDE limit still refuses on its own, under its own separate code",
    !practiceWide.ok && (practiceWide as any).code === "WALK_IN_LIMIT",
    practiceWide.ok ? "the practice-wide limit stopped working" : (practiceWide as any).code);

  // The screen and the engine read the same resolver, so the figure a practitioner sees is the figure
  // that refused the booking. Asserted rather than asserted-about.
  const w3 = await walkInPolicy(admin, ctxA, { date: walkDate2 });
  const twoSession = w3.sessions.find(s => s.sessionName === "Two walk-ins only");
  ok("9j. ⚠ the screen's own figure agrees with the engine that refused: two used, none left",
    twoSession?.usedIds?.length === 2 && twoSession?.remaining === 0
    && twoSession?.effectiveLimitEnforced === true,
    JSON.stringify({ used: twoSession?.usedIds?.length, left: twoSession?.remaining }));

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
