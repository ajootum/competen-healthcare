/**
 * CPR-CORE-001 s9/s9.1 domain event outbox harness. Migration 233, backlog CORE-09.
 *
 * WHAT THIS HAS TO PROVE, beyond "a row appeared":
 *   - the TypeScript catalogue and the DATABASE's check constraint are the same list. A type that exists
 *     in one and not the other does not fail loudly: it fails on every emit of that type, forever, in an
 *     error the caller was designed to swallow. Every entry is emitted for real, and an invented one is
 *     refused by the database and not merely by the engine
 *   - the lifecycle emits BOTH halves of each transition -- s6.1's session event as well as the activity
 *     event -- because a card listening for the half that was never emitted stays stale silently
 *   - the envelope carries the right ids: practice, practitioner, actor, location, activity instance,
 *     session, source, version, and the instant the transition actually happened
 *   - s13's actor is present and is the CALLER. An event that defaults the actor to the subject is an
 *     audit trail that cannot see delegation, and it looks identical to a correct one
 *   - a switch closes the session it interrupted, so the log never shows two sessions open at once
 *   - A FAILED EMIT DOES NOT LOSE THE WRITE IT DESCRIBES. Proven against a genuinely broken outbox --
 *     one that rejects, and one that returns an error -- with the state change asserted on the stored
 *     row afterwards, and the failure asserted to be REPORTED rather than swallowed
 *   - tenancy: one practice's events are not another's, and a refused write emits nothing
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { startActivity, endActivity, planActivity, todaysPlan } from "../src/lib/practice/activity";
import {
  emitEvent, PRACTICE_EVENT_TYPES, EVENT_ENVELOPE_VERSION, type EventEnvelope,
} from "../src/lib/practice/events";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import type { WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, key, { auth: { persistSession: false } });

const ALL = ["practice.home.view", "appointment.manage", "task.view", "followup.view",
  "queue.manage", "inbox.record"];

const ctxFor = (workspaceId: string, userId: string, caps: string[] = ALL): WorkspaceContext => ({
  userId, workspaceId, workspaceName: "H", workspaceType: "individual_practice", workspaceStatus: "active",
  roleCodes: ["owner"], capabilities: caps, entitled: true, entitlementStatus: "trial",
  onboardingComplete: true, onboardingStep: null,
});

type EventRow = {
  id: string; workspace_id: string; event_type: string; version: number; occurred_at: string;
  recorded_at: string; practitioner_id: string; actor_id: string; source: string;
  location_id: string | null; activity_instance_id: string | null; session_id: string | null;
  patient_id: string | null; encounter_id: string | null; payload: Record<string, unknown>;
  published_at: string | null;
};

/** Events for one activity, oldest first. A read that FAILS is reported, never returned as "no events". */
async function eventsFor(activityId: string) {
  const { data, error } = await admin.from("practice_domain_event")
    .select("*").eq("activity_instance_id", activityId).order("recorded_at", { ascending: true });
  if (error) return { rows: [] as EventRow[], readFailed: true, detail: error.message };
  return { rows: (data ?? []) as EventRow[], readFailed: false, detail: "" };
}

async function main() {
  console.log("\n=== DOMAIN EVENT OUTBOX (CPR-CORE-001 s9, migration 233) ===\n");

  // -- CONTROL: the table exists at all. Without this every "no events" assertion below would pass
  // against an unapplied migration, and the suite would certify a feature that does not exist.
  const probe = await admin.from("practice_domain_event").select("id").limit(1);
  ok("0. control -- practice_domain_event exists and is queryable", !probe.error,
    probe.error?.message ?? "");
  if (probe.error) { report(); return; }

  // -- Fixture: two practices, provisioned through the real saga rather than inserted ----------------
  const userA = "00000000-0000-4000-8000-0000000ec901";
  const userB = "00000000-0000-4000-8000-0000000ec902";
  await cleanup(userA, userB);

  const provision = async (user: string, name: string, suffix: string) => {
    const { data: req, error } = await admin.from("provisioning_request").insert({
      idempotency_key: `harness-evt-${suffix}-${Date.now()}`, request_type: "pilot",
      actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-evt",
    }).select("id").single();
    if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
    const payload: IndividualRequest = {
      displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
      defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1",
      source: "pilot",
    };
    const run = await runProvisioning(admin,
      { id: req.id, target_user_id: user, correlation_id: "harness-evt", workspace_id: null }, payload);
    if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
    return run.workspaceId;
  };

  const wsA = await provision(userA, "Harness Events A", "a");
  const wsB = await provision(userB, "Harness Events B", "b");
  const ctxA = ctxFor(wsA, userA);
  const ctxB = ctxFor(wsB, userB);

  // ⚠ THIS CONTROL WAS DOING ITS JOB WHEN IT FAILED. It assumed provisioning creates the practice's first
  // location. It does not -- so `locationId` was null, and every assertion downstream that checks the
  // envelope carries the activity's location was comparing null with null and passing on nothing.
  //
  // The location is now CREATED here rather than hoped for. A control that depends on a side effect of
  // some other subsystem is a control that goes quiet the day that subsystem changes, which is the one
  // thing a control must never do.
  const { data: made, error: locErr } = await admin.from("practice_location")
    .insert({ workspace_id: wsA, name: "Harness Consulting Room", type: "clinic" })
    .select("id").single();
  ok("0a-control. the practice has a location for the envelope to carry",
    !locErr && !!made?.id, locErr?.message ?? "no location created");
  const locationId = (made?.id as string | undefined) ?? null;

  const today = (await todaysPlan(admin, ctxA)).date;
  const plan = (c: WorkspaceContext, title: string, s: number, e: number, loc: string | null = null) =>
    planActivity(admin, c, {
      activityType: "outpatient_clinic", title, planDate: today,
      plannedStartMinute: s, plannedEndMinute: e, locationId: loc,
    });

  // -- 1. Starting an activity announces it ---------------------------------------------------------
  const clinic = await plan(ctxA, "Events Morning Clinic", 8 * 60, 12 * 60, locationId);
  ok("1-setup. an activity can be planned", clinic.ok, clinic.ok ? "" : clinic.message);
  if (!clinic.ok) { report(); return; }

  const before = await eventsFor(clinic.value.id);
  ok("1a-control. nothing is announced before anything happens",
    !before.readFailed && before.rows.length === 0,
    before.readFailed ? before.detail : `${before.rows.length} rows`);

  const startAt = new Date();
  const started = await startActivity(admin, ctxA, clinic.value.id, { at: startAt, source: "system" });
  ok("1b-control. the activity actually started", started.ok, started.ok ? "" : started.message);
  ok("1c. and it reported no outbox trouble",
    started.ok && started.value.eventWarnings.length === 0,
    started.ok ? started.value.eventWarnings.join("; ") : "");

  const afterStart = await eventsFor(clinic.value.id);
  ok("1d. starting writes an event", !afterStart.readFailed && afterStart.rows.length > 0,
    afterStart.readFailed ? afterStart.detail : "no events written");

  const startTypes = afterStart.rows.map(r => r.event_type).sort();
  // BOTH HALVES. s6.1 requires the session event; s7 has different cards watching each. Emitting one is
  // the failure that leaves a card stale with nothing anywhere reporting it.
  ok("1e. starting announces BOTH activity.started and session.started",
    startTypes.join() === "activity.started,session.started", startTypes.join() || "nothing");

  const ev = afterStart.rows.find(r => r.event_type === "activity.started");
  ok("1f. the envelope is scoped to the practice", !!ev && ev.workspace_id === wsA, ev?.workspace_id ?? "-");
  ok("1g. it says whose work it is", !!ev && ev.practitioner_id === userA, ev?.practitioner_id ?? "-");
  // s13: the actor, and NOT a default. Nothing else in the row would reveal a wrong one.
  ok("1h. it carries the actor who caused it", !!ev && ev.actor_id === userA, ev?.actor_id ?? "-");
  ok("1i. it points at the activity instance",
    !!ev && ev.activity_instance_id === clinic.value.id, ev?.activity_instance_id ?? "-");
  ok("1j. and at the session, which is the same row in this build",
    !!ev && ev.session_id === clinic.value.id, ev?.session_id ?? "-");
  ok("1k. it carries the location the activity is at",
    !!ev && ev.location_id === locationId, `${ev?.location_id} vs ${locationId}`);
  // The channel is the CALLER's, not a constant. A hardcoded "web" fails here.
  ok("1l. it records the source the caller declared, not a hardcoded one",
    !!ev && ev.source === "system", ev?.source ?? "-");
  ok("1m. it carries the envelope version", !!ev && ev.version === EVENT_ENVELOPE_VERSION,
    String(ev?.version));
  ok("1n. occurred_at is when the transition happened, not when the row was written",
    !!ev && Date.parse(ev.occurred_at) === startAt.getTime(),
    `${ev?.occurred_at} vs ${startAt.toISOString()}`);
  ok("1o. the payload carries what the type-specific consumer needs",
    !!ev && ev.payload?.title === "Events Morning Clinic", JSON.stringify(ev?.payload));
  // Nothing has dispatched it. A row that claimed delivery at insert time would hand the first real
  // dispatcher an empty backlog.
  ok("1p. the event is unpublished, because nothing has carried it yet",
    !!ev && ev.published_at === null, String(ev?.published_at));

  // -- 2. Ending announces the close ----------------------------------------------------------------
  const endAt = new Date(startAt.getTime() + 60000);
  const ended = await endActivity(admin, ctxA, clinic.value.id, { at: endAt, source: "system" });
  ok("2a-control. the activity actually ended", ended.ok, ended.ok ? "" : ended.message);
  ok("2b-control. and reported no outbox trouble",
    ended.ok && ended.value.eventWarnings.length === 0,
    ended.ok ? ended.value.eventWarnings.join("; ") : "");

  const afterEnd = await eventsFor(clinic.value.id);
  const endTypes = afterEnd.rows.map(r => r.event_type).filter(t => t.endsWith("completed") || t === "session.closed").sort();
  ok("2c. ending announces BOTH activity.completed and session.closed",
    endTypes.join() === "activity.completed,session.closed", endTypes.join() || "nothing");
  ok("2d. the four lifecycle events are all there and none was overwritten",
    afterEnd.rows.length === 4, `${afterEnd.rows.length}: ${afterEnd.rows.map(r => r.event_type).join()}`);

  const closeEv = afterEnd.rows.find(r => r.event_type === "session.closed");
  ok("2e. the close carries the same session id as the open",
    !!closeEv && closeEv.session_id === clinic.value.id, closeEv?.session_id ?? "-");
  ok("2f. and the instant it closed", !!closeEv && Date.parse(closeEv.occurred_at) === endAt.getTime(),
    `${closeEv?.occurred_at} vs ${endAt.toISOString()}`);

  // -- 3. A switch closes the session it interrupted ------------------------------------------------
  //
  // The log must never show two sessions open. Starting the round while the clinic runs is the ordinary
  // way through a day, and the close of the first is emitted by the switch or by nobody.
  const clinic2 = await plan(ctxA, "Switch Clinic", 9 * 60, 11 * 60, locationId);
  const round = await plan(ctxA, "Switch Ward Round", 11 * 60, 13 * 60, locationId);
  ok("3-setup. two activities are planned", clinic2.ok && round.ok);
  if (clinic2.ok && round.ok) {
    const s1 = await startActivity(admin, ctxA, clinic2.value.id, { source: "system" });
    const s2 = await startActivity(admin, ctxA, round.value.id, { source: "system" });
    ok("3a-control. the switch happened", s1.ok && s2.ok && s2.value.endedPrevious === clinic2.value.id,
      JSON.stringify(s2));

    const firstEvents = await eventsFor(clinic2.value.id);
    const firstTypes = firstEvents.rows.map(r => r.event_type).sort();
    ok("3b. the interrupted session is announced as closed, not left open",
      firstTypes.join() === "activity.completed,activity.started,session.closed,session.started",
      firstTypes.join() || "nothing");

    const switchClose = firstEvents.rows.find(r => r.event_type === "activity.completed");
    ok("3c. and the close says what interrupted it",
      !!switchClose && switchClose.payload?.reason === "switched"
      && switchClose.payload?.switchedToActivityId === round.value.id,
      JSON.stringify(switchClose?.payload));

    await endActivity(admin, ctxA, round.value.id, { source: "system" });

    // The balance assertion, over everything this practitioner did: every session that opened, closed.
    const { data: all, error: allErr } = await admin.from("practice_domain_event")
      .select("event_type").eq("workspace_id", wsA).eq("practitioner_id", userA);
    const rows = (all ?? []) as { event_type: string }[];
    const opens = rows.filter(r => r.event_type === "session.started").length;
    const closes = rows.filter(r => r.event_type === "session.closed").length;
    ok("3d. every session that opened has been announced closed", !allErr && opens > 0 && opens === closes,
      allErr?.message ?? `${opens} opened, ${closes} closed`);
  }

  // -- 4. A FAILED EMIT DOES NOT LOSE THE WRITE IT DESCRIBES ----------------------------------------
  //
  // Injected at the boundary the engine actually uses: an admin client that behaves normally except that
  // the outbox is broken. Two failure modes, because they take different code paths -- a transport
  // failure REJECTS (this is what a dropped connection or a broken TLS chain looks like from fetch), and
  // a rejected insert RESOLVES with an error. Neither may cost the practitioner the clinic.
  const outboxRejects = {
    from: (table: string) => table === "practice_domain_event"
      ? { insert: () => ({ select: () => ({ maybeSingle: () => Promise.reject(new Error("fetch failed")) }) }) }
      : admin.from(table),
  };
  const outboxErrors = {
    from: (table: string) => table === "practice_domain_event"
      ? {
        insert: () => ({
          select: () => ({
            maybeSingle: async () => ({ data: null, error: { message: "permission denied for table" } }),
          }),
        }),
      }
      : admin.from(table),
  };

  const brokenA = await plan(ctxA, "Broken Outbox Clinic", 14 * 60, 16 * 60, locationId);
  ok("4-setup. an activity is planned for the broken-outbox run", brokenA.ok);
  if (brokenA.ok) {
    const startBroken = await startActivity(outboxRejects, ctxA, brokenA.value.id, { source: "system" });
    ok("4a. an outbox that REJECTS does not fail the start", startBroken.ok,
      startBroken.ok ? "" : `${startBroken.code} ${startBroken.message}`);
    // The state change is asserted on the stored row, not on the return value: the claim is that the
    // work survived, and only the row can say so.
    const { data: row, error: rowErr } = await admin.from("practice_activity")
      .select("started_at").eq("id", brokenA.value.id).maybeSingle();
    ok("4b. and the activity really did start", !rowErr && !!row?.started_at,
      rowErr?.message ?? "started_at is null");
    // ...but it was REPORTED. A swallowed failure would make a broken outbox look like a quiet practice.
    ok("4c. the failure is reported rather than swallowed",
      startBroken.ok && startBroken.value.eventWarnings.length === 2
      && startBroken.value.eventWarnings.every(w => w.includes("EMIT_THREW")),
      startBroken.ok ? JSON.stringify(startBroken.value.eventWarnings) : "");
    const noneWritten = await eventsFor(brokenA.value.id);
    ok("4d-control. and no event was written, so 4a-4c are not passing on a working outbox",
      !noneWritten.readFailed && noneWritten.rows.length === 0,
      noneWritten.readFailed ? noneWritten.detail : `${noneWritten.rows.length} rows`);

    const endBroken = await endActivity(outboxErrors, ctxA, brokenA.value.id, { source: "system" });
    ok("4e. an outbox that returns an ERROR does not fail the end", endBroken.ok,
      endBroken.ok ? "" : `${endBroken.code} ${endBroken.message}`);
    const { data: row2, error: row2Err } = await admin.from("practice_activity")
      .select("ended_at").eq("id", brokenA.value.id).maybeSingle();
    ok("4f. and the activity really did end", !row2Err && !!row2?.ended_at,
      row2Err?.message ?? "ended_at is null");
    ok("4g. with the failure reported, naming the emit rather than the operation",
      endBroken.ok && endBroken.value.eventWarnings.length === 2
      && endBroken.value.eventWarnings.every(w => w.includes("EMIT_FAILED")),
      endBroken.ok ? JSON.stringify(endBroken.value.eventWarnings) : "");
  }

  // -- 5. The engine's catalogue and the database's are the same list -------------------------------
  //
  // THE BUG CLASS THIS CLOSES. `event_type` is a string compared against a CHECK constraint. A name in
  // the TypeScript union that the constraint does not accept never surfaces: every emit of that type
  // returns an error the caller is designed to swallow, and the card that waited for it simply never
  // updates. Emitted for real, one per type, against the real table.
  const rejected: string[] = [];
  for (const type of PRACTICE_EVENT_TYPES) {
    const result = await emitEvent(admin, {
      eventType: type, practiceId: wsA, practitionerId: userA, actorId: userA, source: "system",
      payload: { catalogueProbe: true },
    });
    if (!result.ok) rejected.push(`${type}: ${result.code} ${result.message}`);
  }
  ok("5a. every event type in the s9 catalogue is accepted by the database",
    rejected.length === 0, rejected.join("; "));
  ok("5a-control. the catalogue is s9's, complete", PRACTICE_EVENT_TYPES.length === 34,
    `${PRACTICE_EVENT_TYPES.length} types`);

  // And the constraint is real: a type nobody wrote a consumer for is refused by the DATABASE, not just
  // by the engine's own list. Written raw, bypassing every check in events.ts.
  const rawBad = await admin.from("practice_domain_event").insert({
    workspace_id: wsA, event_type: "activity.invented", practitioner_id: userA, actor_id: userA,
    source: "system",
  });
  ok("5b. the DATABASE refuses a type outside the catalogue, not just the engine",
    !!rawBad.error && rawBad.error.code === "23514",
    rawBad.error ? `expected 23514, got ${rawBad.error.code}` : "the write SUCCEEDED");

  const badSource = await admin.from("practice_domain_event").insert({
    workspace_id: wsA, event_type: "activity.started", practitioner_id: userA, actor_id: userA,
    source: "carrier pigeon",
  });
  ok("5c. and refuses a channel s9.1 does not name",
    !!badSource.error && badSource.error.code === "23514",
    badSource.error ? `expected 23514, got ${badSource.error.code}` : "the write SUCCEEDED");

  // -- 6. s13: an event without an actor is refused, not defaulted ----------------------------------
  const base: EventEnvelope = {
    eventType: "activity.started", practiceId: wsA, practitionerId: userA, actorId: userA,
    source: "system",
  };
  const noActor = await emitEvent(admin, { ...base, actorId: "" });
  ok("6a. an event with no actor is REFUSED rather than attributed to the subject",
    !noActor.ok && noActor.code === "ACTOR_REQUIRED", JSON.stringify(noActor));
  const noPractitioner = await emitEvent(admin, { ...base, practitionerId: "" });
  ok("6b. an event that says whose work it is not is refused",
    !noPractitioner.ok && noPractitioner.code === "PRACTITIONER_REQUIRED", JSON.stringify(noPractitioner));
  const noPractice = await emitEvent(admin, { ...base, practiceId: "" });
  ok("6c. an unscoped event is refused", !noPractice.ok && noPractice.code === "PRACTICE_REQUIRED",
    JSON.stringify(noPractice));
  // Each refusal needs its control, or an emitEvent that refused everything would pass all three.
  const good = await emitEvent(admin, base);
  ok("6-control. the same envelope with an actor is written", good.ok,
    good.ok ? "" : `${good.code} ${good.message}`);
  // NEVER THROWS. The insert below is malformed at the database level (an unparseable uuid), which is a
  // path the engine's own validation does not cover; it must still come back as a value.
  let threw = false;
  const malformed = await emitEvent(admin, { ...base, patientId: "not-a-uuid" }).catch(() => {
    threw = true; return { ok: false as const, code: "THREW", message: "threw" };
  });
  ok("6d. a database-level failure comes back as a value, never as an exception",
    !threw && !malformed.ok && malformed.code === "EMIT_FAILED", JSON.stringify(malformed));

  // -- 7. Tenancy ------------------------------------------------------------------------------------
  const bClinic = await plan(ctxB, "B's events clinic", 9 * 60, 12 * 60);
  ok("7-setup. practice B can plan its own activity", bClinic.ok, bClinic.ok ? "" : bClinic.message);
  if (bClinic.ok) {
    const bStart = await startActivity(admin, ctxB, bClinic.value.id, { source: "system" });
    ok("7a-control. practice B's activity starts and is announced", bStart.ok,
      bStart.ok ? "" : bStart.message);

    const { data: aRows, error: aErr } = await admin.from("practice_domain_event")
      .select("id, workspace_id").eq("workspace_id", wsA);
    ok("7b. every event under practice A belongs to practice A",
      !aErr && (aRows ?? []).length > 0
      && ((aRows ?? []) as EventRow[]).every(r => r.workspace_id === wsA),
      aErr?.message ?? `${(aRows ?? []).length} rows`);

    const { data: bRows, error: bErr } = await admin.from("practice_domain_event")
      .select("id, activity_instance_id").eq("workspace_id", wsB);
    ok("7c. practice B's events are B's alone and do not appear under A",
      !bErr && (bRows ?? []).length === 2
      && ((bRows ?? []) as EventRow[]).every(r => r.activity_instance_id === bClinic.value.id),
      bErr?.message ?? `${(bRows ?? []).length} rows`);

    // A refused cross-practice write must emit NOTHING. An outbox that announced attempts rather than
    // facts would let practice A's failed reach into B show up in B's feed.
    const cross = await startActivity(admin, ctxA, bClinic.value.id, { source: "system" });
    ok("7d-control. reaching into another practice is refused",
      !cross.ok && cross.code === "NOT_FOUND", JSON.stringify(cross));
    const { data: bAfter } = await admin.from("practice_domain_event").select("id").eq("workspace_id", wsB);
    ok("7e. and the refusal announced nothing", (bAfter ?? []).length === 2,
      `${(bAfter ?? []).length} rows`);
  }

  // -- 8. The read pattern the indexes exist for ----------------------------------------------------
  const { data: newest, error: newestErr } = await admin.from("practice_domain_event")
    .select("id, occurred_at").eq("workspace_id", wsA)
    .order("occurred_at", { ascending: false }).limit(5);
  const times = ((newest ?? []) as EventRow[]).map(r => Date.parse(r.occurred_at));
  ok("8a. one practice's events read newest first", !newestErr && times.length > 1
    && times.every((t, i) => i === 0 || times[i - 1] >= t), newestErr?.message ?? times.join(","));

  const { data: typed, error: typedErr } = await admin.from("practice_domain_event")
    .select("event_type").eq("workspace_id", wsA).eq("event_type", "session.closed");
  ok("8b. and by event type", !typedErr && (typed ?? []).length > 0
    && ((typed ?? []) as EventRow[]).every(r => r.event_type === "session.closed"),
    typedErr?.message ?? `${(typed ?? []).length} rows`);

  await cleanup(userA, userB);
  report();
}

/** Idempotent teardown, run before AND after: a harness that cannot be run twice is run once. */
async function cleanup(...users: string[]) {
  for (const u of users) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      // Explicit, though workspace_id cascades: if the workspace delete below ever fails, events for a
      // practice that no longer exists are exactly what must not be left behind.
      await admin.from("practice_domain_event").delete().eq("workspace_id", w.id);
      await admin.from("practice_activity").delete().eq("workspace_id", w.id);
      await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
    }
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, users);
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
