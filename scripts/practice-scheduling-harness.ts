/**
 * Practice scheduling harness -- PEN-001's rules exercised against the live database, through the same
 * engine functions the API routes call.
 *
 * WHAT IT PROVES:
 *   1. Booking creates a REQUESTED appointment; a walk-in enters CONFIRMED (walk-ins arrive by definition).
 *   2. DOUBLE-BOOKING IS REFUSED for an overlapping live appointment -- and allowed with an explicit
 *      allowOverlap, and exempt for walk-ins (the queue exists so unscheduled arrivals need no free slot).
 *   3. The state machine is deterministic: CONFIRMED -> ARRIVED works and ALSO writes the arrival record
 *      and a WAITING queue entry (one desk action, three facts); COMPLETED -> CONFIRMED is refused as an
 *      illegal move; an illegal VALUE is refused by the CHECK constraint below any engine bug.
 *   4. Checking in twice cannot create a second live arrival (partial unique index).
 *   5. The queue walks WAITING -> IN_CONSULTATION -> COMPLETED and refuses COMPLETED -> WAITING.
 *   6. WORKSPACE ISOLATION: a second workspace's day view contains none of the first's appointments --
 *      asserted non-vacuously (the first workspace must have rows for the zero to mean anything).
 *   7. Anon reads 0 rows from all four scheduling tables while the service role sees rows.
 *
 * Synthetic workspaces via the real provisioning orchestrator; everything deleted at the end.
 *
 *   npx --yes tsx scripts/practice-scheduling-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { bookAppointment, transitionAppointment, transitionQueueEntry, loadDay } from "../src/lib/practice/scheduling";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-0000000c0dea";
const USER_B = "00000000-0000-4000-8000-0000000c0deb";

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

async function provision(user: string, name: string, keySuffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-sched-${keySuffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-sched",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-sched", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [USER_A, USER_B]);
}

const DAY = "2026-09-01";

async function main() {
  console.log("\nPractice scheduling harness (PEN-001, DM-001 s7)\n");
  await cleanup();

  const wsA = await provision(USER_A, "HARNESS Sched A (synthetic)", "a");
  const wsB = await provision(USER_B, "HARNESS Sched B (synthetic)", "b");
  const base = { actorId: USER_A, correlationId: "harness-sched" };

  // ── 1. Booking and walk-in initial states ──────────────────────────────────
  const b1 = await bookAppointment(admin, { workspaceId: wsA, patientName: "Diary Patient One", appointmentType: "new_consultation", scheduledAt: `${DAY}T09:00:00.000Z`, durationMinutes: 30, ...base });
  ok("a booking is created as REQUESTED", b1.ok && b1.data.status === "REQUESTED", b1.ok ? b1.data.status : b1.message);
  const w1 = await bookAppointment(admin, { workspaceId: wsA, patientName: "Walk-in One", appointmentType: "walk_in", scheduledAt: `${DAY}T09:10:00.000Z`, ...base });
  ok("a walk-in enters as CONFIRMED", w1.ok && w1.data.status === "CONFIRMED", w1.ok ? w1.data.status : w1.message);

  // ── 2. Double-booking policy ───────────────────────────────────────────────
  const clash = await bookAppointment(admin, { workspaceId: wsA, patientName: "Overlap Patient", appointmentType: "new_consultation", scheduledAt: `${DAY}T09:15:00.000Z`, durationMinutes: 20, ...base });
  ok("an overlapping booking is refused with DOUBLE_BOOKED", !clash.ok && clash.code === "DOUBLE_BOOKED", clash.ok ? "was allowed" : clash.code);
  const override = await bookAppointment(admin, { workspaceId: wsA, patientName: "Deliberate Double", appointmentType: "new_consultation", scheduledAt: `${DAY}T09:15:00.000Z`, durationMinutes: 20, allowOverlap: true, ...base });
  ok("allowOverlap permits a deliberate double-book", override.ok, override.ok ? "" : override.message);

  // ── 3. Appointment state machine + check-in side effects ───────────────────
  if (!b1.ok) { report(); return; }
  const c1 = await transitionAppointment(admin, { workspaceId: wsA, appointmentId: b1.data.id, to: "CONFIRMED", ...base });
  ok("REQUESTED -> CONFIRMED", c1.ok, c1.ok ? "" : c1.message);
  const arr = await transitionAppointment(admin, { workspaceId: wsA, appointmentId: b1.data.id, to: "ARRIVED", ...base });
  ok("CONFIRMED -> ARRIVED creates a queue entry", arr.ok && !!arr.data.queueEntryId, arr.ok ? "no queue entry" : arr.message);
  const { count: arrivals } = await admin.from("practice_arrival").select("*", { count: "exact", head: true }).eq("appointment_id", b1.data.id);
  ok("the arrival record exists", (arrivals ?? 0) === 1, `${arrivals}`);

  const dup = await admin.from("practice_arrival").insert({ workspace_id: wsA, appointment_id: b1.data.id });
  ok("a second live arrival is refused by the partial unique index", !!dup.error && /duplicate|unique/i.test(dup.error.message), dup.error?.message ?? "insert succeeded");

  const done = await transitionAppointment(admin, { workspaceId: wsA, appointmentId: b1.data.id, to: "COMPLETED", ...base });
  ok("ARRIVED -> COMPLETED", done.ok, done.ok ? "" : done.message);
  const back = await transitionAppointment(admin, { workspaceId: wsA, appointmentId: b1.data.id, to: "CONFIRMED", ...base });
  ok("COMPLETED -> CONFIRMED is refused as ILLEGAL_TRANSITION", !back.ok && back.code === "ILLEGAL_TRANSITION", back.ok ? "was allowed" : back.code);

  const badValue = await admin.from("practice_appointment").update({ status: "TELEPORTED" }).eq("id", b1.data.id);
  ok("an illegal status VALUE is refused by the CHECK constraint", !!badValue.error, badValue.error ? "" : "update succeeded");

  // ── 4. Queue machine ───────────────────────────────────────────────────────
  const qid = arr.ok ? arr.data.queueEntryId! : "";
  const qStart = await transitionQueueEntry(admin, { workspaceId: wsA, entryId: qid, to: "IN_CONSULTATION", ...base });
  ok("queue WAITING -> IN_CONSULTATION", qStart.ok, qStart.ok ? "" : qStart.message);
  const qDone = await transitionQueueEntry(admin, { workspaceId: wsA, entryId: qid, to: "COMPLETED", ...base });
  ok("queue IN_CONSULTATION -> COMPLETED", qDone.ok, qDone.ok ? "" : qDone.message);
  const qBack = await transitionQueueEntry(admin, { workspaceId: wsA, entryId: qid, to: "WAITING", ...base });
  ok("queue COMPLETED -> WAITING is refused", !qBack.ok && qBack.code === "ILLEGAL_TRANSITION", qBack.ok ? "was allowed" : qBack.code);

  // ── 5. Workspace isolation, non-vacuous ────────────────────────────────────
  const dayA = await loadDay(admin, wsA, DAY);
  const dayB = await loadDay(admin, wsB, DAY);
  ok("workspace A has appointments (isolation test is not vacuous)", dayA.appointments.length >= 3, `${dayA.appointments.length}`);
  ok("workspace B sees none of workspace A's appointments", dayB.appointments.length === 0, `${dayB.appointments.length}`);

  // ── 6. Anon denial across the four scheduling tables ───────────────────────
  let svcRows = false, leaked = 0;
  for (const t of ["practice_availability_slot", "practice_appointment", "practice_arrival", "practice_queue_entry"]) {
    const { count: svc } = await admin.from(t).select("*", { count: "exact", head: true });
    if ((svc ?? 0) > 0) svcRows = true;
    const { count: a } = await anon.from(t).select("*", { count: "exact", head: true });
    if ((a ?? 0) > 0) leaked++;
  }
  ok("the service role sees scheduling rows (denial test is not vacuous)", svcRows);
  ok("anon reads 0 rows from every scheduling table", leaked === 0, `${leaked} table(s) leaked`);

  await cleanup();
  const { count: left } = await admin.from("practice_appointment").select("*", { count: "exact", head: true }).in("workspace_id", [wsA, wsB]);
  ok("synthetic data cleaned up (cascade)", (left ?? 0) === 0, `${left}`);

  report();
}

function report() {
  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exit(fails.length ? 1 : 0);
}

main();
