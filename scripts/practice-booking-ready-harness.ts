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
import { readFileSync, readdirSync } from "node:fs";
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
// ⚠ THE STRIPPER IS ASSERTED BEFORE ANYTHING RELIES ON IT. Added 2026-08-23 after the identical
// helper in practice-responsive-harness.ts was found INERT on CRLF files: `.` does not match `\r`, so
// `.*` stops before the line ending and an unanchored `$` then matches only at the end of the whole
// string, leaving every comment but the last in place. That version split on "\n"; this one splits on
// /\r?\n/ and is correct -- which is exactly why it needs a test. A stripper that silently stops
// working turns every source assertion beneath it into a search of the documentation.
ok("0. the comment stripper removes comments, on this checkout's line endings",
  (() => {
    const raw = readFileSync(join(ROOT, "src", "lib", "practice", "patient-booking.ts"), "utf8");
    const needle = "AN UNREADABLE STORE IS NOT";
    return raw.includes(needle) && !stripComments(raw).includes(needle);
  })(),
  "if this fails, every source assertion below is reading prose");

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
// ⚠ THE CALL SHAPE IS NOT PINNED, DELIBERATELY. A first draft asserted the literal
// "publicBookingReadiness(rule)" and went red the moment the call grew an argument for capacity --
// pinning a mechanism actively under change, which is the failure this codebase keeps re-learning.
// What matters is that the public branch consults the predicate BEFORE the Infinity branch runs.
const guardedFirst = engine.indexOf('if (channel === "patient_self")') < engine.indexOf("? Infinity")
  && engine.includes("publicBookingReadiness(");
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

// ── 7. CAPACITY (s2's fourth invariant, s6) ────────────────────────────────────────────────────
// ⚠ NULL CAPACITY IS NOT MISSING CAPACITY, and this is the one place the two null semantics in this
// specification diverge. Refusing a null the way a null horizon is refused would reject nearly every
// session in existence, because almost none constrain themselves below the derived ceiling.
//
// READ 241, NOT 240. 240 added `capacity_manual` beside 231's `capacity`; 241 found that the two
// nulls meant OPPOSITE things (231: unlimited, 240: derive-it), dropped capacity_manual, moved the
// data across and redefined `capacity`'s null as the derived ceiling. Assertion 7e exists because
// this harness previously REQUIRED the dropped name and so kept a 42703 in production green.
ok("7. a null capacity still resolves -- it defers to the derivation, it is not missing",
  publicBookingReadiness({ ...PUBLIC_OK, sessionCapacity: null }).ready === true
    && publicBookingReadiness({ ...PUBLIC_OK }).ready === true);
ok("7b. an explicit capacity of zero is NOT publicly bookable -- a session admitting nobody",
  publicBookingReadiness({ ...PUBLIC_OK, sessionCapacity: 0 }).ready === false
    && publicBookingReadiness({ ...PUBLIC_OK, sessionCapacity: -3 }).ready === false);
ok("7c. and a positive capacity passes",
  publicBookingReadiness({ ...PUBLIC_OK, sessionCapacity: 12 }).ready === true);

// ⚠ 7d IS THE ONE THAT MATTERS. The slot row has never carried capacity, so a guard reading it off
// the slot would be undefined on every call and pass forever -- an inert check, which is the exact
// defect this whole specification exists to remove. This asserts the engine reads capacity from the
// TEMPLATE, which is where the column lives.
ok("7d. the engine resolves capacity from the template, not from a field the slot does not have",
  engine.includes("capacity") && engine.includes("capacityByTemplate")
    && !engine.includes("(slot as any).capacity"));

// ⚠⚠ 7e IS HERE BECAUSE 7d ONCE MADE THINGS WORSE. It pinned the literal `capacity_manual`, so when the
// engine was pointed at a column migration 241 had DROPPED, the assertion did not merely miss it --
// it required it. PostgREST answered 42703, the read guard turned every public availability request
// into a 503, and this suite stayed green.
//
// A name pinned as a string is only ever checked against itself. This checks it against the
// migrations: any column a migration drops must not appear in a select anywhere in the practice
// library. It is deliberately broader than capacity, because the mistake was not about capacity.
// ⚠ TABLE-AWARE, AND THE FIRST VERSION WAS NOT. Keyed on the column name alone it reported 35
// offences, every one of them `appointment_type` -- which 241 dropped from the SESSION TEMPLATE while
// practice_booking_rule and practice_appointment keep a column of that name perfectly legitimately. A
// check that cries wolf 35 times is switched off by the second person who reads it, so the pairing
// below is not fussiness: it is the difference between a control and a nuisance.
const between = (src: string, from: number, token: string, within: number) => {
  const at = src.indexOf(token, from);
  return at >= 0 && at - from < within ? at : -1;
};
const quoted = (src: string, from: number) => {
  const q = src.indexOf("\"", from);
  const close = q < 0 ? -1 : src.indexOf("\"", q + 1);
  return q >= 0 && close > q && close - q < 600 ? src.slice(q + 1, close) : null;
};

const MIG_DIR = join(__dirname, "..", "supabase", "migrations");
const dropped = new Map<string, string>();  // "table.column" -> migration file
for (const f of readdirSync(MIG_DIR)) {
  if (!f.endsWith(".sql")) continue;
  for (const raw of readFileSync(join(MIG_DIR, f), "utf8").split("\n")) {
    const line = raw.toLowerCase();
    if (line.trim().startsWith("--")) continue;
    const at = line.indexOf("drop column");
    if (at < 0 || !line.includes("alter table")) continue;
    const table = line.slice(line.indexOf("alter table") + "alter table".length).trim().split(/[^a-z0-9_]/)[0];
    const after = line.slice(at + "drop column".length).trim();
    const rest = after.startsWith("if exists") ? after.slice("if exists".length).trim() : after;
    const col = rest.split(/[^a-z0-9_]/)[0];
    if (table && col) dropped.set(`${table}.${col}`, f);
  }
}

const LIB_DIR = join(__dirname, "..", "src", "lib", "practice");
const offences: string[] = [];
for (const f of readdirSync(LIB_DIR)) {
  if (!f.endsWith(".ts")) continue;
  const src = readFileSync(join(LIB_DIR, f), "utf8");
  let i = src.indexOf(".from(");
  while (i >= 0) {
    const table = quoted(src, i);
    // The select that belongs to this from(): the builder is chained, so it is the next one within a
    // short reach. Anything further away belongs to a different query and is left alone.
    const sel = table ? between(src, i, ".select(", 260) : -1;
    if (table && sel >= 0) {
      const cols = quoted(src, sel);
      for (const col of (cols ?? "").split(",").map(c => c.trim().toLowerCase()))
        if (dropped.has(`${table}.${col}`))
          offences.push(`${f}: ${table}.${col}, dropped by ${dropped.get(`${table}.${col}`)}`);
    }
    i = src.indexOf(".from(", i + 1);
  }
}
ok("7e. no engine selects a column a migration dropped",
  dropped.size > 0 && offences.length === 0,
  offences.length ? offences.join(" | ") : "no drop statements were found to check against");

// ── 8. s8's FIRST LINE: "FIND EVERY WRITE/DEFAULT OF VISIBILITY" ───────────────────────────────
//
// ⚠⚠ THIS IS THE HALF THAT WAS SKIPPED, AND SKIPPING IT COST MORE THAN THE HALF THAT WAS DONE.
// Assertions 4, 4b and 6b prove the READ side: visibility is resolved, it reaches the engine, and an
// internal rule yields no public slots. All three passed while the column had NO WRITER AT ALL --
// migration 230 gives it a NOT NULL default of 'internal', saveBookingRule carried the existing value
// forward on every write, and no input, route or control ever supplied one. Every rule ever created
// was internal and could never become anything else.
//
// So the enforcement was real and the gate had no key: a practice could not make a session publicly
// bookable by any sequence of actions available to it. A read-side test suite cannot see that. These
// four walk the write side of the same chain the spec asks to be documented end to end.
const rules = read("src", "lib", "practice", "booking-rules.ts");
const rulesRoute = read("src", "app", "api", "v1", "practice", "booking-rules", "route.ts");
const ruleEditor = read("src", "app", "practice", "(shell)", "setup", "availability-booking", "RuleWorkspace.tsx");

ok("8. the rule input accepts a visibility, so the value has somewhere to come from",
  rules.includes("visibility?: string | null;"));

ok("8b. and the save writes the supplied value rather than always carrying the old one forward",
  rules.includes("args.visibility === undefined || args.visibility === null")
    && !rules.includes("visibility: existing?.visibility ?? \"internal\",\n  };"));

ok("8c. the value survives the route, so the screen is not talking to itself",
  rulesRoute.includes("visibility: body.visibility === undefined ? undefined : str(body.visibility)"));

// The card has to carry it back out too, or the editor opens every public rule showing 'internal'
// and the first save a practitioner does silently returns it to internal.
ok("8d. and the rule card reports it, so the control shows what is actually set",
  rules.includes("visibility: (r.visibility as string | null) ?? \"internal\",")
    && ruleEditor.includes("visibility: r.visibility ?? \"internal\""));

ok("8e. a practitioner has a control for it",
  ruleEditor.includes("set(\"visibility\", e.target.value)"));

// s5 again, in the place a person actually reads. The box offered "no limit", which is the one
// meaning a missing horizon does not have.
//
// ⚠ SCOPED TO THE HORIZON INPUT. A first version banned the string across the whole file and failed
// on six capacity and follow-up fields, where an empty box means something else entirely. An
// assertion that has to be argued down the first time it fires teaches the reader to argue with it.
const horizonInput = ruleEditor.slice(
  ruleEditor.indexOf("set(\"bookingHorizonDays\", e.target.value)") - 200,
  ruleEditor.indexOf("set(\"bookingHorizonDays\", e.target.value)") + 120,
);
ok("8f. the horizon field no longer promises that empty means unlimited",
  horizonInput.includes("bookingHorizonDays") && !horizonInput.includes("no limit"),
  horizonInput.trim());

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
