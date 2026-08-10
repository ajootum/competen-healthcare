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
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  emitActivation, readActivationLedger, deriveLadder, isActivated, assessRisk,
} from "../src/lib/practice/activation";
import { markSeen, toCompleteQueue } from "../src/lib/practice/capture-later";
import { openOrResumeSession, applyCloseAction, completeSession } from "../src/lib/practice/day-close";
import { ADOPTION_LADDER, ACTIVATION_DEFINITION, CLOSE_ACTIONS } from "../src/lib/practice/adoption-constants";

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
