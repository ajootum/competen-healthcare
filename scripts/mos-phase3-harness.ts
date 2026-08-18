/**
 * CPR-CORE-MOS-001 PHASE 3 ACCEPTANCE — critical journey instrumentation.
 *
 * One journey at a time. Patient Booking is first because its attempt AND its outcome are both
 * observable server-side in one file, and because a correlation id already existed on the request.
 *
 * ⚠ SIGN IN WAS THE ORIGINAL CANDIDATE AND IS THE WRONG ONE, which is worth recording rather than
 * quietly not doing. Practice sign-in calls supabase.auth.signInWithPassword FROM THE CLIENT, so the
 * attempt and the failure never touch a server this code controls. Only the success is observable, in
 * the shell. A journey with successes and no attempts has no denominator — which is the exact defect
 * this whole substrate exists to remove, so instrumenting it that way would have been worse than
 * leaving it unmeasured and honest.
 *
 * WHAT THIS PROVES
 *
 *   P  the attempt/outcome pairing is STRUCTURAL, not a convention somebody has to remember
 *   L  a real emitted booking pair aggregates into the journey through the catalogue
 *   S  telemetry cannot decide the response, and cannot fail the booking
 *
 *   npx --yes tsx scripts/mos-phase3-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { FIXTURE_OWNER_PREFIX, cleanupOnKill } from "./_cleanup";
import { emitEvent, newCorrelationId, journeyOutcomes } from "../src/lib/mos/event";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
/* eslint-disable @typescript-eslint/no-explicit-any */
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0;
const failures: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};

const ROUTE = "src/app/api/v1/practice/appointments/route.ts";
const src = readFileSync(ROUTE, "utf8");
const inner = src.slice(src.indexOf("async function createAppointment"));

const FIXTURE_OWNER = `${FIXTURE_OWNER_PREFIX}0000-4000-8000-000000000314`;
let fixtureId: string | null = null;
async function dropFixture() {
  if (!fixtureId) return;
  await admin.from("practice_workspace").delete().eq("id", fixtureId);
  fixtureId = null;
}
cleanupOnKill(dropFixture);

async function main() {
  console.log("\nCPR-CORE-MOS-001 PHASE 3 — PATIENT BOOKING\n");

  // ── P · the pairing is structural ─────────────────────────────────────────
  // ⚠ THIS IS THE PIN THAT MATTERS MOST ON THIS PAGE. If a future return path inside the handler skips
  // its outcome event, attempts exceed outcomes and every booking success rate reads low FOREVER, with
  // nothing on any screen to show it is wrong. The invariant that prevents it is that the inner handler
  // cannot return a bare response at all.
  const bareReturns = (inner.match(/return NextResponse\./g) ?? []).length;
  ok("P1", bareReturns === 0,
    `⚠ no return inside the handler escapes the pairing — ${bareReturns} bare NextResponse returns (every one must be wrapped with its failureCode)`);

  const wrapped = (inner.match(/return \{\s*res:|return \{ res:/g) ?? []).length;
  ok("P2", wrapped >= 5,
    `control: ${wrapped} wrapped returns found — P1 passing over a file with no returns at all would prove nothing`);

  const started = (src.match(/eventName: "practice\.booking\.started"/g) ?? []).length;
  ok("P3", started === 1,
    `exactly one attempt is emitted per request — ${started} started emit(s)`);

  const outcomeEmits = (src.match(/practice\.booking\.(created|failed)/g) ?? []).length;
  ok("P4", outcomeEmits === 2,
    `exactly one outcome emit, branching to created or failed — ${outcomeEmits} outcome names`);

  // the outcome emit must sit AFTER the handler call and OUTSIDE any conditional return
  const callAt = src.indexOf("await createAppointment(req, auth)");
  const outcomeAt = src.indexOf('eventName: "practice.booking.created"');
  const returnResAt = src.lastIndexOf("return res;");
  ok("P5", callAt > 0 && outcomeAt > callAt && returnResAt > outcomeAt,
    "the outcome is emitted after the handler returns and before the response leaves, so no path can skip it");

  const codes = [...src.matchAll(/failureCode: "([A-Z_]+)"/g)].map(m => m[1]);
  ok("P6", codes.length >= 3 && new Set(codes).size === codes.length,
    `each validation failure carries its own stable code rather than an HTTP status — [${codes.join(", ")}]`);

  ok("P7", /failureCode: result\.code/.test(src),
    "an engine refusal reports the ENGINE's code, so a booking rule refusal is distinguishable from a validation one");

  // ── S · telemetry cannot decide the response ──────────────────────────────
  // ⚠ THE RESULT IS NEVER CAPTURED, WHICH IS STRONGER THAN "NEVER BRANCHED ON" AND ACTUALLY CHECKABLE.
  //
  // A first version looked for an emit result being assigned and then used in a condition within eighty
  // characters. The emit call on this route is a hundred and ten characters long, so the pattern could
  // never reach the `if` that followed it — the break-test planted exactly that code and the pin stayed
  // green. A distance heuristic is not an invariant. This route has no legitimate use for the result at
  // all, so the honest rule is that it may not hold one: with nothing captured, there is nothing to
  // branch on, and no regex has to be clever.
  const capturesResult = /=\s*await\s+emitEvent|if\s*\(\s*await\s+emitEvent|\(await\s+emitEvent[^)]*\)\s*\./.test(src);
  ok("S1", !capturesResult,
    "⚠ the emit result is never captured, so a telemetry failure cannot turn a successful booking into an error");

  ok("S2", /await emitEvent\(auth\.caller\.admin/.test(src),
    "the emitter uses the caller's own admin client rather than opening a second connection on a hot path");

  const emitSrc = readFileSync("src/lib/mos/event.ts", "utf8");
  ok("S3", /catch \(err\)/.test(emitSrc) && /return \{ ok: false/.test(emitSrc),
    "control: emitEvent catches and returns rather than throwing — S1 relies on it never rejecting");

  // ── L · a real pair aggregates through the catalogue ──────────────────────
  const created = await admin.from("practice_workspace").insert({
    name: "MOS phase 3 acceptance fixture", owner_person_id: FIXTURE_OWNER,
    country: "ZZ", timezone: "UTC",
  }).select("id").limit(1);
  if (created.error || !created.data?.[0]?.id) {
    ok("L", false, `could not create the fixture — ${String(created.error?.message).slice(0, 80)}`);
  } else {
    fixtureId = created.data[0].id as string;
    try {
      const okCorr = newCorrelationId();
      const base = { practiceId: fixtureId, correlationId: okCorr, component: "scheduling" } as const;
      await emitEvent(admin, { ...base, eventName: "practice.booking.started", outcome: "started" });
      await emitEvent(admin, { ...base, eventName: "practice.booking.created", outcome: "success", durationMs: 180 });

      const failCorr = newCorrelationId();
      const fbase = { practiceId: fixtureId, correlationId: failCorr, component: "scheduling" } as const;
      await emitEvent(admin, { ...fbase, eventName: "practice.booking.started", outcome: "started" });
      await emitEvent(admin, { ...fbase, eventName: "practice.booking.failed", outcome: "failure", failureCode: "SLOT_TAKEN", durationMs: 44 });

      const since = new Date(Date.now() - 3_600_000).toISOString();
      const counts = await journeyOutcomes(admin, "patient_booking", since);
      ok("L1", counts !== null && counts.attempts >= 2 && counts.successes >= 1 && counts.failures >= 1,
        `⚠ Patient Booking now reports ATTEMPTS, SUCCESSES AND FAILURES — ${counts?.attempts} attempted, ${counts?.successes} succeeded, ${counts?.failures} failed`);

      const jv = await admin.from("mos_journey_event")
        .select("journey_name, event_name, outcome, failure_code, correlation_id")
        .eq("correlation_id", failCorr);
      const jrows = (jv.error ? [] : jv.data) as { journey_name: string; failure_code: string | null }[];
      ok("L2", jrows.length === 2 && jrows.every(r => r.journey_name === "Patient Booking"),
        "both halves of one attempt resolve to the same journey through the catalogue, joined by their correlation id");

      ok("L3", jrows.some(r => r.failure_code === "SLOT_TAKEN"),
        "the failure reaches the journey view with its stable code, so a rate can be broken down by cause");

      ok("L4", counts !== null && counts.attempts >= counts.successes + counts.failures,
        "control: outcomes never exceed attempts — the pairing holds in the data, not only in the source");
    } finally {
      await dropFixture();
    }
  }

  const leftover = await admin.from("practice_workspace").select("id").eq("owner_person_id", FIXTURE_OWNER);
  ok("Z1", !leftover.error && (leftover.data ?? []).length === 0,
    "control: the fixture and its events cascaded away");

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
  if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
}

main().catch(async e => {
  await dropFixture();
  console.error("\nHARNESS CRASHED (the fixture was removed):", e);
  process.exit(1);
});
