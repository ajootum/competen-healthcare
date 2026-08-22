/**
 * CPR-BOOK-READY-001 -- EFFECTIVE BOOKING CONSTRAINTS AND VISIBILITY ENFORCEMENT.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS.
 *
 * The booking-readiness blocker used to pass because a rule ROW existed. It said nothing about the
 * values in that row, so this estate reached a green readiness screen while its only rule set no
 * horizon, no capacity, and a visibility of "internal" -- and the availability engine read that null
 * horizon as Infinity and would have offered public times forever.
 *
 * s18: "REOPEN BOOKING READINESS UNTIL THESE INVARIANTS ARE PROVEN. Do not patch the harness by
 * checking booking_horizon_days for non-null in isolation."
 *
 * ⚠ SO THIS TESTS THE PRODUCTION PREDICATE, NOT A COPY OF IT. s3 forbids a test-only resolver whose
 * semantics can drift. publicBookingReadiness is imported from patient-booking.ts -- the same function
 * bookableTimes calls on every slot and publishReadiness calls on every session. If somebody weakens
 * it, these go red rather than agreeing with the new weakness.
 *
 * ⚠ NULL IS MISSING, FROZEN BY OWNER DECISION 2026-08-22. Not inherit, not unlimited. There is no
 * practice-level or product-level horizon to inherit from and this change deliberately does not invent
 * one; that is a separate architecture decision.
 *
 *   npx tsx scripts/practice-booking-ready-harness.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { publicBookingReadiness } from "../src/lib/practice/patient-booking";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const ROOT = process.cwd();

/**
 * ⚠ COMMENTS STRIPPED, AND THIS FILE IS WHY.
 *
 * Assertion 3 scans for the literal `? Infinity` to prove the unlimited branch is guarded. Its first
 * draft searched the raw source and found the phrase at line 669 -- inside the doc comment in
 * patient-booking.ts that EXPLAINS the fix -- so indexOf returned a position before the guard and the
 * assertion reported the code unguarded while it was guarded. A rule that reads its own documentation
 * is measuring prose, and the prose is the part most likely to mention the thing being forbidden.
 *
 * Blocks first, then lines: blanking lines first would destroy the opening of a block comment and
 * leave its body behind as apparent code.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/).map(l => l.replace(/\/\/.*$/, "")).join("\n");

const read = (...p: string[]) => stripComments(readFileSync(join(ROOT, ...p), "utf8"));

console.log("\nPractice booking-ready harness (CPR-BOOK-READY-001)\n");

const PUBLIC_OK = { bookingHorizonDays: 30, visibility: "public" };

// ── 1. NULL HORIZON -> NOT PUBLICLY BOOKING-READY ──────────────────────────────────────────────
const nullHorizon = publicBookingReadiness({ bookingHorizonDays: null, visibility: "public" });
ok("1. a null booking horizon is NOT publicly booking-ready",
  nullHorizon.ready === false && !nullHorizon.ready && nullHorizon.reason === "horizon_missing",
  JSON.stringify(nullHorizon));

// ── 2. EXPLICIT VALID FINITE HORIZON MAY PASS ──────────────────────────────────────────────────
ok("2. an explicit finite horizon with public visibility IS ready",
  publicBookingReadiness(PUBLIC_OK).ready === true);

// ── 3. NULL NEVER MEANS UNLIMITED ──────────────────────────────────────────────────────────────
// ⚠ THE ASSERTION IS ON THE SOURCE, not only on the predicate, because the defect was a LITERAL:
// `bookingHorizonDays === null ? Infinity`. A predicate returning the right answer while the engine
// still computed Infinity underneath it would pass a value-only test and ship the bug.
const engine = read("src", "lib", "practice", "patient-booking.ts");
const infinityLine = /bookingHorizonDays === null \? Infinity/.test(engine);
const guardedFirst = engine.indexOf('if (channel === "patient_self")') < engine.indexOf("? Infinity")
  && engine.includes("publicBookingReadiness(rule)");
ok("3. null is never read as unlimited on the public channel: the Infinity branch is guarded",
  !infinityLine || guardedFirst,
  `infinityPresent=${infinityLine} guardedFirst=${guardedFirst}`);
ok("3b. and zero or negative horizons are refused, so 'finite' is not merely 'not null'",
  publicBookingReadiness({ bookingHorizonDays: 0, visibility: "public" }).ready === false
    && publicBookingReadiness({ bookingHorizonDays: -1, visibility: "public" }).ready === false
    && publicBookingReadiness({ bookingHorizonDays: 1.5, visibility: "public" }).ready === false);

// ── 4. visibility="internal" IS NEVER PUBLIC ───────────────────────────────────────────────────
const internal = publicBookingReadiness({ bookingHorizonDays: 30, visibility: "internal" });
ok("4. an internal rule is NOT publicly booking-ready even when every time constraint is valid",
  internal.ready === false && !internal.ready && internal.reason === "visibility_not_public");
ok("4b. and an unset visibility fails closed rather than defaulting to public",
  publicBookingReadiness({ bookingHorizonDays: 30, visibility: null }).ready === false
    && publicBookingReadiness({ bookingHorizonDays: 30 }).ready === false);

// ── 5. INTERNAL WORK IS UNAFFECTED ─────────────────────────────────────────────────────────────
// s10: internal visibility is not authorization, and staff booking keeps its own path. The guard in
// the engine is scoped to the patient channel; asserting that scope is what protects the practitioner's
// own diary from a constraint that exists to protect a public page.
ok("5. the engine's public guard is scoped to the patient channel, so staff booking is untouched",
  /if \(channel === "patient_self"\) \{[\s\S]{0,220}publicBookingReadiness/.test(engine));

// ── 6. NO ALTERNATE PUBLIC ROUTE BYPASSES THE ENGINE ───────────────────────────────────────────
// ⚠ A RATCHET, per s14. Every public booking entry point must reach the constrained engine. A new
// route that queries slots directly would not be caught by any value test above, because it would
// never call the predicate at all.
const publicRoute = read("src", "app", "api", "v1", "practice", "public", "booking", "route.ts");
ok("6. the public booking route computes availability through the engine, not its own query",
  /bookableSlots/.test(publicRoute)
    && !/from\(["']practice_availability_slot["']\)/.test(publicRoute));
ok("6b. and the resolver actually SELECTS visibility, so enforcement has something to read",
  /visibility/.test(read("src", "lib", "practice", "availability-config.ts")));

// ── CONTROLS ───────────────────────────────────────────────────────────────────────────────────
ok("control: the predicate can return ready, so these are not all passing on a constant false",
  publicBookingReadiness(PUBLIC_OK).ready === true);

console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
console.log(
  "\n⚠ s13's live arms -- internal sessions usable by an authorised internal caller, and public\n"
  + "  availability returning no exposure for them -- need a provisioned workspace with a published\n"
  + "  booking page. Nothing in this estate has one (publish_state=draft, handle=null), so they are\n"
  + "  named here rather than silently omitted.\n");
