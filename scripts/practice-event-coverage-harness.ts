/**
 * practice-event-coverage (CPR-CORE-001 s9 / CORE-09) — does every type in the domain-event
 * catalogue have a producer?
 *
 * ⚠ THIS EXISTS BECAUSE THE ANSWER WAS 12 OUT OF 34 AND NOTHING ANYWHERE SAID SO.
 *
 * PRACTICE_EVENT_TYPES (migration 233) declares thirty-four things the practice announces. Twelve were
 * ever emitted. DASHBOARD_EVENTS then declares thirty-two of the thirty-four as triggers the Command
 * Centre re-renders on — so twenty of its declared triggers could never fire, and the page fell back to
 * the 30-60 second poll s12 allows as a FALLBACK for appointments, check-in, the queue, results, tasks,
 * documents and messages. It worked, slowly. That is exactly why it survived: nothing was broken, the
 * dashboard was merely up to a minute behind on most of what happens in a clinic.
 *
 * ⚠ AND THE COUNT WAS MISREPORTED TWICE BEFORE THIS HARNESS EXISTED — 6, then 8, then 12. Both wrong
 * numbers came from the same mistake, and it is the mistake this harness is built around:
 *
 *   GREPPING FOR `eventType: "..."` FINDS ONLY THE EMITTERS THAT USE A LITERAL. encounters.ts picks its
 *   type out of the ENCOUNTER_EVENT map (four types, invisible to that scan) and activity.ts picks one
 *   with a ternary (two more). A scan shaped like the code it expects to find will always under-report
 *   the code that is shaped differently, and under-reporting is the dangerous direction here: it makes
 *   a gap look smaller than it is.
 *
 * SO THE DETECTION IS DELIBERATELY NOT A LITERAL SCAN. A file that imports the outbox and calls it is an
 * EMITTER, and inside an emitter any catalogue type name is an emit — through a literal, a map, a
 * ternary or anything else somebody writes next year. Two files are excluded because they name the whole
 * catalogue for other reasons (see EXCLUDED), and comments are blanked first, because this arc's own
 * commentary names types it deliberately does not emit.
 *
 * WHAT IT PROVES:
 *   1. Every catalogue type is either EMITTED or declared in NO_PRODUCER with a reason.
 *   2. Nothing in NO_PRODUCER is actually emitted — a declaration is a claim, and this checks it.
 *   3. NO_PRODUCER names no type that is not in the catalogue.
 *   4. Every DASHBOARD_EVENTS trigger that is not declared producerless can actually fire.
 *   5. CONTROLS — the detector sees a map-driven emit, and does not count the catalogue's own file.
 *
 * Pure/local: reads source, touches no database, needs no credentials.
 *
 *   npx --yes tsx scripts/practice-event-coverage-harness.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { PRACTICE_EVENT_TYPES, NO_PRODUCER } from "../src/lib/practice/events";
import { DASHBOARD_EVENTS, NOT_STREAMED } from "../src/lib/practice/event-stream";

const failures: string[] = [];
let passed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

const SRC = join(process.cwd(), "src");

/**
 * The two files that name the catalogue without emitting from it.
 *
 * events.ts IS the catalogue — every type appears in it by definition, so counting it would report
 * 34/34 for ever and the harness would be a needle finding itself. event-stream.ts declares which types
 * the dashboard LISTENS to, which is the opposite end of the same wire.
 */
const EXCLUDED = [
  join("lib", "practice", "events.ts"),
  join("lib", "practice", "event-stream.ts"),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/**
 * Blank comments so prose cannot be mistaken for code.
 *
 * ⚠ LINE COMMENTS FIRST, AND THE ORDER IS THE WHOLE POINT. A `/*` inside a `//` comment — which this
 * codebase writes constantly, citing globs and JSX — makes a naive block pass swallow every line to the
 * next closing marker, and it swallows them SILENTLY. That exact defect blinded the PD doctrine harness
 * and hid a real violation behind it, and the failure direction is the dangerous one: it makes a scan
 * UNDER-report. Here it would report a type as unemitted when its emit site sat inside the blanked
 * region, which is a false gap somebody would then go and "fix" twice.
 *
 * Blanking rather than deleting keeps offsets stable, so a line number in a failure still means
 * something.
 */
function blankComments(src: string): string {
  const noLine = src.replace(/\/\/[^\n]*/g, m => " ".repeat(m.length));
  return noLine.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));
}

// ── WHO EMITS ────────────────────────────────────────────────────────────────────────────────────────
//
// An emitter imports the outbox module AND calls one of its three writers. Both halves are required: a
// file that imports only the EventSource type (planner.ts does) is not an emitter, and would otherwise
// contribute every type name it happens to mention.
const files = walk(SRC).filter(f => !EXCLUDED.some(x => f.endsWith(x)));
const emitters: { path: string; body: string }[] = [];
for (const f of files) {
  const raw = readFileSync(f, "utf8");
  if (!/from\s+"@\/lib\/practice\/events"/.test(raw)) continue;
  const body = blankComments(raw);
  if (!/\bemit(Event|Events|Audited)\s*\(/.test(body)) continue;
  emitters.push({ path: f.slice(SRC.length + 1), body });
}

const emittedBy = new Map<string, string[]>();
for (const t of PRACTICE_EVENT_TYPES) {
  const where = emitters.filter(e => e.body.includes(`"${t}"`) || e.body.includes(`'${t}'`)).map(e => e.path);
  if (where.length > 0) emittedBy.set(t, where);
}

const emitted = [...emittedBy.keys()];
const declared = Object.keys(NO_PRODUCER);
const orphans = PRACTICE_EVENT_TYPES.filter(t => !emittedBy.has(t) && !declared.includes(t));

console.log(`\n-- PRACTICE DOMAIN EVENT COVERAGE ------------------------------------------------------\n`);
console.log(`  catalogue          ${PRACTICE_EVENT_TYPES.length}`);
console.log(`  emitters           ${emitters.length} files`);
console.log(`  emitted            ${emitted.length}`);
console.log(`  declared no-producer ${declared.length}`);
console.log(`  unaccounted for    ${orphans.length}\n`);

// ══ 1. EVERY TYPE IS ACCOUNTED FOR ═══════════════════════════════════════════════════════════════════
check("1a. every catalogue type is either emitted or declared in NO_PRODUCER with a reason",
  orphans.length === 0,
  orphans.length ? `unaccounted: ${orphans.join(", ")}` : "");
check("1b. every NO_PRODUCER entry carries a reason somebody wrote, not an empty string",
  declared.every(k => String(NO_PRODUCER[k] ?? "").trim().length > 20),
  JSON.stringify(declared.filter(k => String(NO_PRODUCER[k] ?? "").trim().length <= 20)));

// ══ 2. A DECLARATION IS A CLAIM, AND THE CLAIM IS CHECKED FROM THE OTHER SIDE ═════════════════════════
//
// ⚠ THIS IS WHAT STOPS NO_PRODUCER BECOMING A MUTE BUTTON. Without it, the cheapest way to make 1a green
// is to add the type to NO_PRODUCER and write a sentence, and the harness would agree for ever. Saying
// "nothing emits this" is falsifiable, so it gets falsified here.
const falselyDeclared = declared.filter(t => emittedBy.has(t));
check("2a. nothing declared producerless is actually emitted",
  falselyDeclared.length === 0,
  falselyDeclared.map(t => `${t} is emitted by ${(emittedBy.get(t) ?? []).join(", ")}`).join("; "));
check("2b. NO_PRODUCER names no type that is not in the catalogue",
  declared.every(t => (PRACTICE_EVENT_TYPES as readonly string[]).includes(t)),
  JSON.stringify(declared.filter(t => !(PRACTICE_EVENT_TYPES as readonly string[]).includes(t))));

// ══ 3. THE DASHBOARD'S DECLARED TRIGGERS CAN FIRE ════════════════════════════════════════════════════
//
// DASHBOARD_EVENTS is a promise about what makes the Command Centre repaint. A trigger nothing emits is
// a card that only ever updates on the polling fallback — working, and a minute behind, which is the
// state this whole arc was about.
const deadTriggers = DASHBOARD_EVENTS.filter(t => !emittedBy.has(t) && !declared.includes(t));
check("3a. every dashboard trigger that is not declared producerless has a producer",
  deadTriggers.length === 0, deadTriggers.join(", "));
check("3b. control — DASHBOARD_EVENTS and NOT_STREAMED still partition the catalogue",
  DASHBOARD_EVENTS.length + NOT_STREAMED.length === PRACTICE_EVENT_TYPES.length,
  `${DASHBOARD_EVENTS.length} + ${NOT_STREAMED.length} vs ${PRACTICE_EVENT_TYPES.length}`);

// ══ 4. CONTROLS — THE DETECTOR CAN SEE, AND CAN FAIL TO SEE ══════════════════════════════════════════
//
// ⚠ 4a IS THE ASSERTION THAT WOULD HAVE CAUGHT THE WRONG COUNT. `encounter.paused` is never written as
// `eventType: "encounter.paused"` anywhere — encounters.ts reaches it through the ENCOUNTER_EVENT map,
// which is precisely the shape the two earlier miscounts could not see. If this ever goes red because
// the detection was narrowed back to a literal scan, the number this harness reports is wrong again.
check("4a. control — a type emitted ONLY through a lookup map is detected",
  emittedBy.has("encounter.paused"),
  "encounter.paused is reached through ENCOUNTER_EVENT, never as an eventType literal");
check("4b. control — and one reached only through a ternary is too",
  emittedBy.has("session.resumed"),
  "session.resumed is reached through pauseEvents' ternary");
check("4c. control — the catalogue's own file is not counted as an emitter",
  !emitters.some(e => e.path.endsWith(join("lib", "practice", "events.ts"))
    || e.path.endsWith(join("lib", "practice", "event-stream.ts"))),
  emitters.map(e => e.path).join(", "));
// A type this codebase has never had. If the scan "finds" it, the matcher is matching something other
// than what it is being asked about, and every other count above is suspect.
check("4d. control — a type that does not exist is not found",
  !emitters.some(e => e.body.includes('"encounter.teleported"')),
  "the substring matcher is matching something it should not");
check("4e. control — comments are blanked, so prose naming a type is not read as an emit",
  blankComments('// "alert.created" is not emitted\nconst x = "alert.resolved";').includes('"alert.resolved"')
  && !blankComments('// "alert.created" is not emitted\nconst x = "alert.resolved";').includes('"alert.created"'),
  "blankComments is not doing its job");

// ── THE LEDGER, PRINTED WHETHER OR NOT ANYTHING FAILED ───────────────────────────────────────────────
console.log(`\n-- WHO EMITS WHAT ----------------------------------------------------------------------\n`);
for (const t of PRACTICE_EVENT_TYPES) {
  const where = emittedBy.get(t);
  const streamed = DASHBOARD_EVENTS.includes(t) ? "dash" : "    ";
  if (where) console.log(`  ${streamed}  EMIT  ${t.padEnd(30)} ${where.join(", ")}`);
  else if (declared.includes(t)) console.log(`  ${streamed}  none  ${t.padEnd(30)} ${NO_PRODUCER[t]}`);
  else console.log(`  ${streamed}  ????  ${t.padEnd(30)} UNACCOUNTED FOR`);
}
console.log("");

if (failures.length) {
  console.log(`RED  ${passed} passed, ${failures.length} failed\n`);
  process.exit(1);
}
console.log(`ALL GREEN  ${passed} passed, 0 failed\n`);
