/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * CPR-HFE-REF-001 s12 -- the practitioner/internal audience boundary, enforced.
 *
 * The refusal pattern was never the defect. Rendering an absence honestly, with its reason, is a
 * requirement of this product and s11 forbids weakening it. The defect was AUDIENCE: a doctor opening
 * the Patients screen was shown "Elements of the CPR-PAT-002 design and specification that this record
 * cannot honestly support", and a worklist tile explained itself with "worklists() reads
 * practice_queue_entry.status and folds IN_CONSULTATION into the single Waiting patients figure".
 *
 * ⚠ WHY A RATCHET AND NOT A COPY EDIT. Every one of those strings was written by somebody being
 * careful. The prose is good; it is aimed at the wrong reader. Nothing in the type system or the review
 * habit stopped it, and nothing would stop the next one -- the authoring moment is exactly when the
 * spec reference feels most relevant. s12 asks for a test, so this is the test.
 *
 * WHAT IT CANNOT DO: it cannot tell whether `reason` is TRUE. A refusal that says "not stored" about
 * something the product does store is a lie this harness will pass. That is what the walkthrough and
 * the honesty harnesses are for. This one guards the audience boundary only, and says so.
 *
 *   npx tsx scripts/practice-refusal-harness.ts
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import {
  REFUSAL_STATE_COPY, EMPTY_STATE_LOOKALIKES, INTERNAL_IDENTIFIER_RE, IMPLEMENTATION_JARGON_RE,
  practitionerView, refusalTitle, type Refusal, type RefusalState,
} from "../src/lib/practice/refusal-presentation";
import { SCREEN_REFUSES, UNSUPPLIED_CARD, UNSUPPLIED_COLUMN_REFUSALS } from "../src/app/practice/(shell)/patients/refusals";
import { REFUSES } from "../src/lib/practice/patient-workspace-constants";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};
/**
 * A practice table name is engineering vocabulary wherever it appears in prose.
 *
 * ⚠ THIS LINE ARRIVED THROUGH A SHELL HEREDOC AS TWO LITERAL BACKSPACE BYTES instead of two
 * word-boundary escapes, so the pattern could never match anything. 9b went green -- nothing
 * matched, so nothing leaked -- and 9b-control went red, which is the only reason it was noticed.
 * A detector that cannot match is indistinguishable from a clean estate.
 */
const TABLE_RE = /\bpractice_[a-z_]+\b/;

const section = (t: string) => console.log(`\n-- ${t} ${"-".repeat(Math.max(0, 78 - t.length))}`);

/**
 * ⚠ COMMENTS ARE BLANKED BEFORE ANY SOURCE SCAN, AND THIS HARNESS PROVED WHY ON ITS FIRST RUN.
 *
 * Assertion 7a went red against WorklistTiles.tsx -- not because the screen renders technicalDetail,
 * but because the COMMENT explaining that it must not render technicalDetail contains the word. The
 * detector matched its own documentation. plane-boundary-harness.ts walks an AST for the same reason;
 * blanking line-first is the cheap version of the same discipline.
 */
const stripComments = (src: string): string =>
  // ⚠ BLOCKS FIRST, LINES SECOND, AND THE ORDER IS THE WHOLE BUG. Blanking lines first destroys the
  // `{/*` that opens a multi-line JSX comment, so the block regex can no longer match it and every
  // continuation line survives -- which is precisely how 7a stayed red with the stripper "working".
  // 7-control caught it.
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map(l => (/^\s*(\/\/|\*)/.test(l) ? "" : l))
    .join("\n");

const ALL: { where: string; items: readonly Refusal[] }[] = [
  { where: "patients screen", items: SCREEN_REFUSES },
  { where: "patients worklist cards", items: UNSUPPLIED_CARD },
  { where: "patients register columns", items: UNSUPPLIED_COLUMN_REFUSALS },
  { where: "patient workspace engine", items: REFUSES },
];
const every = ALL.flatMap(g => g.items.map(r => ({ ...r, where: g.where })));

// ══ 1. THE INVENTORY EXISTS AND IS NOT EMPTY ═══════════════════════════════════════════════════
section("1. the inventory");
ok("1a. every registry is non-empty, so the checks below cannot pass vacuously",
  ALL.every(g => g.items.length > 0), ALL.map(g => `${g.where}:${g.items.length}`).join(" "));
ok("1b. more than a dozen refusals are under this contract",
  every.length >= 12, `${every.length} refusals`);

// ══ 2. THE AUDIENCE BOUNDARY -- THE POINT OF THE SPEC ══════════════════════════════════════════
section("2. no internal language reaches a practitioner");
for (const g of ALL) {
  const leaks = g.items
    .map(r => ({ r, text: `${refusalTitle(r)} ${r.reason} ${r.nextAction?.label ?? ""}` }))
    .filter(x => INTERNAL_IDENTIFIER_RE.test(x.text));
  ok(`2a[${g.where}]. no practitioner-facing text carries a CPR-/COMP-/PLAT- identifier`,
    leaks.length === 0, leaks.map(l => `${l.r.key}: ${l.text.slice(0, 70)}`).join(" | "));
}
const jargon = every
  .map(r => ({ r, text: `${refusalTitle(r)} ${r.reason}` }))
  .filter(x => IMPLEMENTATION_JARGON_RE.test(x.text));
ok("2b. no practitioner-facing text uses implementation vocabulary (schema, payload, column, table...)",
  jargon.length === 0, jargon.map(j => `${j.r.key}: ${j.text.slice(0, 70)}`).join(" | "));
const fnNames = every.filter(r => /\b\w+\(\)/.test(`${refusalTitle(r)} ${r.reason}`));
ok("2c. no practitioner-facing text names a function",
  fnNames.length === 0, fnNames.map(r => r.key).join(", "));

// ⚠ CONTROL. 2a-2c prove nothing if the detectors cannot see what they ban.
section("2-control. the detectors can still see what they ban");
ok("2a-control. the identifier detector matches a real identifier",
  INTERNAL_IDENTIFIER_RE.test("Elements of the CPR-PAT-002 design and specification"));
ok("2b-control. the jargon detector matches real jargon",
  IMPLEMENTATION_JARGON_RE.test("the column on practice_patient is nullable"));
ok("2c-control. the function detector matches a real call",
  /\b\w+\(\)/.test("worklists() reads practice_queue_entry.status"));

// ══ 3. THE PROVENANCE SURVIVED (s11, s13 Traceability) ═════════════════════════════════════════
section("3. internal provenance is retained, not deleted");
const noCode = every.filter(r => !r.internal?.reasonCode);
ok("3a. every refusal carries a machine-readable reason code",
  noCode.length === 0, noCode.map(r => r.key).join(", "));
ok("3b. reason codes are unique within a registry, so diagnostics can group by them",
  ALL.every(g => new Set(g.items.map(i => i.internal.reasonCode)).size === g.items.length));
const withSpec = every.filter(r => r.internal.specReference);
ok("3c. ⚠ the specification references were MOVED, not deleted -- they are still here internally",
  withSpec.length >= 10, `${withSpec.length} of ${every.length} carry a spec reference`);
const carried = every.filter(r => (r.internal.technicalDetail ?? "").length > 80);
ok("3d. and the original engineering prose is preserved under technicalDetail",
  carried.length >= 12, `${carried.length} carry substantial technical detail`);

// ══ 4. SEMANTIC ACCURACY (s4, s12) ═════════════════════════════════════════════════════════════
section("4. the states stay distinct");
const states = new Set(every.map(r => r.state));
ok("4a. every state used is one of the six canonical states",
  [...states].every(st => st in REFUSAL_STATE_COPY), [...states].join(", "));
// s12: NO_DATA_YET must never describe a capability the product does not have.
const capabilityCodes = /(NO_\w*STORAGE|NOT_IMPLEMENTED|NO_\w*ENTITY|NO_\w*FIELD|NO_\w*MODEL|NO_\w*LINK|NO_\w*STATE)/;
const dressedUp = every.filter(r =>
  EMPTY_STATE_LOOKALIKES.includes(r.state) && capabilityCodes.test(r.internal.reasonCode));
ok("4b. ⚠ NO_DATA_YET is never used for a capability-absence reason code",
  dressedUp.length === 0, dressedUp.map(r => `${r.key}=${r.internal.reasonCode}`).join(", "));
ok("4b-control. the capability-code detector recognises a real one",
  capabilityCodes.test("NO_TAG_STORAGE"));
// s4: RESTRICTED must not explain the authorization logic.
const leakyRestricted = every.filter(r =>
  r.state === "RESTRICTED" && /capability|role|policy|grant|rls|permission code/i.test(r.reason));
ok("4c. RESTRICTED never explains the authorization mechanism",
  leakyRestricted.length === 0, leakyRestricted.map(r => r.key).join(", "));

// ══ 5. HFE PRESENTATION (s10, s12) ═════════════════════════════════════════════════════════════
section("5. the copy is usable");
const noReason = every.filter(r => !r.reason || r.reason.trim().length < 20);
ok("5a. every refusal has a real sentence, not a stub",
  noReason.length === 0, noReason.map(r => r.key).join(", "));
const shouty = every.filter(r => /[A-Z]{6,}/.test(r.reason));
ok("5b. no shouted engineering emphasis in practitioner copy",
  shouty.length === 0, shouty.map(r => r.key).join(", "));
const rambling = every.filter(r => r.reason.split(/(?<=[.!?])\s+/).filter(Boolean).length > 3);
ok("5c. s10: one or two concise sentences, not an essay",
  rambling.length === 0, rambling.map(r => `${r.key}:${r.reason.split(/(?<=[.!?])\s+/).length} sentences`).join(", "));
// s12: next_action only where a route exists.
const badAction = every.filter(r => r.nextAction && !/^\/practice\//.test(r.nextAction.href));
ok("5d. a next action, where offered, points at a real practice route",
  badAction.length === 0, badAction.map(r => r.key).join(", "));
ok("5e. every canonical state has practitioner copy of its own",
  (Object.keys(REFUSAL_STATE_COPY) as RefusalState[]).every(
    st => REFUSAL_STATE_COPY[st].title.length > 3 && REFUSAL_STATE_COPY[st].meaning.length > 20));

// ══ 6. THE COMPONENT CANNOT REACH THE INTERNAL HALF ════════════════════════════════════════════
section("6. the boundary is structural, not a convention");
const view = practitionerView(every[0]);
ok("6a. practitionerView returns ONLY the practitioner fields",
  JSON.stringify(Object.keys(view).sort()) === JSON.stringify(["key", "nextAction", "reason", "state", "title"]),
  Object.keys(view).join(","));
ok("6b. ⚠ and it does not carry `internal` through, even by reference",
  !("internal" in (view as Record<string, unknown>)));

const honesty = join(process.cwd(), "src", "app", "practice", "(shell)", "patients", "Honesty.tsx");
const honestySrc = existsSync(honesty) ? stripComments(readFileSync(honesty, "utf8")) : "";
ok("6c. the shared Refusals component renders through practitionerView",
  /practitionerView/.test(honestySrc));
ok("6d. and never reaches for .internal or .technicalDetail itself",
  !/\.internal\b|technicalDetail/.test(honestySrc));

// ══ 7. NO PRACTITIONER SURFACE RENDERS A REGISTRY DIRECTLY ═════════════════════════════════════
section("7. no screen bypasses the contract");
const screens = [
  "src/app/practice/(shell)/patients/WorklistTiles.tsx",
  "src/app/practice/(shell)/patients/CohortTable.tsx",
  "src/app/practice/(shell)/patients/PatientsScreen.tsx",
];
for (const rel of screens) {
  const p = join(process.cwd(), rel);
  const src = existsSync(p) ? stripComments(readFileSync(p, "utf8")) : "";
  const name = rel.split("/").pop();
  ok(`7a[${name}]. does not render .detail or .technicalDetail`,
    src.length > 0 && !/\.technicalDetail|\{\s*[\w.]*\.detail\s*\}/.test(src));
}

// ══ 8. THE OTHER TWO SCREENS s8 NAMES ═════════════════════════════════════════════════════════
//
// ⚠ THESE ARE SCANNED AS SOURCE, NOT AS A REGISTRY, BECAUSE THEY DO NOT HAVE ONE. Patients keeps its
// refusals as data; Setup/Availability-Booking states them inline through <NotBuilt>, and Documents
// states them as prose in the page. A registry-only harness would have reported "all clear" for both
// while every leak sat untouched -- which is the shape of a guard that cannot fail.
section("8. setup and documents carry no internal language either");
const PROSE_SCREENS = [
  "src/app/practice/(shell)/setup/availability-booking/page.tsx",
  "src/app/practice/(shell)/setup/availability-booking/RuleWorkspace.tsx",
  "src/app/practice/(shell)/documents/page.tsx",
  "src/lib/practice/booking-rule-constants.ts",
];
/** A build-plan phase is as meaningless to a doctor as a spec id, and dates the product besides. */
const BUILD_PHASE_RE = /\bPhase [0-9]\b/;
for (const rel of PROSE_SCREENS) {
  const p = join(process.cwd(), rel);
  const name = rel.split("/").pop();
  if (!existsSync(p)) { ok(`8a[${name}]. file exists`, false, rel); continue; }
  const src = stripComments(readFileSync(p, "utf8"));
  const strings = [...src.matchAll(/"([^"\\]{15,200})"/g)].map(m => m[1]);
  const bad = strings.filter(t =>
    INTERNAL_IDENTIFIER_RE.test(t) || /\bs[0-9]{1,2}\.[0-9]\b/.test(t) || BUILD_PHASE_RE.test(t));
  ok(`8a[${name}]. no rendered string carries a spec id, section number or build phase`,
    bad.length === 0, bad.slice(0, 2).map(b => b.slice(0, 80)).join(" | "));
}
ok("8b-control. the section-number and build-phase detectors match real ones",
  /\bs[0-9]{1,2}\.[0-9]\b/.test("s10.1's eight testable scenarios") && BUILD_PHASE_RE.test("Phase 6 — not built"));
// s8: a CTA is required where setup IS possible, and forbidden where it is not.
ok("8c. NotBuilt no longer renders a build phase to a practitioner",
  !/\{phase\}\s*—\s*not built/.test(
    stripComments(readFileSync(join(process.cwd(), PROSE_SCREENS[0]), "utf8"))));

// ══ 9. METRIC PROVENANCE IS THE SAME BOUNDARY ═════════════════════════════════════════════════
//
// s16 requires every metric to be traceable to source records and a documented formula, and s5 says who
// may read what. Those two are not in tension -- `formula` and `sources` stay on the metric for Product
// Director and Engineering; `basis` is the sentence a practitioner gets. The Command Centre used to put
// formula and sources into a tile's title attribute, which is a tooltip a doctor hovers.
section("9. metric provenance does not reach a practitioner surface");
{
  const metricsSrc = readFileSync(join(process.cwd(), "src", "lib", "practice", "metrics.ts"), "utf8");
  const keys = [...(metricsSrc.match(/const LABELS: Record<MetricKey, string> = \{[\s\S]*?\};/)?.[0] ?? "")
    .matchAll(/(\w+):\s*"/g)].map(m => m[1]);
  const basisBlock = metricsSrc.match(/const BASIS: Record<MetricKey, string> = \{[\s\S]*?\n\};/)?.[0] ?? "";
  const basisKeys = [...basisBlock.matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]);
  ok("9a. every metric has a practitioner basis", keys.length > 0 && keys.every(k => basisKeys.includes(k)),
    `labels ${keys.length}, basis ${basisKeys.length}, missing: ${keys.filter(k => !basisKeys.includes(k)).join(", ")}`);

  const bases = [...basisBlock.matchAll(/"([^"]{20,400})"/g)].map(m => m[1]);
  const leaky = bases.filter(b => TABLE_RE.test(b) || IMPLEMENTATION_JARGON_RE.test(b) || /\b\w+\(\)/.test(b));
  ok("9b. ⚠ no basis names a table, a column or a function", leaky.length === 0,
    leaky.slice(0, 2).map(b => b.slice(0, 70)).join(" | "));
  ok("9b-control. the table detector recognises one", TABLE_RE.test("count of practice_patient rows"));

  // the render itself -- a tooltip is practitioner-facing, whatever it is called
  const home = stripComments(readFileSync(
    join(process.cwd(), "src", "app", "practice", "(shell)", "home", "page.tsx"), "utf8"));
  // ⚠ 9c ONLY EVER CHECKED ONE SCREEN, AND A SECOND ONE WAS DOING THE SAME THING WITH A FIELD
  // ALREADY NAMED `basis`. today/page.tsx built its tiles with `basis: x?.formula` -- the name looked
  // right, so the Command Centre fix read as complete while Current Session still put the
  // engineering sentence in every tile tooltip. Found by walking the product, not by this harness.
  const todaySrc = stripComments(readFileSync(
    join(process.cwd(), "src", "app", "practice", "(shell)", "today", "page.tsx"), "utf8"));
  ok("9c-b. ⚠ Current Session feeds its tiles the basis, never the formula",
    /basis:\s*x\?\.basis/.test(todaySrc) && !/basis:\s*x\?\.formula/.test(todaySrc));
  ok("9c-b-control. the detector would see the old mapping",
    /basis:\s*x\?\.formula/.test("      basis: x?.formula ?? null,"));
  ok("9c. ⚠ the Command Centre renders `basis`, not formula/sources",
    /title=\{why \?\? t\.basis\}/.test(home) && !/t\.formula|t\.sources/.test(home));

  // ⚠ 9d JUDGES `sources`, NOT `formula`, AND THAT IS A DISTINCTION RATHER THAN A COMPROMISE.
  //
  // Two populations wear the word "formula" here and only one is a leak. A CLINICAL formula -- the
  // calculator on DocumentationTools, a derived parameter on MonitoringPlanPanel, a parameter in the
  // library -- is something a clinician needs to see and would rightly object to losing. A METRIC
  // formula is the query behind a figure. A regex cannot tell them apart, and an assertion banning both
  // would either fail forever or push somebody to delete a clinical formula to make it green.
  //
  // `sources` carries no such ambiguity: it is always a list of table.column identifiers, and it is
  // never the answer to a question a practitioner is asking. So that is what is banned.
  const estate = execSync('git ls-files "src/app/practice/**/*.tsx"', { encoding: "utf8" })
    .split("\n").filter(Boolean);
  const SOURCE_RENDER = /\{[^}]*\.sources\b[^}]*\}|sources\.join\(/;
  const renders = estate.filter(f => {
    const src = stripComments(readFileSync(join(process.cwd(), f), "utf8"));
    return SOURCE_RENDER.test(src);
  });
  ok("9d. no practitioner screen renders a metric's source columns",
    renders.length === 0, renders.join(", "));
  ok("9d-control. the detector recognises a real render of source columns",
    SOURCE_RENDER.test('<p>From: {sources.join(" · ")}</p>'));
}

// ══ 10. JSX TEXT, WHICH EVERY EARLIER SECTION WAS BLIND TO ════════════════════════════════════
//
// ⚠ THIS WHOLE SECTION EXISTS BECAUSE THE s9 SWEEP DECLARED THE APP LAYER CLEAN AND IT WAS NOT.
//
// Sections 2 and 8 scan string LITERALS -- "..." and `...`. A practitioner-facing sentence in a React
// component is usually neither: it is bare text between tags, and no quote character appears anywhere
// near it. Nineteen leaks lived in that gap, including "The design puts a Scan ID button here, and
// CPR-V5-006 marks barcode and QR scanning as future" on the walk-in registration drawer -- found by
// opening the screen, not by any tool here.
//
// The lesson is not "add a regex". It is that a scanner encodes an assumption about where text lives,
// and a clean report from it means only that the assumption held.
section("10. no internal identifier in JSX text");
{
  const JSX_TEXT = />([^<>{}]{25,400})</g;
  const BANNED = /\b(CPR|COMP|PLAT|IAM|WEB|GOV)-[A-Z0-9]{2,}(-[0-9]+)?\b|\bs[0-9]{1,2}\.[0-9]\b|\bPhase [0-9]\b|\bmigration [0-9]{2,3}\b/i;
  const screens = execSync('git ls-files "src/app/practice/**/*.tsx"', { encoding: "utf8" })
    .split("\n").filter(Boolean);
  const leaks: string[] = [];
  for (const f of screens) {
    const src = stripComments(readFileSync(join(process.cwd(), f), "utf8"));
    for (const m of src.matchAll(JSX_TEXT)) {
      const t = m[1].replace(/\s+/g, " ").trim();
      if (t.split(" ").length < 5 || !BANNED.test(t)) continue;
      leaks.push(`${f.split("/").pop()}: ${t.slice(0, 70)}`);
    }
  }
  ok("10a. ⚠ no sentence rendered as JSX text names a spec, section, phase or migration",
    leaks.length === 0, leaks.slice(0, 3).join(" | "));
  ok("10a-control. the detector sees a real one in JSX-text position",
    (() => {
      const sample = '<p className="x">The design puts a Scan ID button here, and CPR-V5-006 marks scanning as future.</p>';
      const m = [...sample.matchAll(JSX_TEXT)].map(x => x[1]);
      return m.length > 0 && m.some(t => BANNED.test(t));
    })());
}

// ⚠ THE STRIPPER NEEDS ITS OWN CONTROL. One that blanked the whole file would make every 7a green,
// and a green 7a is exactly what a broken stripper looks like from the outside.
ok("7-control. the stripper removes comments WITHOUT emptying the file",
  (() => {
    const raw = readFileSync(join(process.cwd(), screens[0]), "utf8");
    const cut = stripComments(raw);
    return cut.length > raw.length * 0.4 && !/technicalDetail/.test(cut) && /technicalDetail/.test(raw);
  })(),
  "the comment naming technicalDetail must go; the code around it must stay");

console.log(`\n${fail === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
