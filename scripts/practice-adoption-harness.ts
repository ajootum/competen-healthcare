/**
 * CPR-ADOPT-001 (Capture Later, Close My Day) + CPR-GROWTH-001 (activation telemetry).
 *
 * Run:  npx --yes tsx scripts/practice-adoption-harness.ts
 *
 * ⚠ THE RULES THIS FILE EXISTS TO KEEP ARE SAFETY RULES, NOT FEATURES:
 *   s7  a Seen status must not imply that anything clinical was reviewed
 *   s7  no destructive bulk completion of unresolved clinical exceptions
 *   s3  defer with reason, never silently mark incomplete information as complete
 *   s7  commercial telemetry must not carry patient clinical content
 * Each has an assertion below and each was proved able to fail.
 *
 * ⚠ FIXTURES ARE CLINICAL RECORDS. Every one is created with a recorded id and deleted BY THAT ID in a
 * finally block, never by clearing a table.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  emitActivation, readActivationLedger, deriveLadder, isActivated, assessRisk,
} from "../src/lib/practice/activation";
import { markSeen, toCompleteQueue } from "../src/lib/practice/capture-later";
import { openOrResumeSession, applyCloseAction, completeSession } from "../src/lib/practice/day-close";
import { ADOPTION_LADDER, ACTIVATION_DEFINITION, CLOSE_ACTIONS } from "../src/lib/practice/adoption-constants";
import { onAppointmentCreated, onSetupReadinessEvaluated, UNHOOKED_MILESTONES } from "../src/lib/practice/activation-hooks";

loadEnvConfig(process.cwd());

let pass = 0;
const failures: string[] = [];
const skips: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};
const skip = (id: string, msg: string) => { skips.push(id); console.log(`  SKIP  ${id}  ${msg}`); };

(async () => {
  console.log("\nPROGRESSIVE ADOPTION + ACTIVATION TELEMETRY\n");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { skip("*", "no Supabase service credentials"); process.exit(0); }
  const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

  const made: { table: string; id: string }[] = [];
  const cleanupKeys: string[] = [];
  let ws: string | null = null;
  let patient: string | null = null;
  let actor: string | null = null;

  try {
    // ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
    const { data: wsRows } = await admin.from("practice_workspace").select("id").limit(1);
    const { data: pRows } = await admin.from("practice_patient").select("id").limit(1);
    const { data: prof } = await admin.from("profiles").select("id").limit(1);
    ws = (wsRows ?? [])[0]?.id ?? null;
    patient = (pRows ?? [])[0]?.id ?? null;
    actor = (prof ?? [])[0]?.id ?? null;
    if (!ws || !actor) { skip("*", "no practice workspace or profile to build fixtures on"); process.exit(0); }

    // ── A. The activation ledger (GROWTH s2, s7) ────────────────────────────────────────────────────
    console.log("  -- A. activation ledger --");
    const testKey = "intelligence.first_action";  // the least likely to be emitted by real traffic
    cleanupKeys.push(testKey);
    await admin.from("practice_activation_event").delete().eq("workspace_id", ws).eq("event_key", testKey);

    const first = await emitActivation(admin, { workspaceId: ws, eventKey: testKey, actorId: actor });
    ok("A1", first.ok && first.recorded === true, `a milestone is recorded (${JSON.stringify(first)})`);

    const second = await emitActivation(admin, { workspaceId: ws, eventKey: testKey, actorId: actor });
    ok("A2", second.ok && second.recorded === false,
      "a second emission is idempotent -- recorded:false, not a duplicate row. An emitter may fire on every booking");

    const { count: dupes } = await admin.from("practice_activation_event")
      .select("id", { count: "exact" }).eq("workspace_id", ws).eq("event_key", testKey).limit(1);
    ok("A2b", dupes === 1, `...and exactly one row exists (${dupes})`);

    const unknown = await emitActivation(admin, { workspaceId: ws, eventKey: "not.a.milestone", actorId: actor });
    ok("A3", !unknown.ok && unknown.code === "UNKNOWN_EVENT",
      "an event key outside section 2's pipeline is refused, so the ledger cannot silently grow a vocabulary");

    // ⚠ THE SECTION 7 CONTROL. Commercial telemetry must not carry clinical content.
    for (const bad of ["patient_id", "diagnosis", "notes"]) {
      const r = await emitActivation(admin, {
        workspaceId: ws, eventKey: "booking.link_shared", actorId: actor, metadata: { [bad]: "x" },
      });
      if (!(r.ok === false && r.code === "CLINICAL_METADATA_REFUSED"))
        ok(`A4.${bad}`, false, `metadata key "${bad}" was NOT refused (${JSON.stringify(r)})`);
    }
    ok("A4", (await Promise.all(["patient_id", "diagnosis", "notes", "medication", "reason_for_visit"].map(k =>
        emitActivation(admin, { workspaceId: ws!, eventKey: "booking.link_shared", metadata: { [k]: "x" } }))))
        .every(r => !r.ok && r.code === "CLINICAL_METADATA_REFUSED"),
      "⚠ clinical metadata is REFUSED, not stripped -- stripping would let a caller believe it was recorded");

    // The control: benign metadata must still get through, or A4 is a function that refuses everything.
    cleanupKeys.push("booking.link_created");
    await admin.from("practice_activation_event").delete().eq("workspace_id", ws).eq("event_key", "booking.link_created");
    const benign = await emitActivation(admin, {
      workspaceId: ws, eventKey: "booking.link_created", actorId: actor, metadata: { source: "harness", channel: "qr" },
    });
    ok("A5-control", benign.ok === true, `CONTROL: ordinary metadata is accepted (${JSON.stringify(benign)})`);

    // The ledger read round-trips what was emitted -- otherwise every derivation below reasons over a list
    // that never reflects a write.
    const led = await readActivationLedger(admin, ws);
    ok("A6", led.ok && led.keys.includes(testKey) && !!led.at[testKey],
      `the ledger reads back what was emitted (${led.ok ? `${led.keys.length} milestone(s)` : "READ FAILED"})`);

    // ── B. The adoption ladder, derived (ADOPT s1) ──────────────────────────────────────────────────
    console.log("\n  -- B. the adoption ladder --");
    const ladder = deriveLadder({ keys: ["booking.first_received"], at: { "booking.first_received": "2026-01-01" } });
    ok("B0-control", ladder.length === ADOPTION_LADDER.length && ladder.length === 7,
      `count control: ${ladder.length} rungs derived`);
    ok("B1", ladder[0].state === "reached" && ladder[3].state === "not_reached",
      "a rung is reached only when its signal is in the ledger");

    // ⚠ THREE STATES. Stages 2 and 3 have signals section 2 never emits, and calling them not_reached would
    // tell a practitioner they had not done something nobody looked for.
    const noSignal = ladder.filter(r => r.state === "no_signal").map(r => r.stage);
    ok("B2", noSignal.length === 2 && noSignal.includes(2) && noSignal.includes(3),
      `rungs with no emittable signal say so rather than reading as failure (stages ${noSignal.join(", ")})`);

    ok("B3", isActivated({ keys: ACTIVATION_DEFINITION }) === true,
      "section 1's north star: all four defining events means activated");
    ok("B4-control", ACTIVATION_DEFINITION.every(missing =>
        !isActivated({ keys: ACTIVATION_DEFINITION.filter(k => k !== missing) })),
      "CONTROL: removing ANY ONE of the four defeats it -- activation is not a proxy or a payment");

    // ── C. Risk queue (GROWTH s4) ───────────────────────────────────────────────────────────────────
    console.log("\n  -- C. the customer success queue --");
    ok("C1", assessRisk({ ok: false, message: "down" }).state === "unknown",
      "⚠ an unreadable ledger is UNKNOWN, not red -- red sends somebody to tell a working practice it never onboarded");
    ok("C2", assessRisk({ ok: true, keys: [], at: {} }).state === "red"
          && assessRisk({ ok: true, keys: ["practice.setup_completed"], at: {} }).state === "amber"
          && assessRisk({ ok: true, keys: ["booking.first_received"], at: {} }).state === "green",
      "the three live rules resolve to red / amber / green over the ledger");

    // ── D. Capture Later (ADOPT s2, s7) ─────────────────────────────────────────────────────────────
    console.log("\n  -- D. Capture Later --");
    if (!patient) skip("D1-D4", "no practice_patient row to attach an encounter to");
    else {
      const seen = await markSeen(admin, { workspaceId: ws, patientId: patient, actorId: actor });
      if (!seen.ok) ok("D1", false, `markSeen failed: ${seen.message}`);
      else {
        made.push({ table: "practice_encounter", id: seen.data.encounterId });
        const { data: shell } = await admin.from("practice_encounter")
          .select("status, capture_mode, seen_at, seen_by, outcome, outcome_note, reason_for_visit")
          .eq("id", seen.data.encounterId).single();
        ok("D1", seen.data.created && shell.capture_mode === "capture_later" && shell.status === "DRAFT" && !!shell.seen_at,
          `one tap creates a DRAFT shell marked capture_later with a seen_at (${shell.status}/${shell.capture_mode})`);

        // ⚠ THE SECTION 7 ASSERTION. The shell must assert nothing clinical.
        ok("D2", !shell.outcome && !shell.outcome_note && !shell.reason_for_visit,
          "⚠ the shell carries NO clinical field -- a Seen status implies nothing was reviewed");

        const again = await markSeen(admin, { workspaceId: ws, patientId: patient, actorId: actor });
        ok("D3", again.ok && again.data.created === false && again.data.encounterId === seen.data.encounterId,
          "tapping Seen twice returns the SAME encounter -- one visit never becomes two rows in the queue");

        const q = await toCompleteQueue(admin, { workspaceId: ws });
        ok("D4", q.ok && q.items.some(i => i.encounterId === seen.data.encounterId && i.captureMode === "capture_later"),
          `the To Complete queue contains it and carries captureMode (${q.ok ? q.items.length : "READ FAILED"} item(s))`);

        // ── E. Close My Day (ADOPT s3, s7) ──────────────────────────────────────────────────────────
        console.log("\n  -- E. Close My Day --");
        const today = "2026-08-10";
        await admin.from("practice_day_close").delete().eq("workspace_id", ws).eq("practitioner_id", actor).eq("close_date", today);
        const s1 = await openOrResumeSession(admin, { workspaceId: ws, practitionerId: actor, closeDate: today, actorId: actor });
        if (!s1.ok) ok("E1", false, `session could not open: ${s1.message}`);
        else {
          made.push({ table: "practice_day_close", id: s1.data.id });
          ok("E1", s1.data.resumed === false, "a session opens");
          const s2 = await openOrResumeSession(admin, { workspaceId: ws, practitionerId: actor, closeDate: today, actorId: actor });
          ok("E2", s2.ok && s2.data.resumed === true && s2.data.id === s1.data.id,
            "...and re-opening RESUMES the same one -- s6 requires the batch to survive interruption");

          const noReason = await applyCloseAction(admin, {
            workspaceId: ws, encounterId: seen.data.encounterId, action: "defer", actorId: actor, sessionId: s1.data.id });
          ok("E3", !noReason.ok && noReason.code === "REASON_REQUIRED",
            "deferring with no reason is refused -- s3 allows defer WITH REASON, and a reasonless defer is a skip");

          const deferred = await applyCloseAction(admin, {
            workspaceId: ws, encounterId: seen.data.encounterId, action: "defer", actorId: actor,
            sessionId: s1.data.id, deferReason: "Awaiting the lab result" });
          const { data: afterDefer } = await admin.from("practice_encounter")
            .select("status, deferred_reason, capture_mode").eq("id", seen.data.encounterId).single();
          ok("E4", deferred.ok && afterDefer.status === "DRAFT" && afterDefer.deferred_reason === "Awaiting the lab result",
            "⚠ a deferral records the reason and completes NOTHING -- the encounter is still open");

          // ⚠ THE OTHER HALF OF SECTION 7. "No change" IS an explicit confirmation of review.
          const closed = await applyCloseAction(admin, {
            workspaceId: ws, encounterId: seen.data.encounterId, action: "no_change", actorId: actor, sessionId: s1.data.id });
          const { data: afterClose } = await admin.from("practice_encounter")
            .select("status, capture_mode, deferred_reason").eq("id", seen.data.encounterId).single();
          ok("E5", closed.ok && afterClose.status === "COMPLETED" && afterClose.capture_mode === "full" && !afterClose.deferred_reason,
            `"No change" is a confirmation: the encounter completes and stops being an unreviewed shell (${afterClose.status}/${afterClose.capture_mode})`);

          // ⚠ NO DESTRUCTIVE BULK COMPLETION. A second open shell must survive completing the session.
          const other = await markSeen(admin, { workspaceId: ws, patientId: patient, actorId: actor });
          if (other.ok && other.data.created) made.push({ table: "practice_encounter", id: other.data.encounterId });
          const done = await completeSession(admin, { workspaceId: ws, sessionId: s1.data.id, practitionerId: actor, actorId: actor });
          const { data: survivor } = await admin.from("practice_encounter")
            .select("status").eq("id", other.ok ? other.data.encounterId : "").maybeSingle();
          ok("E6", done.ok && survivor?.status === "DRAFT",
            "⚠ completing the session does NOT complete the encounters -- s7 forbids destructive bulk completion, so what is unresolved is still waiting");
          ok("E7", done.ok && done.data.stillOpen !== 0,
            `...and the count of what is still open is reported (${done.ok ? done.data.stillOpen : "?"}) rather than implying a finished day`);
        }
      }
    }

    // ── F. The action vocabulary ────────────────────────────────────────────────────────────────────
    console.log("\n  -- F. quick actions --");
    ok("F1", CLOSE_ACTIONS.filter(a => !a.confirmsReview).map(a => a.code).join(",") === "defer",
      "exactly one action -- defer -- does not confirm review. Every other quick action is a clinical assertion");

    // ── G. The screen is wired, and gated (the engine-with-no-screen pattern) ───────────────────────
    console.log("\n  -- G. wiring --");
    const strip = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
    const nav = strip(readFileSync("src/lib/practice/navigation.ts", "utf8"));
    const api = strip(readFileSync("src/app/api/v1/practice/day-close/route.ts", "utf8"));
    const page = strip(readFileSync("src/app/practice/(shell)/close-my-day/page.tsx", "utf8"));
    const console_ = strip(readFileSync("src/app/practice/(shell)/close-my-day/CloseMyDayConsole.tsx", "utf8"));

    ok("G1", /href: "\/practice\/close-my-day"/.test(nav),
      "the route is in the navigation -- an engine with no way in is the pattern this project keeps removing");

    // ⚠ THE FREEZE. CPR-V5-002 pinned PRIMARY_ORDER at nine sections and 16 assertions hold it there.
    const navLine = nav.split("\n").find(l => l.includes('"/practice/close-my-day"')) ?? "";
    ok("G2", /parent: "\/practice\/encounters"/.test(navLine) && !/primary: true/.test(navLine),
      "...as a CHILD of Encounters, not a tenth primary section -- the CPR-V5-002 freeze is untouched");

    ok("G3", /requirePracticeContext\("encounter\.edit"\)/.test(api) && /requirePracticeContext\("encounter\.list"\)/.test(api),
      "writes gate on encounter.edit and the queue read on encounter.list, at the API boundary");

    // ⚠ THE SECTION 7 STRUCTURAL ASSERTION. No verb may close everything.
    ok("G4", !/close_all|closeAll|bulkComplete/i.test(api) && !/close_all|closeAll/i.test(console_),
      "neither the route nor the screen has a close-all verb -- s7 forbids destructive bulk completion");

    ok("G5", /shell\.state !== "READY"/.test(page) && /hasCapability\(shell\.ctx, "encounter\.list"\)/.test(page),
      "the page narrows ShellState before reading ctx and checks the capability itself");

    // ⚠ AN UNREADABLE QUEUE MUST NOT RENDER AS AN EMPTY DAY, and that is a property of the screen.
    ok("G6", /queueFailed/.test(console_) && /not an empty day/i.test(console_),
      "the screen distinguishes a failed read from a finished day in so many words");


    // -- H. The emitters are wired to real write paths ---------------------------------------------
    console.log("\n-- H. activation emitters --");
    const WIRED: [string, string][] = [
      ["src/lib/practice/booking-rules.ts", "onAppointmentCreated"],
      ["src/lib/practice/scheduling.ts", "onAppointmentCreated"],
      ["src/lib/practice/follow-ups.ts", "onFollowUpCreated"],
      ["src/lib/practice/follow-up-plans.ts", "onFollowUpCreated"],
      ["src/lib/practice/day-close.ts", "onEncounterClosed"],
    ];
    const unwired = WIRED.filter(([file, hook]) => {
      const s = strip(readFileSync(file, "utf8"));
      // ⚠ A PLAIN STRING TEST, NOT A REGEX. `new RegExp(hook + "(admin")` reads the bracket as a capturing
      // GROUP, so it matches "onAppointmentCreatedadmin" and never the real call -- H1 would then have
      // reported every wired file as unwired, which reads as a finding rather than a broken assertion.
      return !(s.includes('from "./activation-hooks"') && s.includes(hook + "(admin"));
    }).map(([file]) => file);
    ok("H0-control", WIRED.length === 5, `count control: ${WIRED.length} write paths checked`);
    ok("H1", unwired.length === 0,
      `every write path emits its milestone${unwired.length ? " -- unwired: " + unwired.join(", ") : ""}`);

    // !! COUNT-BASED, NOT CALL-COUNTED. The hook is right however often it runs and whatever ran before
    // it -- a backfill or an import that never touched this code still moves the practice up the ladder.
    await admin.from("practice_activation_event").delete().eq("workspace_id", ws)
      .in("event_key", ["booking.first_received", "booking.tenth_received"]);
    cleanupKeys.push("booking.first_received", "booking.tenth_received");
    await onAppointmentCreated(admin, ws, actor);
    const { data: afterHook } = await admin.from("practice_activation_event")
      .select("event_key").eq("workspace_id", ws)
      .in("event_key", ["booking.first_received", "booking.tenth_received"]);
    const emitted = ((afterHook ?? []) as any[]).map(r => r.event_key);
    const { count: apptCount } = await admin.from("practice_appointment")
      .select("id", { count: "exact" }).eq("workspace_id", ws).limit(1);
    ok("H2", (apptCount ?? 0) >= 1 ? emitted.includes("booking.first_received") : emitted.length === 0,
      `emitted from the COUNT (${apptCount} appointment(s) -> ${emitted.join(", ") || "nothing"}), not from having been called`);

    // !! A HOOK THAT THROWS MUST NOT THROW. Telemetry can never fail the booking that triggered it.
    const throwingAdmin = { from: () => { throw new Error("down"); } };
    let threw = false;
    try { await onAppointmentCreated(throwingAdmin, ws, actor); } catch { threw = true; }
    ok("H3", threw === false, "a hook whose read throws does NOT throw out to its caller");

    // !! AND A FAILED COUNT EMITS NOTHING. Claiming a milestone the data cannot support is worse than
    // missing it -- the success queue would stop chasing a practice that never activated.
    const { count: tenth } = await admin.from("practice_activation_event")
      .select("id", { count: "exact" }).eq("workspace_id", ws)
      .eq("event_key", "booking.tenth_received").limit(1);
    ok("H4", (tenth ?? 0) === 0 || (apptCount ?? 0) >= 10,
      `no tenth-booking milestone without ten bookings (${tenth} row(s), ${apptCount} appointments)`);

    // ⚠ H3 AND H4 BOTH PASSED UNDER A DELIBERATE BREAK, AND THE REASON IS WORTH KEEPING. countFor has its
    // OWN try/catch, so the outer one in onAppointmentCreated is dead code for a throwing client -- H3 was
    // proving countFor's guard, not the one it named. And the only path where the count is null used a
    // client that ALSO failed the write, so "emit anyway" produced no row and looked correct.
    //
    // This stub fails ONLY the appointment count. The write path still works, so if a failed count ever
    // emits, the row appears and this goes red.
    const countBlind = {
      from: (table: string) => {
        if (table !== "practice_appointment") return admin.from(table);
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in", "order", "is"]) chain[m] = () => chain;
        chain.limit = async () => ({ data: null, count: null, error: { message: "simulated count outage" } });
        chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, count: null, error: { message: "simulated count outage" } });
        return chain;
      },
    };
    await admin.from("practice_activation_event").delete().eq("workspace_id", ws)
      .in("event_key", ["booking.first_received", "booking.tenth_received"]);
    await onAppointmentCreated(countBlind, ws, actor);
    const { count: afterBlind } = await admin.from("practice_activation_event")
      .select("id", { count: "exact" }).eq("workspace_id", ws)
      .in("event_key", ["booking.first_received", "booking.tenth_received"]).limit(1);
    ok("H4b", (afterBlind ?? 0) === 0,
      `⚠ a count that FAILED emits nothing (${afterBlind} row(s)) -- claiming a milestone the data cannot support is worse than missing it, because the success queue then stops chasing a practice that never activated`);

    // Restore the real state for anything downstream, and prove the same call DOES emit when it can count.
    await onAppointmentCreated(admin, ws, actor);
    const { count: afterReal } = await admin.from("practice_activation_event")
      .select("id", { count: "exact" }).eq("workspace_id", ws)
      .eq("event_key", "booking.first_received").limit(1);
    ok("H4c-control", (afterReal ?? 0) === 1,
      `CONTROL: the same hook against the real client DOES emit (${afterReal}) -- H4b is the failed count, not a hook that never emits`);

    // ⚠ THIS PINNED THE NUMBER 3 AND A GENUINE SUCCESS TURNED IT RED -- adding the share action took the
    // north-star gap from three events to one, and the assertion called that a failure. Same shape as
    // hq-guard E4 and access-scanner S1. J7 owns the count now, and this owns the property that actually
    // has to hold: an unhooked milestone must SAY WHY, or the list decays into bare names nobody can act
    // on and the gap stops being a decision.
    ok("H5", UNHOOKED_MILESTONES.length > 0 && UNHOOKED_MILESTONES.every(m => m.why.trim().length > 20),
      `every remaining unhooked milestone states why (${UNHOOKED_MILESTONES.length} left: ${UNHOOKED_MILESTONES.map(m => m.key).join(", ")})`);

    // -- I. Capture Later has a button --------------------------------------------------------------
    console.log("\n-- I. Capture Later has a button --");
    const sessionSrc = strip(readFileSync("src/lib/practice/session.ts", "utf8"));
    const cardSrc = strip(readFileSync("src/app/practice/(shell)/today/WaitingQueueCard.tsx", "utf8"));
    const wrapSrc = strip(readFileSync("src/app/practice/(shell)/today/QueueWithActions.tsx", "utf8"));
    const todaySrc = strip(readFileSync("src/app/practice/(shell)/today/page.tsx", "utf8"));

    // !! THE QUEUE DID NOT SELECT patient_id AT ALL -- it returned the queue-entry id and a denormalised
    // patient_name, so nothing could act on the patient. The button had nothing to attach to.
    ok("I1", sessionSrc.includes(`select("id, patient_id, patient_name`)
          && sessionSrc.includes("patientId: q.patient_id"),
      "waitingQueue selects patient_id and carries it through");

    ok("I2", cardSrc.includes("onMarkSeen && p.patientId &&"),
      "Seen is drawn only with a handler AND a patient to attach an encounter to");

    ok("I3", wrapSrc.includes(`op: "seen"`) && wrapSrc.includes("router.refresh()"),
      "the wrapper posts the seen op and refreshes, so the tick and the server figures cannot disagree");

    ok("I4", todaySrc.includes(`canCapture={hasCapability(shell.ctx, "encounter.edit")}`),
      "offered on encounter.edit -- and the route gates on it again, which is the actual control");


    // -- J. link_created and link_shared now have emitters --------------------------------------
    console.log("\n-- J. the share action --");
    const hooksSrc = strip(readFileSync("src/lib/practice/activation-hooks.ts", "utf8"));
    const accessSrc = strip(readFileSync("src/lib/practice/patient-access.ts", "utf8"));
    const idRoute = strip(readFileSync("src/app/api/v1/practice/identity/route.ts", "utf8"));
    const shareUi = strip(readFileSync("src/app/practice/(shell)/setup/identity/BookingAddressConsole.tsx", "utf8"));

    ok("J1", accessSrc.includes("if (goingLive) await onBookingLinkCreated("),
      "the booking link milestone fires when the page GOES LIVE -- not when a handle is claimed, which would credit a practice with an asset it cannot hand anybody");

    ok("J2", idRoute.includes('action === "recordShare"') && idRoute.includes("onBookingLinkShared("),
      "a share action exists at the API boundary and emits the milestone");

    // !! THE HONESTY CONSTRAINT, ASSERTED. The screen says nothing was sent, and the event must not
    // claim otherwise -- it records that the practitioner ACTED, which is what s2 calls it.
    ok("J3", shareUi.includes("Nothing was sent.") && shareUi.includes("recordShare("),
      "the screen still says nothing was sent, AND records the action -- the event is intent, never receipt");

    ok("J4", shareUi.includes('recordShare("qr_png")') && shareUi.includes('recordShare("print")') && shareUi.includes("recordShare(t.key)"),
      "every distribution affordance is instrumented -- copy, outbound targets, QR and print");

    // !! AND THE UNHOOKED LIST MUST SHRINK WITH THE CODE, or it becomes a stale apology.
    const stillUnhooked = UNHOOKED_MILESTONES.map(m => m.key);
    ok("J5", !stillUnhooked.includes("booking.link_shared") && !stillUnhooked.includes("booking.link_created"),
      `the unhooked list no longer claims these two (${stillUnhooked.join(", ")})`);

    ok("J6", hooksSrc.includes("export async function onBookingLinkShared") && hooksSrc.includes("metadata: via ?"),
      "the channel is recorded so copying a link stays distinguishable from printing a poster");

    // !! THE NORTH STAR IS NOW ONE EVENT AWAY, NOT THREE. Worth asserting the exact number so the
    // remaining gap cannot be misremembered in either direction.
    const nsGap = UNHOOKED_MILESTONES.map(m => m.key).filter(k => ACTIVATION_DEFINITION.includes(k));
    // ⚠ J7 PINNED "ONE REMAINING" AND DEFINING setup_completed TOOK IT TO ZERO -- the FOURTH time today a
    // genuine success turned a counted assertion red. The property worth holding is that the gap is
    // KNOWN and named, whatever its size, so that is what it says now.
    ok("J7", nsGap.every(k => UNHOOKED_MILESTONES.some(m => m.key === k)),
      `every north-star event without an emitter is named in UNHOOKED_MILESTONES (${nsGap.length ? nsGap.join(", ") : "none left -- all four can now fire"})`);

    // ── K. setup_completed, defined ─────────────────────────────────────────────────────────────────
    console.log("\n  -- K. the last milestone --");
    const K_WS = ws;
    const verdictEmits = async (v: "ready" | "ready_with_warnings" | "not_ready" | "cannot_say") => {
      await admin.from("practice_activation_event").delete()
        .eq("workspace_id", K_WS).eq("event_key", "practice.setup_completed");
      await onSetupReadinessEvaluated(admin, K_WS, v, actor);
      const { count } = await admin.from("practice_activation_event")
        .select("id", { count: "exact" }).eq("workspace_id", K_WS)
        .eq("event_key", "practice.setup_completed").limit(1);
      return (count ?? 0) > 0;
    };
    cleanupKeys.push("practice.setup_completed");

    ok("K1", (await verdictEmits("ready")) && (await verdictEmits("ready_with_warnings")),
      "a practice whose every publish BLOCKER passes is configured -- warnings do not stop it, which is what ready_with_warnings means");

    // ⚠ THE ONE THAT MATTERS. cannot_say means nothing failed and a blocker could NOT BE CHECKED.
    ok("K2", (await verdictEmits("cannot_say")) === false,
      "⚠ `cannot_say` does NOT emit -- marking a practice configured on a question nobody answered would stop the success queue chasing them");

    ok("K3", (await verdictEmits("not_ready")) === false,
      "and a failing blocker does not emit either");

    // ⚠ ONE OWNER PER DEFINITION. A second checklist here would drift from the one the booking page
    // actually enforces, and the drift would tell a practitioner they were set up while publish refused.
    const hooks2 = strip(readFileSync("src/lib/practice/activation-hooks.ts", "utf8"));
    ok("K4", !/LOCATION_ACTIVE|SESSION_BOOKABLE|APPOINTMENT_TYPE_LINKED/.test(hooks2)
          && /verdict !== "ready" && verdict !== "ready_with_warnings"/.test(hooks2),
      "the definition is publishReadiness's verdict, not a second checklist copied into the hooks");

    const bookingRoute = strip(readFileSync("src/app/api/v1/practice/booking-access/route.ts", "utf8"));
    const setupPage = strip(readFileSync("src/app/practice/(shell)/setup/availability-booking/page.tsx", "utf8"));
    ok("K5", bookingRoute.includes("onSetupReadinessEvaluated(") && setupPage.includes("onSetupReadinessEvaluated("),
      "wired at BOTH places readiness is evaluated -- the API the screen reads and the screen itself");

  } finally {
    for (const key of cleanupKeys)
      if (ws) await admin.from("practice_activation_event").delete().eq("workspace_id", ws).eq("event_key", key);
    for (const m of made.reverse()) await admin.from(m.table).delete().eq("id", m.id);
    const gone = await Promise.all(made.map(async m => {
      const { data } = await admin.from(m.table).select("id").eq("id", m.id).limit(1);
      return (data ?? []).length === 0;
    }));
    ok("Z1", gone.every(Boolean), `every fixture is deleted by id (${made.length} row(s))`);
  }

  console.log(`\n${failures.length ? "RED" : "ALL GREEN"}  ${pass} passed, ${failures.length} failed, ${skips.length} skipped`);
  if (failures.length) { console.log("\nFAILURES:"); failures.forEach(f => console.log("  " + f)); }
  process.exit(failures.length ? 1 : 0);
})();
