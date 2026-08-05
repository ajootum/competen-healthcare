/**
 * CPR-CORE-001 CORE-05 / CORE-06: encounter transitions and interruption safety. Migration 234.
 *
 * WHAT THIS HAS TO PROVE, taken from the spec rather than from what the code happens to do:
 *   s7    "single active foreground encounter. drafts remain accessible."
 *   s6.2  "the original session remains resumable and its queue is preserved."
 *   s6.2  "interruption time must not be counted as active consultation time for another patient."
 *   s16   "an emergency interruption does not lose the current clinic queue or active draft."
 *
 * ⚠ THE THIRD ONE IS THE ONE WORTH THE TROUBLE, and it is asserted through metrics.ts rather than by
 * inspecting a timestamp: an interrupted consultation must not have the emergency's minutes added to it.
 * A workflow assertion would pass while the number a practitioner actually reads stayed wrong.
 *
 *   npx --yes tsx scripts/practice-interruption-harness.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { transitionEncounter, interruptWith, activeEncounterId } from "../src/lib/practice/encounters";
import { practiceMetrics, metricScope } from "../src/lib/practice/metrics";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { ENCOUNTER_TRANSITIONS } from "../src/lib/practice/encounter-constants";
import type { WorkspaceContext } from "../src/lib/practice/access";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

// Hex only -- "in001" is not a uuid, and PostgREST rejected the whole fixture over it.
const USER = "00000000-0000-4000-8000-00000000e001";
const TZ = "Africa/Kampala";
const CORR = "harness-interrupt";

async function cleanup() {
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", USER);
  for (const w of (ws ?? []) as { id: string }[]) {
    await admin.from("practice_encounter_status_history").delete().eq("workspace_id", w.id);
    await admin.from("practice_domain_event").delete().eq("workspace_id", w.id);
    await admin.from("practice_encounter").update({ interrupted_by_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_encounter").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient").delete().eq("workspace_id", w.id);
    await admin.from("practice_activity").delete().eq("workspace_id", w.id);
    await admin.from("practice_queue_entry").delete().eq("workspace_id", w.id);
    await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
    await admin.from("practice_workspace").delete().eq("id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().eq("user_id", USER);
  await admin.from("provisioning_request").delete().eq("target_user_id", USER);
  await admin.from("practice_audit_event").delete().eq("actor_id", USER);
}

async function main() {
  console.log("\n=== ENCOUNTER INTERRUPTION (CPR-CORE-001 s6.2, migration 234) ===\n");

  const probe = await admin.from("practice_encounter").select("interrupted_by_id").limit(1);
  ok("0. control -- migration 234 is applied", !probe.error, probe.error?.message ?? "");
  if (probe.error) { report(); return; }

  await cleanup();
  const { data: req, error: reqErr } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-int-${Date.now()}`, request_type: "pilot",
    actor_user_id: USER, target_user_id: USER, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  // The insert error is checked rather than trusted: a null row here threw a TypeError three lines
  // later, which reports a fixture problem as a crash in the code under test.
  if (reqErr || !req) { console.error("provisioning request refused:", reqErr?.message ?? "no row"); process.exitCode = 1; return; }
  const payload: IndividualRequest = {
    displayName: "Harness Interruption", countryCode: "UG", timezone: TZ,
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
    termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
  };
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: USER, correlation_id: CORR, workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) { console.error("provisioning failed", run.errorCode); process.exitCode = 1; return; }
  const ws = run.workspaceId;

  const patient = async (name: string) => {
    const { data, error } = await admin.from("practice_patient")
      .insert({ workspace_id: ws, display_name: name, created_by: USER }).select("id").single();
    if (error) throw new Error(`patient fixture: ${error.message}`);
    return data.id as string;
  };
  // Encounters inserted directly so each test starts from a known status without exercising the launcher.
  const encounter = async (patientId: string, startedAt: string) => {
    const { data, error } = await admin.from("practice_encounter").insert({
      workspace_id: ws, patient_id: patientId, entry_pathway: "booked", encounter_mode: "in_person",
      status: "DRAFT", started_at: startedAt, created_by: USER,
    }).select("id").single();
    if (error) throw new Error(`encounter fixture: ${error.message}`);
    return data.id as string;
  };
  const move = (id: string, to: string, extra: Record<string, unknown> = {}) => transitionEncounter(admin, {
    workspaceId: ws, encounterId: id, to, actorId: USER, practitionerId: USER, correlationId: CORR, ...extra,
  });
  const statusOf = async (id: string) =>
    (await admin.from("practice_encounter").select("status, interrupted_by_id").eq("id", id).maybeSingle()).data;

  const today = new Date().toISOString().slice(0, 10);
  const at = (h: number, m: number) => new Date(`${today}T${String(h - 3).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`).toISOString();

  // ── 1. The state machine (CORE-05) ───────────────────────────────────────────────────────────────
  const alice = await patient("Alice Clinic");
  const e1 = await encounter(alice, at(9, 0));

  ok("1a. DRAFT can become ACTIVE", (await move(e1, "ACTIVE")).ok);
  ok("1b. ACTIVE can be PAUSED", (await move(e1, "PAUSED")).ok);
  ok("1c. PAUSED can be resumed", (await move(e1, "ACTIVE")).ok);
  const illegal = await move(e1, "SIGNED");
  ok("1d. REFUSES a move the state machine does not allow",
    !illegal.ok && illegal.code === "ILLEGAL_TRANSITION", JSON.stringify(illegal));
  ok("1d-control. the transition table is the one the engine reads",
    ENCOUNTER_TRANSITIONS.ACTIVE.includes("PAUSED") && !ENCOUNTER_TRANSITIONS.ACTIVE.includes("SIGNED"));

  // ── 2. One active foreground encounter (s7) ──────────────────────────────────────────────────────
  const bob = await patient("Bob Emergency");
  const e2 = await encounter(bob, at(9, 20));

  const second = await move(e2, "ACTIVE");
  ok("2a. REFUSES a second active consultation",
    !second.ok && second.code === "ANOTHER_ACTIVE", JSON.stringify(second));
  // ⚠ WHICH GUARD FIRED IS PART OF THE CLAIM. Deleting the engine check changed nothing observable,
  // because migration 234's index catches the same case and the engine maps 23505 to the same code --
  // so the assertion above passes either way and the pre-check could rot unnoticed. The two paths
  // already word themselves differently, and 2a-b is what makes that difference load-bearing: the
  // ordinary case must be refused BEFORE the write, and only a genuine race should reach the index.
  ok("2a-b. and refuses it before writing, not by bouncing off the unique index",
    !second.ok && /already open/.test(second.message), second.ok ? "" : second.message);
  ok("2a-control. and the first is still the one that is open",
    (await activeEncounterId(admin, ws, USER)).id === e1);

  // ⚠ THE DATABASE, NOT ONLY THE ENGINE. Two tabs both read "nothing else active" and both write, so the
  // engine check above cannot be the only guard. Asserted by writing DIRECTLY, bypassing every check.
  const raw = await admin.from("practice_encounter").update({ status: "ACTIVE" }).eq("id", e2);
  ok("2b. the DATABASE refuses a second active encounter, not just the engine",
    !!raw.error && raw.error.code === "23505",
    raw.error ? `expected 23505, got ${raw.error.code}` : "the write SUCCEEDED");

  // ── 3. The interruption (CORE-06) ────────────────────────────────────────────────────────────────
  const interrupted = await interruptWith(admin, {
    workspaceId: ws, encounterId: e2, actorId: USER, practitionerId: USER, correlationId: CORR,
  });
  ok("3a. an interruption opens the new encounter", interrupted.ok,
    interrupted.ok ? "" : JSON.stringify(interrupted));
  ok("3b. and pauses the one it displaced", interrupted.ok && interrupted.data.paused === e1,
    JSON.stringify(interrupted.ok ? interrupted.data : interrupted));

  const first = await statusOf(e1);
  ok("3c. the displaced consultation is PAUSED, not lost", first?.status === "PAUSED", JSON.stringify(first));
  ok("3d. and it records WHAT interrupted it, so resuming is not guesswork",
    first?.interrupted_by_id === e2, JSON.stringify(first));
  ok("3e. exactly one encounter is active", (await activeEncounterId(admin, ws, USER)).id === e2);

  // s16: the queue is untouched. Asserted by counting it either side rather than by reading the code.
  await admin.from("practice_queue_entry").insert({ workspace_id: ws, patient_name: "Waiting Person", status: "WAITING" });
  const before = await admin.from("practice_queue_entry").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
  const carol = await patient("Carol Walkin");
  const e3 = await encounter(carol, at(9, 40));
  await interruptWith(admin, { workspaceId: ws, encounterId: e3, actorId: USER, practitionerId: USER, correlationId: CORR });
  const after = await admin.from("practice_queue_entry").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
  ok("3f. an interruption does not touch the waiting queue",
    before.count === after.count && (after.count ?? 0) > 0, `${before.count} -> ${after.count}`);

  // Resuming clears the marker: a consultation back in the room is not still interrupted.
  await move(e3, "COMPLETED");
  const resumed = await move(e2, "ACTIVE");
  ok("3g-control. the interrupting encounter can itself be resumed", resumed.ok,
    resumed.ok ? "" : JSON.stringify(resumed));
  await move(e2, "COMPLETED");
  await move(e1, "ACTIVE");
  ok("3g. resuming clears the interruption marker", (await statusOf(e1))?.interrupted_by_id === null);

  // ── 4. s6.2's metric clause, asserted through the METRIC ─────────────────────────────────────────
  //
  // ⚠ THIS IS THE ASSERTION THE WHOLE MIGRATION EXISTS FOR. metrics.ts subtracts PAUSED time from the
  // consult-time average, reading it out of the transition log -- and until something paused an
  // encounter that subtraction had nothing to subtract.
  //
  // ⚠ THE FIXTURE HAS TO BACKDATE THE LOG, AND THE FIRST VERSION DID NOT. The transitions above
  // happened milliseconds apart in real time while the encounters are backdated to this morning, so
  // every pause fell OUTSIDE its own consultation's window and metrics.ts correctly clipped it to
  // nothing. The assertion failed against working code because the fixture could not express the
  // situation it was describing. The three windows below are hand-checkable:
  //
  //   Alice  09:00-10:00 on the clock, paused 09:20-09:50  ->  60 - 30 = 30 min of consulting
  //   Bob    09:20-09:30                                   ->  10 min
  //   Carol  09:40-09:50                                   ->  10 min
  //   mean = (30 + 10 + 10) / 3 = 17.  If the pause were ignored it would be (60+10+10)/3 = 27.
  // Completed THROUGH THE ENGINE so the transition is legal and its event is emitted, then backdated.
  const closed = await move(e1, "COMPLETED");
  ok("4-setup. the interrupted consultation can be completed", closed.ok, JSON.stringify(closed));
  await admin.from("practice_encounter").update({ completed_at: at(10, 0) }).eq("id", e1);
  await admin.from("practice_encounter").update({ completed_at: at(9, 30) }).eq("id", e2);
  await admin.from("practice_encounter").update({ completed_at: at(9, 50) }).eq("id", e3);

  // Alice's pause, placed inside Alice's consultation. Written directly because the engine stamps
  // occurred_at with the real clock, which is the correct behaviour and the wrong thing for a fixture
  // describing a morning that has already happened.
  await admin.from("practice_encounter_status_history").delete().eq("encounter_id", e1);
  await admin.from("practice_encounter_status_history").insert([
    { workspace_id: ws, encounter_id: e1, from_status: "ACTIVE", to_status: "PAUSED", actor_id: USER, occurred_at: at(9, 20) },
    { workspace_id: ws, encounter_id: e1, from_status: "PAUSED", to_status: "ACTIVE", actor_id: USER, occurred_at: at(9, 50) },
  ]);

  const scope = metricScope({ date: today, timezone: TZ });
  const m = await practiceMetrics(admin, ctxFor(ws), scope);
  const avg = m.metrics.average_consult_time;
  ok("4a-control. the average is computed over all three consultations",
    avg.value !== null && avg.observations === 3, JSON.stringify([avg.value, avg.observations]));
  ok("4b. an interrupted consultation is NOT charged the interruption's minutes",
    avg.value === 17, `average ${avg.value} min -- 27 would mean the 30-minute pause was counted`);
  // ── 5. The domain events (s9) ────────────────────────────────────────────────────────────────────
  type EventRow = { event_type: string; encounter_id: string | null; payload: Record<string, unknown> };
  const { data: events, error: evErr } = await admin.from("practice_domain_event")
    .select("event_type, encounter_id, payload").eq("workspace_id", ws)
    .like("event_type", "encounter.%");
  ok("5-control. encounter events were written at all", !evErr && (events ?? []).length > 0,
    evErr?.message ?? `${(events ?? []).length} events`);
  const types = new Set(((events ?? []) as EventRow[]).map(e => e.event_type));
  ok("5a. starting, pausing and completing each announce themselves",
    ["encounter.started", "encounter.paused", "encounter.completed"].every(t => types.has(t)),
    [...types].join(", "));
  const pauseEvent = ((events ?? []) as EventRow[]).find(e => e.event_type === "encounter.paused" && e.payload?.interruptedBy);
  ok("5b. a pause caused by an interruption says what interrupted it",
    !!pauseEvent, JSON.stringify(((events ?? []) as EventRow[]).filter(e => e.event_type === "encounter.paused").map(e => e.payload)));

  await cleanup();
  report();
}

function ctxFor(workspaceId: string): WorkspaceContext {
  return {
    userId: USER, workspaceId, workspaceName: "H", workspaceType: "individual_practice",
    workspaceStatus: "active", roleCodes: ["owner"],
    capabilities: ["practice.home.view", "encounter.list", "practice.calendar.view", "followup.view"],
    entitled: true, entitlementStatus: "trial", onboardingComplete: true, onboardingStep: null,
  };
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
