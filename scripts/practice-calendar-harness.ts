/**
 * Practice Operations Calendar harness -- CPR-CAL-001 v4. Migration 227.
 *
 * WHAT IT PROVES:
 *   1. THE DAY IS THE PRACTICE'S, NOT UTC'S. An early-morning Kampala appointment is 22:00Z the day
 *      before; the old loader put it on the wrong day, and calendarDay() does not.
 *   2. UTILISATION IS TIME, NOT A PERCENTAGE -- and where no availability is set the screen says so
 *      rather than dividing by an assumption.
 *   3. "FULL" IS DERIVED. Booking into a slot fills it; cancelling empties it again, with nothing
 *      stored either way.
 *   4. LEAVE IS NOT CAPACITY. Hours a practitioner is away must not count as time they could see people.
 *   5. THE SUMMARY COUNTS SPLIT BY TYPE, and a cancelled appointment counts towards nothing.
 *   6. OVERDUE FOLLOW-UPS ARE DERIVED FROM THE DATE, never a stored flag.
 *   7. THE BRIEFING IS ARITHMETIC, and carries no clinical judgement.
 *   8. THE DRAWER OMITS ALLERGIES, BALANCE AND QUESTIONNAIRES, and says why -- "no known allergies"
 *      printed from an empty table is the most dangerous line on the screen.
 *   9. "NOTIFIED AUTOMATICALLY" IS NOT CLAIMED: nothing schedules a reminder.
 *  10. AN APPOINTMENT WITH NO PATIENT RECORD CANNOT OPEN AN ENCOUNTER, and says so.
 *  11. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-calendar-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { bookAppointment } from "../src/lib/practice/scheduling";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { calendarDay, patientDrawer, REFUSED_ON_CALENDAR } from "../src/lib/practice/calendar";
import { zonedDayRange } from "../src/lib/practice/practice-time";
import { purgeWorkspacesOwnedBy, cleanupOnKill } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000ca001";
const OTHER = "00000000-0000-4000-8000-0000000ca002";

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
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-cal-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-cal",
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: "harness-cal", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      await admin.from("practice_patient_identifier").delete().eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
    }
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const base = { actorId: OWNER, correlationId: "harness-cal" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nPractice Operations Calendar harness (CPR-CAL-001 v4, migration 227)\n");
  await cleanup();

  // ── 8, 9. The stated refusals, before any data ─────────────────────────────
  ok("8. ALLERGIES, BALANCE AND QUESTIONNAIRES ARE ALL NAMED AS UNAVAILABLE",
    ["allergies", "balance", "questionnaires"].every(k => REFUSED_ON_CALENDAR.some(r => r.key === k)) &&
    REFUSED_ON_CALENDAR.every(r => r.detail.length > 80),
    REFUSED_ON_CALENDAR.map(r => r.key).join(","));
  ok("8b. and the allergy refusal says WHY an empty field is safer than a reassuring one",
    /does not ask|checked|empty table/i.test(REFUSED_ON_CALENDAR.find(r => r.key === "allergies")!.detail));

  const wsA = await provision(OWNER, "HARNESS Calendar A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Calendar B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Kato Brian", sex: "male", birthDate: "1984-02-02",
    phone: "+256772330001", ...base,
  });
  if (!p1.ok) { ok("a patient registers", false, p1.message); return report(); }
  ok("a patient registers", true);

  // ── 1. THE UTC DAY BUG ─────────────────────────────────────────────────────
  //
  // Kampala is UTC+3, so 01:00 local on the 20th is 22:00Z on the 19th. The old loader sliced the day
  // with `${day}T00:00:00.000Z`, so this appointment fell OUT of the 20th and INTO the 19th.
  const day = "2026-09-20";
  const earlyLocal = "2026-09-19T22:30:00.000Z"; // 01:30 on the 20th in Kampala
  const booked = await bookAppointment(admin, {
    workspaceId: wsA, patientId: p1.data.id, patientName: "Kato Brian",
    appointmentType: "new_consultation", scheduledAt: earlyLocal, durationMinutes: 30, ...base,
  });
  ok("an early-morning appointment is booked", booked.ok, booked.ok ? "" : booked.message);

  const c = await calendarDay(admin, a.ctx, day);
  ok("1. IT LANDS ON THE PRACTICE'S DAY, not UTC's -- the bug CPR-300 found, still in the diary",
    c.appointments.some(x => x.id === (booked as any).data?.id),
    JSON.stringify({ day: c.day, n: c.appointments.length }));
  const previousDay = await calendarDay(admin, a.ctx, "2026-09-19");
  ok("1b. and NOT on the day before, which is where UTC would have put it",
    !previousDay.appointments.some(x => x.id === (booked as any).data?.id),
    String(previousDay.appointments.length));

  // ── 2. No availability set ─────────────────────────────────────────────────
  ok("2. WITH NO AVAILABILITY SET, NO DENOMINATOR IS INVENTED",
    c.load.capacityRecorded === false && c.load.available === null && c.load.utilisationPercent === null,
    JSON.stringify(c.load));
  ok("2b. and the booked time is still real", c.load.scheduledMinutes === 30 && /30m/.test(c.load.scheduled),
    c.load.scheduled);

  // Give the day some availability: 08:00-13:00 Kampala clinic, plus an hour of leave.
  const { startIso } = zonedDayRange(day, "Africa/Kampala");
  const at = (h: number) => new Date(Date.parse(startIso) + h * 3600_000).toISOString();
  const { error: slotError } = await admin.from("practice_availability_slot").insert([
    { workspace_id: wsA, starts_at: at(8), ends_at: at(13), slot_kind: "clinic", status: "OPEN" },
    { workspace_id: wsA, starts_at: at(14), ends_at: at(16), slot_kind: "leave", status: "BLOCKED" },
  ]);
  ok("availability is recorded for the day", slotError === null, slotError?.message ?? "");

  const withSlots = await calendarDay(admin, a.ctx, day);
  ok("2c. NOW THERE IS A DENOMINATOR, and it is time rather than a percentage",
    withSlots.load.capacityRecorded === true && withSlots.load.available === "5h 00m" &&
    withSlots.load.utilisationPercent === null,
    JSON.stringify(withSlots.load));
  ok("4. LEAVE IS NOT CAPACITY -- two hours away are not two hours free",
    withSlots.load.availableMinutes === 300, String(withSlots.load.availableMinutes));
  ok("2d. and the remaining time is the difference", withSlots.load.remaining === "4h 30m",
    withSlots.load.remaining ?? "null");

  const serialised = JSON.stringify(withSlots);
  ok("2e. NO PERCENTAGE-SHAPED VALUE ANYWHERE IN THE PAYLOAD",
    !/:\s*"?\d{1,3}(\.\d+)?\s*%/.test(serialised) && !/"utilisation"\s*:\s*\d/.test(serialised));

  // ── 3. Full is derived ─────────────────────────────────────────────────────
  const clinicSlot = withSlots.ribbon.find(r => r.kind === "clinic")!;
  ok("3. THE CLINIC SLOT READS AS AVAILABLE while nothing sits in it",
    clinicSlot.full === false && clinicSlot.booked === 0, JSON.stringify(clinicSlot));
  const inSlot = await bookAppointment(admin, {
    workspaceId: wsA, patientId: p1.data.id, patientName: "Kato Brian",
    appointmentType: "scheduled_followup", scheduledAt: at(9), durationMinutes: 30,
    allowOverlap: true, ...base,
  });
  if (inSlot.ok) {
    await admin.from("practice_appointment").update({ slot_id: clinicSlot.id }).eq("id", inSlot.data.id);
    const filled = await calendarDay(admin, a.ctx, day);
    const nowFull = filled.ribbon.find(r => r.id === clinicSlot.id)!;
    ok("3b. AND FULL ONCE SOMETHING DOES -- derived, with nothing stored",
      nowFull.full === true && nowFull.booked === 1, JSON.stringify(nowFull));

    await admin.from("practice_appointment").update({ status: "CANCELLED" }).eq("id", inSlot.data.id);
    const afterCancel = await calendarDay(admin, a.ctx, day);
    ok("3c. AND AVAILABLE AGAIN THE MOMENT IT IS CANCELLED -- a stored 'full' would still say full",
      afterCancel.ribbon.find(r => r.id === clinicSlot.id)!.full === false);
    ok("5. and a cancelled appointment counts towards nothing",
      afterCancel.summary.followUps === 0 && afterCancel.summary.booked === 1,
      JSON.stringify(afterCancel.summary));
  } else ok("a second appointment books into the slot", false, inSlot.message);

  // ── 5. Types split ─────────────────────────────────────────────────────────
  for (const [type] of [["emergency"], ["teleconsultation"], ["walk_in"]] as const) {
    await bookAppointment(admin, {
      workspaceId: wsA, patientId: p1.data.id, patientName: "Kato Brian",
      appointmentType: type, scheduledAt: at(10), durationMinutes: 15, allowOverlap: true, ...base,
    });
  }
  const mixed = await calendarDay(admin, a.ctx, day);
  ok("5b. THE SUMMARY SPLITS BY TYPE, as the comp colour-codes them",
    mixed.summary.emergency === 1 && mixed.summary.telemedicine === 1 && mixed.summary.walkIns === 1 &&
    mixed.summary.newPatients === 1,
    JSON.stringify(mixed.summary));
  ok("5c. and every appointment carries its own colour and label",
    mixed.appointments.every(x => !!x.colour && !!x.typeLabel),
    JSON.stringify(mixed.appointments.map(x => x.typeLabel)));

  // ── 10. A booking with no record ───────────────────────────────────────────
  const nameOnly = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Walk In Stranger", appointmentType: "walk_in",
    scheduledAt: at(11), durationMinutes: 15, allowOverlap: true, ...base,
  });
  if (nameOnly.ok) {
    const withNameOnly = await calendarDay(admin, a.ctx, day);
    const row = withNameOnly.appointments.find(x => x.id === nameOnly.data.id)!;
    ok("10. A BOOKING WITH NO RECORD CANNOT OPEN AN ENCOUNTER, and says so rather than offering a button that fails",
      row.canOpenEncounter === false && row.href === null, JSON.stringify(row));
    ok("10b. CONTROL: one with a record can",
      withNameOnly.appointments.some(x => x.patientId && x.canOpenEncounter));
    ok("10c. and the briefing names them, because they are the ones nobody can write a consultation for",
      withNameOnly.briefing.some(bl => /name only/i.test(bl)),
      JSON.stringify(withNameOnly.briefing));
  } else ok("a name-only booking is made", false, nameOnly.message);

  // ── 6, 7. Follow-ups and the briefing ──────────────────────────────────────
  await admin.from("practice_follow_up").insert([
    { workspace_id: wsA, patient_id: p1.data.id, due_on: "2020-01-01", status: "OPEN", reason: "old", created_by: OWNER },
    { workspace_id: wsA, patient_id: p1.data.id, due_on: "2099-01-01", status: "OPEN", reason: "future", created_by: OWNER },
  ]);
  const withFollowUps = await calendarDay(admin, a.ctx, day);
  ok("6. OVERDUE IS DERIVED FROM THE DATE -- one long past, one far future",
    withFollowUps.followUps.overdue === 1 && withFollowUps.followUps.needBooking === 2,
    JSON.stringify(withFollowUps.followUps));
  ok("7. THE BRIEFING IS ARITHMETIC AND CARRIES NO CLINICAL JUDGEMENT",
    withFollowUps.briefing.length > 0 &&
    !/likely|recommend|consider|should|discuss/i.test(withFollowUps.briefing.join(" ")),
    JSON.stringify(withFollowUps.briefing));

  // ── 9. The footer's claim ──────────────────────────────────────────────────
  ok("9. NOTHING IS CLAIMED TO BE SENT AUTOMATICALLY",
    withFollowUps.notifications.automatic === false &&
    /nothing sends by itself|Nothing is sent/i.test(withFollowUps.notifications.note),
    JSON.stringify(withFollowUps.notifications));

  // ── 8. The drawer ──────────────────────────────────────────────────────────
  const drawer = await patientDrawer(admin, a.ctx, p1.data.id);
  ok("8c. THE DRAWER CARRIES NO ALLERGY, BALANCE OR QUESTIONNAIRE FIELD",
    !!drawer && !/allerg|balance|questionnaire/i.test(JSON.stringify({
      p: drawer.patient, i: drawer.identifiers, c: drawer.contacts, d: drawer.diagnoses,
    })),
    "one of them leaked into the data");
  ok("8d. and it names all three as unavailable, with reasons",
    drawer!.unavailable.length === 3, JSON.stringify(drawer!.unavailable.map(u => u.key)));
  // ⚠ THE CONTROL ASKS FOR THE PATIENT NUMBER, NOT AN IDENTIFIER ROW. CPR-PID-001 (migration 289)
  // retired the minted practice_id, so `identifiers` is legitimately EMPTY for anyone registered since
  // and this control had been asserting a shape the product no longer produces. The number is the
  // identity now, and a drawer that cannot show it is the actual defect worth catching here.
  ok("8e. CONTROL: it does carry what this product actually holds",
    /^\d{2}-\d{6}$/.test((drawer!.patient as { patient_number?: string }).patient_number ?? "")
      && drawer!.contacts.length > 0 && !!drawer!.patient.age,
    JSON.stringify({
      n: (drawer!.patient as { patient_number?: string }).patient_number,
      i: drawer!.identifiers.length, c: drawer!.contacts.length,
    }));

  // ── 11. Isolation ──────────────────────────────────────────────────────────
  const crossDay = await calendarDay(admin, b.ctx, day);
  ok("11. ANOTHER PRACTICE'S CALENDAR IS EMPTY OF THIS ONE'S DAY",
    crossDay.appointments.length === 0 && crossDay.ribbon.length === 0,
    JSON.stringify({ a: crossDay.appointments.length, r: crossDay.ribbon.length }));
  const crossDrawer = await patientDrawer(admin, b.ctx, p1.data.id);
  ok("11b. and it cannot open this one's patient", crossDrawer === null);
  // NON-VACUOUS: workspace B works on its own diary.
  const bPatient = await registerPatient(admin, {
    workspaceId: wsB, displayName: "Their Own Patient", sex: "female", birthDate: "1990-01-01",
    phone: "+256772330002", actorId: OTHER, correlationId: "harness-cal",
  });
  const bBooked = bPatient.ok ? await bookAppointment(admin, {
    workspaceId: wsB, patientId: bPatient.data.id, patientName: "Their Own Patient",
    appointmentType: "new_consultation", scheduledAt: at(9), durationMinutes: 20,
    actorId: OTHER, correlationId: "harness-cal",
  }) : null;
  ok("11c. CONTROL: workspace B books into its own day perfectly well", !!bBooked?.ok,
    bBooked && !bBooked.ok ? bBooked.message : "");

  await cleanup();
  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

// ⚠ TEARDOWN ON A KILL, NOT ONLY ON A THROW. The catch below covers a run that FAILS; it does not
// cover one that is KILLED, which in this environment is the ordinary case -- a command timeout, an
// agent watchdog, a stopped task. Six abandoned Practice workspaces accumulated that way and the
// landlord Mission Control counted every one of them as a real practice. Best effort: SIGKILL cannot
// be caught, and scripts/estate-hygiene-harness.ts is the backstop for what still gets through.
cleanupOnKill(cleanup);
main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
