/**
 * CPR-CORE-MOS-001 PHASE 3 ACCEPTANCE — critical journey instrumentation.
 *
 * One journey at a time. Patient Booking was first because its attempt AND its outcome are both
 * observable server-side in one file, and because a correlation id already existed on the request.
 * Start Encounter is the second, on the same shape.
 *
 * ⚠ SIGN IN WAS THE ORIGINAL CANDIDATE AND IS THE WRONG ONE, which is worth recording rather than
 * quietly not doing. Practice sign-in calls supabase.auth.signInWithPassword FROM THE CLIENT, so the
 * attempt and the failure never touch a server this code controls. Only the success is observable, in
 * the shell. A journey with successes and no attempts has no denominator — the exact defect this whole
 * substrate exists to remove — so instrumenting it that way would be worse than leaving it unmeasured.
 *
 * WHAT THIS PROVES
 *
 *   P  the attempt/outcome pairing is STRUCTURAL, not a convention somebody has to remember
 *   S  telemetry cannot decide the response, and cannot fail the request
 *   L  a real emitted pair aggregates into the journey through the catalogue
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

/**
 * Every instrumented journey, and the route that emits it.
 *
 * ⚠ TABLE-DRIVEN SO THE INVARIANTS CANNOT BE HALF-APPLIED. Copying the pin block per route is how the
 * third route ends up with four of the nine checks: the copy is made from the second, and whichever pin
 * was added last is the one that does not travel. Adding a row here subjects a new route to all of them.
 */
const INSTRUMENTED = [
  {
    journey: "patient_booking",
    route: "src/app/api/v1/practice/appointments/route.ts",
    handler: "createAppointment",
    attempt: "practice.booking.started",
  },
  {
    journey: "start_encounter",
    route: "src/app/api/v1/practice/encounters/route.ts",
    handler: "startEncounter",
    attempt: "practice.encounter.started",
  },
  {
    journey: "create_follow_up",
    route: "src/app/api/v1/practice/follow-ups/route.ts",
    handler: "makeFollowUp",
    attempt: "practice.followup.attempted",
  },
  {
    journey: "issue_document",
    route: "src/app/api/v1/practice/documents/route.ts",
    handler: "makeDocument",
    attempt: "practice.document.issue_attempted",
  },
  {
    // ⚠ THE ONLY ROUTE SO FAR WHOSE GUARD IS INSIDE A BRANCH. It parses the body first and then chooses
    // between a note save (encounter.edit) and a transition (encounter.sign), so the wrapper goes round
    // the BRANCH. Emitting at the top would put an event before a guard, which S3 forbids.
    journey: "save_encounter",
    route: "src/app/api/v1/practice/encounters/[encounterId]/route.ts",
    handler: "saveEncounterNote",
    attempt: "practice.encounter.save_attempted",
    method: "PATCH",
  },
  {
    // ⚠ ONE CASE OF A TEN-ACTION SWITCH. Only this branch is a critical journey; the other nine are
    // billing actions, and instrumenting them here would put nine more event streams into a table
    // nobody asked to aggregate.
    journey: "generate_invoice",
    route: "src/app/api/v1/practice/billing/route.ts",
    handler: "generateInvoice",
    attempt: "practice.invoice.generate_attempted",
  },
] as const;

const FIXTURE_OWNER = `${FIXTURE_OWNER_PREFIX}0000-4000-8000-000000000314`;
let fixtureId: string | null = null;
async function dropFixture() {
  if (!fixtureId) return;
  await admin.from("practice_workspace").delete().eq("id", fixtureId);
  fixtureId = null;
}
cleanupOnKill(dropFixture);

const escapeDots = (s: string) => s.split(".").join("\\.");

async function main() {
  console.log("\nCPR-CORE-MOS-001 PHASE 3 — INSTRUMENTED JOURNEYS\n");

  // ── P · the pairing is structural, on EVERY instrumented route ────────────
  // ⚠ THE PIN THAT MATTERS MOST. If a future return path skips its outcome event, attempts exceed
  // outcomes and that journey's success rate reads low FOREVER, with nothing on any screen to show it is
  // wrong. The invariant that prevents it is that the inner handler cannot return a bare response at all.
  for (const r of INSTRUMENTED) {
    const src = readFileSync(r.route, "utf8");
    const inner = src.slice(src.indexOf(`async function ${r.handler}`));
    const tag = r.journey;

    // ⚠ EVERY RETURN MUST BE THE PAIRED SHAPE, NOT MERELY "NOT NextResponse.json". The first version
    // counted bare NextResponse returns, which is only the same thing while every route builds its
    // responses inline. The billing route returns through bad() and respond() helpers, so that pin
    // would have passed over a handler with no pairing in it at all. What the invariant actually says
    // is that the handler returns { res, failureCode } and nothing else.
    const escapes = (inner.match(/\breturn (?!\{)/g) ?? []).length;
    ok(`P1:${tag}`, escapes === 0,
      `every return inside ${r.handler} carries its failure code — ${escapes} escape the paired shape`);

    const wrapped = (inner.match(/return \{ res:/g) ?? []).length;
    ok(`P2:${tag}`, wrapped >= 2,
      `control: ${wrapped} wrapped returns — P1 over a file with no returns would prove nothing`);

    const attempts = (src.match(new RegExp(`eventName: "${escapeDots(r.attempt)}"`, "g")) ?? []).length;
    ok(`P3:${tag}`, attempts === 1,
      `exactly one attempt event name is declared — ${attempts}`);

    const emitCount = (src.match(/await emitEvent\(/g) ?? []).length;
    ok(`P4:${tag}`, emitCount === 2,
      `exactly two emits: one attempt, one outcome — ${emitCount}`);

    const callAt = src.indexOf(`await ${r.handler}(`);
    const lastEmitAt = src.lastIndexOf("await emitEvent(");
    const returnResAt = src.lastIndexOf("return res;");
    ok(`P5:${tag}`, callAt > 0 && lastEmitAt > callAt && returnResAt > lastEmitAt,
      "the outcome is emitted after the handler returns and before the response leaves, so no path skips it");

    const codes = [...src.matchAll(/failureCode: "([A-Z_]+)"/g)].map(m => m[1]);
    // ⚠ RELAXED FROM "at least two literal codes", WHICH WAS TRUE OF THE FIRST FOUR ROUTES BY
    // COINCIDENCE. Save Encounter validates nothing of its own — every failure it can have comes from
    // the engine — so demanding literal codes would have forced an invented taxonomy onto a route that
    // honestly has none. What must hold is that no two failures share a code.
    ok(`P6:${tag}`, new Set(codes).size === codes.length,
      `no two validation failures share a code — [${codes.join(", ") || "none, all failures come from the engine"}]`);

    ok(`P7:${tag}`, /failureCode:[^,}\n]*result\.code/.test(src),
      "an engine refusal reports the ENGINE's code, so it is distinguishable from a validation failure");

    // ⚠ THE RESULT IS NEVER CAPTURED, WHICH IS STRONGER THAN "NEVER BRANCHED ON" AND ACTUALLY CHECKABLE.
    // A first version looked for an emit result assigned and then used in a condition within eighty
    // characters. The emit call is a hundred and ten characters long, so the pattern could never reach
    // the `if` that followed — the break-test planted exactly that code and the pin stayed GREEN. A
    // distance heuristic is not an invariant. These routes have no legitimate use for the result at all,
    // so the rule is that they may not hold one: nothing captured, nothing to branch on.
    const captures = /=\s*await\s+emitEvent|if\s*\(\s*await\s+emitEvent/.test(src);
    ok(`S1:${tag}`, !captures,
      "⚠ the emit result is never captured, so a telemetry failure cannot fail the request");

    // ⚠ EITHER SPELLING OF THE SAME CLIENT. The billing route destructures `const { caller } = auth`,
    // so it passes caller.admin where the others pass auth.caller.admin — the identical connection,
    // reached differently. Requiring one spelling made the pin a style rule; what it must actually
    // forbid is opening a SECOND client on a request path, which the second half checks.
    const usesRequestClient = /await emitEvent\((?:auth\.)?caller\.admin/.test(src);
    const opensOwnClient = /emitEvent\(\s*createAdminClient/.test(src);
    ok(`S2:${tag}`, usesRequestClient && !opensOwnClient,
      "the emitter uses the caller's own admin client rather than opening a second connection on a hot path");

    // ⚠ POSITION CHECKS RUN INSIDE THE POST HANDLER, NOT OVER THE WHOLE FILE, and it took two wrong
    // pins to get here. The first compared indexOf("emitEvent") against the guard — and the first
    // occurrence of that name is the IMPORT at line three, above everything. The second compared the
    // emit CALL against indexOf("isDenied") — and the first of those belongs to the GET handler near
    // the top, so an emit planted above POST's guard still measured as "after a guard" and the
    // break-test passed while the plant sat there. Both were the same error: an anchor that matches
    // somewhere other than the region being reasoned about. `post` is that region.
    const method = ("method" in r ? r.method : "POST") as string;
    const post = src.slice(src.indexOf(`export async function ${method}`), src.indexOf(`async function ${r.handler}`));
    const firstEmitCall = post.indexOf("await emitEvent(");
    const guardAt = post.indexOf("isDenied(auth)) return auth");
    // ⚠ THE CLOCK MUST START AFTER THE ATTEMPT EMIT, AND THIS PIN EXISTS BECAUSE IT DID NOT.
    //
    // Every route originally set startedAt above the attempt emit, so every journey's duration included
    // the round trip that RECORDED the attempt. A validation failure returning immediately reported
    // 440ms — almost all of it telemetry. The instrumentation was measuring itself, and inflating the
    // latency of the journeys it exists to observe.
    //
    // Nothing in the source looked wrong; the numbers were plausible. It took opening the screen and
    // asking why a missing-field rejection took nearly half a second.
    const clockAt = src.indexOf("const startedAt = Date.now();");
    const attemptEmitAt = src.indexOf('outcome: "started"');
    ok(`T1:${tag}`, clockAt > 0 && attemptEmitAt > 0 && clockAt > attemptEmitAt,
      "⚠ the duration clock starts AFTER the attempt is recorded, so a journey's latency is the journey and not the telemetry");

    ok(`S3:${tag}`, post.length > 0 && guardAt >= 0 && firstEmitCall > guardAt,
      `nothing is emitted before ${method}'s own capability guard, so an unauthorized caller cannot write telemetry`);
  }

  const emitSrc = readFileSync("src/lib/mos/event.ts", "utf8");
  ok("S4", /catch \(err\)/.test(emitSrc) && /return \{ ok: false/.test(emitSrc),
    "control: emitEvent catches and returns rather than throwing — every S1 relies on it never rejecting");

  // ── L · a real pair aggregates through the catalogue ─────────────────────
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

      // the second journey, on its single-name three-outcome shape
      const encCorr = newCorrelationId();
      const ebase = { practiceId: fixtureId, correlationId: encCorr, component: "encounter", eventName: "practice.encounter.started" } as const;
      await emitEvent(admin, { ...ebase, outcome: "started" });
      await emitEvent(admin, { ...ebase, outcome: "success", durationMs: 96 });

      const since = new Date(Date.now() - 3_600_000).toISOString();
      const booking = await journeyOutcomes(admin, "patient_booking", since);
      ok("L1", booking !== null && booking.attempts >= 2 && booking.successes >= 1 && booking.failures >= 1,
        `⚠ Patient Booking reports ATTEMPTS, SUCCESSES AND FAILURES — ${booking?.attempts} attempted, ${booking?.successes} succeeded, ${booking?.failures} failed`);

      const encounter = await journeyOutcomes(admin, "start_encounter", since);
      ok("L2", encounter !== null && encounter.attempts >= 1 && encounter.successes >= 1,
        `⚠ Start Encounter reports them too, from ONE event name — ${encounter?.attempts} attempted, ${encounter?.successes} succeeded`);

      const jv = await admin.from("mos_journey_event")
        .select("journey_name, failure_code, correlation_id").eq("correlation_id", failCorr);
      const jrows = (jv.error ? [] : jv.data) as { journey_name: string; failure_code: string | null }[];
      ok("L3", jrows.length === 2 && jrows.every(r => r.journey_name === "Patient Booking"),
        "both halves of one attempt resolve to the same journey through the catalogue, joined by correlation id");

      ok("L4", jrows.some(r => r.failure_code === "SLOT_TAKEN"),
        "the failure reaches the journey view with its stable code, so a rate can be broken down by cause");

      ok("L5", booking !== null && encounter !== null
          && booking.attempts >= booking.successes + booking.failures
          && encounter.attempts >= encounter.successes + encounter.failures,
        "control: on both journeys outcomes never exceed attempts — the pairing holds in the DATA, not only in the source");
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
