/**
 * CPR-MOB-001 PHASES 9 AND 10 -- THE RESPONSIVE SYSTEM'S REGRESSION SUITE AND ITS FREEZE.
 *
 * Phase 9 is "accessibility, device matrix, performance and state-preservation regression testing".
 * Phase 10 is "freeze the responsive design system and prohibit page-specific exceptions without
 * design-system review". This one file is both, because they are the same mechanism seen twice: the
 * pins that catch a regression are the pins that make the freeze mean something.
 *
 * ⚠ WHAT THIS FILE CANNOT DO, STATED FIRST SO NOBODY READS 40 GREEN PINS AS A DEVICE PASS.
 * s20's matrix is a list of RENDERED WIDTHS -- 360x640, 390x844, 430x932, 768x1024, 1024x768, >=1200,
 * plus text scaling to 200% and keyboard-only operation. Every one of those is a statement about
 * pixels in a signed-in browser, and this process has no browser and no session. What a source harness
 * can prove is the LAYER UNDERNEATH: that the tokens the layout is measured in still exist, that no
 * page has quietly invented its own breakpoint, that the idiom is implemented once rather than copied,
 * and that the two rules with teeth (the clock, the flush) hold product-wide. The rendered pass at
 * each width remains the owner's, signed in, and this file does not shorten it by one screen.
 *
 * WHAT IT PINS -- PROPERTIES, NEVER TALLIES. The recorded lesson in this repo is that a pinned count
 * goes red against correct work; a count appears below in exactly one place, as a RATCHET that may
 * only fall (section 2), and it is labelled as debt rather than as health.
 *
 *   1. s4 FOUNDATION -- the four touch/safe-area tokens are defined, and every --cp- token any
 *      practice surface references resolves to a definition. A deleted token does not throw: it makes
 *      min-h-[var(--cp-touch)] collapse to nothing, and a 44px target silently becomes a 0px one.
 *   2. THE CLOCK, PRODUCT-WIDE -- native time and datetime-local pickers are a ratcheted inventory.
 *      The cleaned surfaces must stay clean; the surfaces still holding them may not grow.
 *   3. PATTERN INTEGRITY -- every pattern= in the app COMPILES, and every one shaped like a time
 *      pattern is EXECUTED against real strings. Four of these once shipped with their backslashes
 *      eaten, and the pin of the day only checked that a pattern existed.
 *   4. s19 ONE IMPLEMENTATION -- one useBelowMd; every viewport query asks about the same md edge; no
 *      file invents a breakpoint as an arbitrary Tailwind variant either; and the four order-*
 *      utilities that exist stay bounded to max-md. This is the group that literally enforces phase
 *      10's "no page-specific exceptions", on both the JS and the CSS side of the door.
 *   5. s18 PERFORMANCE AND STATE PRESERVATION -- Practice imports no third-party runtime package
 *      beyond next and react, so there is no heavy chart to lazy-load; and the encounter draft
 *      flushes on visibilitychange, with beforeunload never the only listener because mobile
 *      browsers are documented not to fire it.
 *   6. s17 ACCESSIBILITY -- an interactive element that suppresses its focus outline puts a treatment
 *      back. Scoped to elements a keyboard stops on, because the sheet CONTAINERS suppress theirs on
 *      purpose and a blanket ban would be "fixed" by making the product worse.
 *   7. PHASE 10 FREEZE -- the doctrine document exists, and every surface it claims carries a mobile
 *      face actually carries one. A freeze that names screens which no longer exist is a fiction.
 *
 *   npx --yes tsx scripts/practice-responsive-harness.ts
 *
 * Source pins and pure constants only: no database, no env, no dev server. The freeze is a statement
 * about the CODE, so it must stay runnable on a bare checkout.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
// The single 24-hour definition, imported so the pin below executes THE THING THE PRODUCT USES rather
// than a copy of it retyped here -- a harness that restates its expectation proves only self-equality.
import { HHMM_PATTERN, HHMM_RE } from "../src/lib/practice/practice-time";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const ROOT = process.cwd();
const rel = (p: string) => relative(ROOT, p).split("\\").join("/");

const walk = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
};

/**
 * ⚠ COMMENTS ARE STRIPPED BEFORE ANY NEEDLE IS SCANNED FOR.
 *
 * This repo has paid for the opposite twice. Half the files that mention type="time" mention it in a
 * comment explaining WHY they do not use it -- and a scanner that reads those comments reports the
 * documentation of a rule as a violation of it, or worse, reports a rule as satisfied because its own
 * explanation matched. Strip first, scan second, always.
 */
const strip = (s: string) => s
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const APP = join(ROOT, "src", "app");
const PRACTICE = join(APP, "practice");
const APP_FILES = walk(APP);
const PRACTICE_FILES = walk(PRACTICE);

console.log("\nCPR-MOB-001 -- responsive regression and freeze\n");
console.log(`  (read ${APP_FILES.length} app files, ${PRACTICE_FILES.length} of them under practice)\n`);

// ---------------------------------------------------------------------------------------------
// 1. s4 FOUNDATION -- the tokens the whole system is measured in
// ---------------------------------------------------------------------------------------------
console.log("1. s4 foundation -- touch, safe area, and every token that resolves");

const globalsPath = join(APP, "globals.css");
const globals = readFileSync(globalsPath, "utf8");

const REQUIRED_TOKENS = ["--cp-touch", "--cp-touch-primary", "--cp-safe-bottom", "--cp-bottomnav-h"];
for (const t of REQUIRED_TOKENS) {
  // the definition, not a mention: the token name followed by a colon
  ok(`1a ${t} is defined in globals.css`, new RegExp(`${t}\\s*:`).test(globals));
}

// s4 fixes the two touch sizes at 44 and 48. A later edit that "tidied" these to 40 would pass every
// class-name pin in the repo while shrinking every target below the accessible minimum.
ok("1b --cp-touch is 44px and --cp-touch-primary is 48px",
  /--cp-touch\s*:\s*44px/.test(globals) && /--cp-touch-primary\s*:\s*48px/.test(globals));

// ⚠ THE REAL FOUNDATION PIN, AND IT EXECUTES RATHER THAN GREPS.
// Collect every --cp- token any practice surface actually references, collect every one globals.css
// defines, and assert the first set is inside the second. This is self-maintaining: a new token needs
// no edit here, but a DELETED one turns red immediately -- which matters because CSS does not throw on
// an undefined custom property. min-h-[var(--cp-touch)] with no --cp-touch is not an error, it is a
// zero-height button, and it would sail past every other assertion in this file.
const defined = new Set([...globals.matchAll(/(--cp-[a-z0-9-]+)\s*:/g)].map(m => m[1]));
const referenced = new Map<string, string>();
for (const f of PRACTICE_FILES)
  for (const m of readFileSync(f, "utf8").matchAll(/var\((--cp-[a-z0-9-]+)/g))
    if (!referenced.has(m[1])) referenced.set(m[1], rel(f));

const dangling = [...referenced].filter(([t]) => !defined.has(t));
ok("1c every --cp- token referenced by a practice surface resolves to a definition",
  dangling.length === 0,
  dangling.map(([t, f]) => `${t} (first seen ${f})`).join(", "));

// control: the scan read something real, and would notice a missing token
ok("1c-control the token scan actually found references and would catch a deletion",
  referenced.size >= 8 && defined.size >= referenced.size && !defined.has("--cp-token-that-does-not-exist"),
  `referenced=${referenced.size} defined=${defined.size}`);

// ---------------------------------------------------------------------------------------------
// 2. THE CLOCK -- a flat ban inside Practice, a ratchet outside it
// ---------------------------------------------------------------------------------------------
console.log("\n2. the 24-hour clock -- no native picker in Practice, and a ratchet beyond it");

/**
 * A native time or datetime-local input draws whatever the OPERATING SYSTEM's locale says, so a 24-hour
 * product renders "11:00 AM" on any machine set to en-US. And when a datetime-local value reaches a
 * timestamptz, the offsetless string is read in the connection's zone: a Kampala 14:30 stored as 14:30
 * UTC and read back as 17:30. Both halves were paid for on the encounters screen on 2026-08-17.
 *
 * ⚠ THIS PIN USED TO BE A RATCHET OVER SEVENTEEN RECORDED INSTANCES, and it is now a FLAT BAN, because
 * the debt was paid rather than merely bounded: the wall-clock fields moved to the shared TimeInput,
 * and the six that composed instants -- ActivityConsole's two and OfflineReader's four -- now capture a
 * date and a 24-hour time and compose them where the practice's timezone is actually known (the route,
 * or on a device, the day pack). What was found on the way is worth keeping in view: ActivityConsole
 * prefilled from `new Date().toISOString().slice(0,16)`, UTC's wall clock poured into a control the
 * browser draws as local, so its "now" default sat three hours behind in Kampala.
 */
const pickerCounts = new Map<string, number>();
for (const f of APP_FILES) {
  const hits = [...strip(readFileSync(f, "utf8")).matchAll(/type="(?:time|datetime-local)"/g)].length;
  if (hits) pickerCounts.set(rel(f), hits);
}

const inPractice = [...pickerCounts].filter(([f]) => f.startsWith("src/app/practice/"));
ok("2a no surface in Practice holds a native time or datetime-local picker",
  inPractice.length === 0,
  inPractice.map(([f, n]) => `${f} (${n})`).join(", "));

/**
 * ⚠ THE REST OF THE ESTATE IS DEBT, RECORDED RATHER THAN CLAIMED CLEAN.
 *
 * Thirteen native pickers live outside Practice, in products this arc did not touch. They are a
 * RATCHET: a listed file may hold fewer and may leave the list, but never more, and a file NOT listed
 * may hold none. So the debt can only shrink and no new instance can arrive anywhere in src/app.
 *
 * The datetime-local entries here carry the same instant-composition hazard as ActivityConsole's did,
 * and should be read as unexamined rather than as safe -- nobody has traced what their values reach.
 */
const PICKER_DEBT_OUTSIDE_PRACTICE: Record<string, number> = {
  "src/app/admin/operations/OperationsConsole.tsx": 1,
  "src/app/assessor/calendar/ScheduleForm.tsx": 1,
  "src/app/assessor/simulation/SimCentre.tsx": 1,
  "src/app/educator/coaching/CoachingBoard.tsx": 1,
  "src/app/healthcare-worker/medications/AddMedication.tsx": 1,
  "src/app/office-governance/meetings/MeetingsAdmin.tsx": 1,
  "src/app/super-admin/platform-ops/forms/FormDesigner.tsx": 2,
  "src/app/super-admin/platform-ops/releases/ReleaseManager.tsx": 1,
  "src/app/supervisor/mdt/MdtActions.tsx": 2,
  "src/app/supervisor/settings/WardConfigClient.tsx": 1,
  "src/app/supervisor/task-center/TaskConsole.tsx": 1,
};

const strayOutside = [...pickerCounts].filter(([f, n]) =>
  !f.startsWith("src/app/practice/")
  && (!(f in PICKER_DEBT_OUTSIDE_PRACTICE) || n > PICKER_DEBT_OUTSIDE_PRACTICE[f]));
ok("2b outside Practice, no file has gained a native picker and no new file holds one",
  strayOutside.length === 0,
  strayOutside.map(([f, n]) => `${f} now ${n}, recorded ${PICKER_DEBT_OUTSIDE_PRACTICE[f] ?? 0}`).join(", "));

/**
 * ⚠ CONTROL, AND IT IS LOAD-BEARING. Many Practice files contain the string type="time" INSIDE a
 * comment explaining why they do not use one. If strip() ever broke, 2a would go red for the best
 * possible reason and be "fixed" by deleting the explanations. So prove the raw text DOES contain what
 * the stripped text does not: the ban above is being enforced against code, not against prose.
 */
const practiceRaw = PRACTICE_FILES.map(f => readFileSync(f, "utf8"));
ok("2a-control Practice does document the rule in prose, so the stripper has real work to do",
  practiceRaw.some(s => /type="time"/.test(s)),
  "if this fails, the explanations were deleted -- 2a would then be passing over nothing");

// ⚠ THE STRIPPER IS PROVED ON ITS OWN PROBE, NOT ON THE CORPUS. Testing it against the real files
// made this control fail whenever 2a failed, which is the wrong signal: a genuine violation would then
// read as "the stripper broke". A fixed probe keeps the two answers independent.
ok("2a-control2 stripping removes the needle from a comment and leaves it in code",
  !/type="time"/.test(strip(`// a note about type="time"\n`))
  && !/type="time"/.test(strip(`{/* a note about type="time" */}\n`))
  && /type="time"/.test(strip(`<input type="time" />\n`)));

/**
 * ⚠ AND THE COMPOSITION, WHICH IS THE HALF A PICKER SCAN CANNOT SEE. Swapping the control fixes the
 * 12-hour display; it does not by itself fix WHERE the instant is composed. Both screens that used to
 * compose one on the client now name the practice timezone, and these pins say so by the imports the
 * fix depends on -- so ripping the composition out again cannot pass quietly.
 */
const activitiesRoute = strip(readFileSync(join(APP, "api", "v1", "practice", "activities", "route.ts"), "utf8"));
// ⚠ REPOINTED 2026-08-21. This pinned `workspaceClock`, the per-call helper that read the timezone
// once per request. WorkspaceContext now CARRIES workspaceTimezone, so the helper is gone from this
// route and the zone arrives already resolved -- the same guarantee, established earlier and in one
// place. Pinning the helper's NAME made a deliberate improvement look like a regression, which is the
// standing lesson about pinning a mechanism you are actively trying to change. What matters is that
// the zone comes from the PRACTICE and the instant is composed on the SERVER, so that is what is
// pinned: either source of the practice zone, and never a bare client-side Date.
const PRACTICE_ZONE_SOURCE = /workspaceClock|ctx\.workspaceTimezone/;
ok("2d the activities route composes a wall clock server-side, in the practice's timezone",
  /instantInZone/.test(activitiesRoute)
  && PRACTICE_ZONE_SOURCE.test(activitiesRoute)
  && !/new Date\((?:body|x)\.\w+At\)/.test(activitiesRoute));
ok("2d-control the pin rejects a route that composes the instant from the device instead",
  !PRACTICE_ZONE_SOURCE.test("const at = new Date(d + 'T' + t);"));

const offlineReader = strip(readFileSync(join(PRACTICE, "offline", "OfflineReader.tsx"), "utf8"));
ok("2e the offline capture forms compose in the practice's timezone, not the device's",
  /instantInZone/.test(offlineReader)
  && !/new Date\((?:takenAt|startedAt|endedAt)\)/.test(offlineReader));

// ---------------------------------------------------------------------------------------------
// 3. PATTERN INTEGRITY -- compiled and executed, never grepped
// ---------------------------------------------------------------------------------------------
console.log("\n3. pattern integrity -- every pattern compiles, every time pattern is executed");

/**
 * ⚠ THE PIN THAT DID NOT CATCH IT. Four pattern= attributes once shipped as [01]?d instead of
 * [01]?\d, because a heredoc ate the backslashes -- and the assertion covering them checked only that
 * a pattern attribute EXISTED. It existed. It also rejected "09:00", which is the entire set of values
 * the control is for. A pattern is executable, so it gets executed.
 */
const patterns: { src: string; file: string }[] = [];
for (const f of APP_FILES)
  for (const m of strip(readFileSync(f, "utf8")).matchAll(/pattern="([^"]+)"/g))
    patterns.push({ src: m[1], file: rel(f) });

const uncompilable = patterns.filter(p => { try { new RegExp(p.src); return false; } catch { return true; } });
ok("3a every pattern= attribute in the app compiles as a regular expression",
  uncompilable.length === 0,
  uncompilable.map(p => `${p.src} in ${p.file}`).join(", "));

const ACCEPT = ["09:00", "9:00", "23:59", "00:00", "14:30"];
const REJECT = ["24:00", "09:60", "9:00 AM", "0900", "", "11:00 PM"];
const behaves = (source: string) => {
  let re: RegExp;
  try { re = new RegExp(source); } catch { return false; }
  return ACCEPT.every(v => re.test(v)) && REJECT.every(v => !re.test(v));
};

/**
 * ⚠ REPOINTED AT THE DEFINITION RATHER THAN AT ITS COPIES (2026-08-17).
 *
 * This first executed every time-shaped `pattern=` LITERAL in the app, and required at least one to
 * exist -- which was right while six screens each carried their own copy. Now that HHMM_PATTERN is
 * the single definition and TimeInput is the only thing that writes the attribute, the literals are
 * disappearing by design, and a pin demanding they exist would go red for the work succeeding: the
 * exact "never pin something you are actively trying to change" trap this repo has hit repeatedly.
 *
 * So the executable assertion moves to the definition itself, which is where every control now gets
 * its pattern from -- and 3c keeps executing any literal that still exists, without requiring any.
 */
ok("3b the one 24-hour definition accepts real times and refuses 12-hour and out-of-range ones",
  behaves(HHMM_PATTERN) && behaves(HHMM_RE.source) && HHMM_RE.source === HHMM_PATTERN,
  `HHMM_PATTERN=${HHMM_PATTERN} HHMM_RE=${HHMM_RE.source}`);

// Any literal that DOES still exist is executed too -- a screen writing its own pattern is not
// forbidden, it just cannot write a broken one. No floor: zero literals is the destination.
const timePatterns = patterns.filter(p => /2\[0-3\]|:\[0-5\]/.test(p.src));
const misbehaving = timePatterns.filter(p => !behaves(p.src));
ok("3c every hand-written time pattern still in the app behaves the same as the definition",
  misbehaving.length === 0,
  misbehaving.map(p => `${p.src} in ${p.file}`).join(", "));

// control: the executor can actually fail -- a deliberately broken pattern must not pass the same test
const brokenProbe = new RegExp("^([01]?d|2[0-3]):[0-5]d$");
ok("3b-control the backslash-eaten form of the same pattern is rejected by this test",
  !ACCEPT.every(v => brokenProbe.test(v)),
  "if this passes, 3b proves nothing");

// ---------------------------------------------------------------------------------------------
// 4. s19 ONE IMPLEMENTATION -- and phase 10's actual teeth
// ---------------------------------------------------------------------------------------------
console.log("\n4. s19 one implementation -- one hook, one breakpoint, no page-specific exceptions");

const hookDefs = PRACTICE_FILES.filter(f => /export function useBelowMd|export default function useBelowMd/
  .test(strip(readFileSync(f, "utf8"))));
ok("4a useBelowMd is defined exactly once", hookDefs.length === 1, hookDefs.map(rel).join(", "));

/**
 * ⚠ THIS IS PHASE 10 IN ONE ASSERTION.
 *
 * "Prohibit page-specific exceptions without design-system review" is not enforceable as prose. It is
 * enforceable as this: every VIEWPORT query in Practice asks about the same edge. Tailwind's md is
 * 768px, so the JS side must ask 767px and nothing else -- a page that decides its own content
 * "really needs" 820px has made the CSS face and the JS face disagree on the same screen, which is the
 * exact failure a focus trap running against a display:none element produces.
 *
 * prefers-color-scheme and prefers-reduced-motion are deliberately NOT viewport queries and are not
 * counted: they ask about the user, not the width.
 */
const viewportQueries: { q: string; file: string }[] = [];
for (const f of PRACTICE_FILES)
  for (const m of strip(readFileSync(f, "utf8")).matchAll(/matchMedia\??\.?\(\s*["'`]([^"'`]+)["'`]/g))
    if (/width/.test(m[1])) viewportQueries.push({ q: m[1], file: rel(f) });

/**
 * ⚠ REPOINTED SAME DAY, BY PHASE 8, AND THE DISTINCTION IS THE POINT. This pin first accepted the one
 * literal string "(max-width: 767px)", and the tablet work turned it red with "(min-width: 768px)" in
 * MobileBottomNav. That is not a second breakpoint -- 767 and 768 are the two sides of ONE edge -- and
 * the query is there for a real reason: the More sheet is md:hidden, but its scroll lock and focus
 * trap are STATE, and state does not read a media query. Rotating a 390x844 phone to landscape lands
 * in the tablet band, which would leave an invisible sheet holding the page unscrollable with Tab
 * cycling inside it. So both polarities of the md edge ARE the system; anything else is the
 * page-specific exception phase 10 forbids, and a genuine need for the 1200px edge arrives here
 * holding its reason rather than being quietly added to the set.
 */
const MD_EDGE = new Set(["(max-width:767px)", "(min-width:768px)"]);
const strayEdges = viewportQueries.filter(v => !MD_EDGE.has(v.q.replace(/\s+/g, "")));
ok("4b every viewport query in Practice asks about the one md edge, in either polarity",
  viewportQueries.length > 0 && strayEdges.length === 0,
  strayEdges.map(v => `${v.q} in ${v.file}`).join(", "));

/**
 * ⚠ 4d IS 4b's TWIN ON THE CSS SIDE, and without it 4b only guards half the door. A page cannot
 * invent a breakpoint in JavaScript any more -- but Tailwind will happily accept min-[820px]: as an
 * arbitrary variant, which is the same page-specific exception written in a place the matchMedia scan
 * cannot see. There are none in the whole of src today, so this is a property, not a ratchet.
 */
const arbitraryVariants: string[] = [];
for (const f of walk(join(ROOT, "src")))
  for (const m of strip(readFileSync(f, "utf8")).matchAll(/\b(?:max|min)-\[\d+px\]:/g))
    arbitraryVariants.push(`${m[0]} in ${rel(f)}`);
ok("4d no file invents its own breakpoint as an arbitrary Tailwind variant",
  arbitraryVariants.length === 0, [...new Set(arbitraryVariants)].slice(0, 5).join(", "));

/**
 * ⚠ 4e BOUNDS THE ONE EXCEPTION THE DOCTRINE ALLOWS. "DOM order is visual order is focus order" is the
 * rule, and four order-* utilities exist against it -- all inside a single control cluster, all
 * max-md:-scoped, each with a recorded reason (a wrapped warning sentence gets its own line; the large
 * Reschedule control sits under the obligation it moves). That is a bounded, mobile-only exception.
 * What must never happen is an order-* that applies at DESKTOP or unconditionally, because that
 * reorders a whole page for a mouse and a screen reader differently, permanently, with no width to
 * blame. So the pin is not "no order utilities" -- it is "every one of them is max-md:".
 */
const looseOrder: string[] = [];
for (const f of PRACTICE_FILES)
  for (const m of strip(readFileSync(f, "utf8")).matchAll(/(\S*)\border-(?:first|last|none|\d+)\b/g))
    if (!m[1].endsWith("max-md:")) looseOrder.push(`${m[0]} in ${rel(f)}`);
ok("4e every order utility in Practice is scoped to max-md, never desktop or unconditional",
  looseOrder.length === 0, [...new Set(looseOrder)].slice(0, 5).join(", "));

// The card fallback and sheet primitives are shared, not re-implemented per page (s19).
const RESP = join(PRACTICE, "(shell)", "_responsive");
for (const p of ["CardList.tsx", "FilterSheet.tsx", "FullScreenSheet.tsx", "SectionTabs.tsx",
  "StickyPrimaryAction.tsx", "use-body-scroll-lock.ts"])
  ok(`4c the shared primitive ${p} exists`, existsSync(join(RESP, p)));

// ---------------------------------------------------------------------------------------------
// 5. s18 STATE PRESERVATION
// ---------------------------------------------------------------------------------------------
console.log("\n5. s18 performance and state preservation -- what Practice ships, and the flush that survives");

/**
 * ⚠ THE PERFORMANCE HALF OF s18, WHICH IS SATISFIED BY CONSTRUCTION RATHER THAN BY WORK -- and that is
 * worth pinning precisely BECAUSE it was free. s18 asks pages to "lazy-load secondary analytics and
 * heavy charts" and to "avoid unnecessary large chart payloads on mobile networks". Practice has no
 * chart library to lazy-load: it draws its visualisations as hand-rolled SVG, and the only bare
 * modules any of its 299 files import are next and react. Zero third-party runtime weight.
 *
 * So there is nothing to fix and everything to protect. The day somebody reaches for a charting
 * package, this pin goes red -- not to forbid it, but to make lazy-loading a decision taken at the
 * moment it becomes necessary rather than discovered later on a clinic's mobile connection.
 */
const FRAMEWORK = /^(?:next|react)(?:\/|$)/;
const heavyImports: string[] = [];
for (const f of PRACTICE_FILES) {
  const s = strip(readFileSync(f, "utf8"));
  const specs = [
    ...[...s.matchAll(/^\s*import\s[\s\S]*?\sfrom\s+["']([^"']+)["']/gm)].map(m => m[1]),
    ...[...s.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map(m => m[1]),
    ...[...s.matchAll(/\bimport\(\s*["']([^"']+)["']/g)].map(m => m[1]),
  ];
  for (const sp of specs)
    if (!sp.startsWith(".") && !sp.startsWith("@/") && !FRAMEWORK.test(sp))
      heavyImports.push(`${sp} in ${rel(f)}`);
}
ok("5-perf Practice imports no third-party runtime package beyond next and react",
  heavyImports.length === 0, [...new Set(heavyImports)].slice(0, 5).join(", "));

const consolePath = join(PRACTICE, "(shell)", "encounters", "[encounterId]", "EncounterConsole.tsx");
const consoleSrc = strip(readFileSync(consolePath, "utf8"));
ok("5a the encounter console flushes its draft on visibilitychange",
  /addEventListener\(\s*["']visibilitychange["']/.test(consoleSrc));

/**
 * ⚠ beforeunload IS NOT A MOBILE EVENT. iOS Safari and Chrome on Android are both documented not to
 * fire it when a tab is backgrounded or the app is switched away from -- which on a phone is how a
 * form is nearly always left. A file may still use it as a desktop-only extra, but never alone.
 */
const soleBeforeUnload = PRACTICE_FILES.filter(f => {
  const s = strip(readFileSync(f, "utf8"));
  return /addEventListener\(\s*["'](?:beforeunload|pagehide)["']/.test(s)
    && !/addEventListener\(\s*["']visibilitychange["']/.test(s);
});
ok("5b no practice surface relies on beforeunload or pagehide as its only flush",
  soleBeforeUnload.length === 0, soleBeforeUnload.map(rel).join(", "));

// ---------------------------------------------------------------------------------------------
// 6. s17 ACCESSIBILITY -- the half of s20's matrix that source can actually speak to
// ---------------------------------------------------------------------------------------------
console.log("\n6. s17 accessibility -- keyboard operation survives the outline being suppressed");

/**
 * ⚠ THE PIN IS ABOUT INTERACTIVE ELEMENTS, AND THE DISTINCTION IS THE WHOLE ASSERTION.
 *
 * "Keyboard-only operation" is in s20's matrix, and the commonest way a product fails it is
 * outline-none applied for looks with nothing put back -- focus still moves, but invisibly, so a
 * keyboard user is typing into a form they cannot locate.
 *
 * But a blanket ban would be WRONG and would be "fixed" by making the product worse. Five sheet and
 * dialog CONTAINERS in Practice suppress their outline on purpose: they take focus programmatically
 * via tabIndex={-1} when they open, and a ring drawn around an entire modal panel is noise, not an
 * affordance. So the rule is scoped to elements a keyboard actually stops on -- button, input, a,
 * select, textarea -- and any focus treatment counts, a ring or a border or a background, because a
 * visible change is the requirement and Tailwind has many ways to spell one.
 */
const INTERACTIVE_TAG = /^(?:button|input|a|select|textarea)$/;
const unfocusable: string[] = [];
let outlineSuppressors = 0;
for (const f of PRACTICE_FILES) {
  for (const m of readFileSync(f, "utf8")
    .matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const cls = m[2] ?? m[3] ?? "";
    if (!/\boutline-none\b/.test(cls) || !INTERACTIVE_TAG.test(m[1].toLowerCase())) continue;
    outlineSuppressors++;
    const others = cls.replace(/focus(?:-visible)?:outline-none/g, "");
    if (!/focus:|focus-visible:/.test(others)) unfocusable.push(`<${m[1]}> in ${rel(f)}`);
  }
}
ok("6a every interactive element that suppresses its outline puts a focus treatment back",
  outlineSuppressors > 0 && unfocusable.length === 0, unfocusable.join(", "));
ok("6a-control the scan found real outline-suppressing controls to judge",
  outlineSuppressors >= 5, `found ${outlineSuppressors}`);

// ---------------------------------------------------------------------------------------------
// 7. PHASE 10 -- the freeze document, and whether it still describes the product
// ---------------------------------------------------------------------------------------------
console.log("\n7. phase 10 freeze -- the doctrine exists and still describes real screens");

const DOC = join(ROOT, "docs", "CPR-MOB-001-RESPONSIVE-FREEZE.md");
ok("7a the responsive freeze doctrine is written down", existsSync(DOC));

if (existsSync(DOC)) {
  const doc = readFileSync(DOC, "utf8");
  ok("7b the doctrine states the breakpoint edge it freezes", /767|768/.test(doc));
  ok("7c the doctrine states the exception route rather than merely forbidding exceptions",
    /design-system review/i.test(doc));

  /**
   * ⚠ A FREEZE THAT NAMES SCREENS WHICH NO LONGER EXIST IS A FICTION, and it is the failure mode of
   * every frozen document in this repo that was not executed. So the surfaces the doctrine claims are
   * frozen are read OUT OF THE DOCUMENT and checked against the tree: the directory must exist, and
   * something under it must actually carry a mobile face. Renaming a folder without updating the
   * freeze turns this red, which is the point.
   *
   * A surface line looks like:   - `today` -- Current Session
   */
  const claimed = [...doc.matchAll(/^-\s+`([a-z0-9[\]()/_-]+)`/gim)].map(m => m[1]);
  const missing = claimed.filter(s => !existsSync(join(PRACTICE, "(shell)", s)));
  ok("7d every surface the doctrine freezes still exists", claimed.length > 0 && missing.length === 0,
    missing.join(", "));

  const faceless = claimed.filter(s => {
    const dir = join(PRACTICE, "(shell)", s);
    if (!existsSync(dir)) return false;
    return !walk(dir).some(f => /max-md:|md:hidden/.test(readFileSync(f, "utf8")));
  });
  ok("7e every frozen surface still carries a mobile face", faceless.length === 0, faceless.join(", "));
}

// ---- 8. ⚠ THE min-width:auto TRAP ------------------------------------------------------------
//
// A grid item's min-width defaults to AUTO: it refuses to shrink below its content's intrinsic width.
// So a wide table inside a grid column is not scrolled by the overflow-x-auto wrapped around it -- it
// sets the COLUMN's floor instead, and the whole PAGE scrolls sideways. The scroller is still in the
// markup, still correct-looking, and completely inert.
//
// Three times now: EncounterConsole, PathwaysWorkspace, BulkWorkspace. Each paired an overflow-x-auto
// with a min-w-[Npx] table inside a [1fr_...] column whose child carried no min-w-0. Fixing the third
// without pinning the shape only waits for the fourth.
//
// ⚠ Deliberately narrow: it fires only where a file BOTH declares a [1fr_...] grid AND contains a
// horizontal scroller -- exactly the combination that traps. One without the other is not a candidate.
{
  const GRID_1FR = /grid-cols-\[[^\]]*1fr[^\]]*\]/;
  const SCROLLER = /overflow-x-auto|TABLE_SCROLL/;
  // The element opening immediately after the 1fr grid declaration is the column that must not
  // establish a floor. 400 chars is enough to clear the grid div's own attributes and reach it.
  const FIRST_CHILD = /grid-cols-\[[^\]]*1fr[^\]]*\][^]{0,400}?<(?:section|div)\s+className="([^"]*)"/;

  const candidates = PRACTICE_FILES.filter(f => {
    if (!f.endsWith(".tsx")) return false;
    const src = readFileSync(f, "utf8");
    return GRID_1FR.test(src) && SCROLLER.test(src);
  });
  const trapped = candidates.filter(f => {
    const m = readFileSync(f, "utf8").match(FIRST_CHILD);
    return m ? !m[1].includes("min-w-0") : false;
  }).map(f => relative(ROOT, f));

  ok("8a a 1fr column holding a horizontal scroller carries min-w-0, so the table scrolls and not the page",
    trapped.length === 0, trapped.slice(0, 3).join(" | "));
  ok("8a-control the scan finds candidate files at all, so it cannot pass by matching nothing",
    candidates.length > 0);
  ok("8a-control2 the child pattern reads the className it is meant to judge",
    FIRST_CHILD.test('<div className="grid lg:grid-cols-[1fr_260px]">\n  <section className="min-w-0 rounded-xl">')
      && !GRID_1FR.test('<div className="grid lg:grid-cols-2">'));
}

// ── CPR-CC-MOB-001: THE CORRECTIVE, PINNED ────────────────────────────────────────────────────
//
// ⚠ TWO OF THE SEVEN DEFECTS WERE ALREADY FIXED WHEN THE SPECIFICATION ARRIVED, and knowing which
// mattered more than the code did. MCC-01 (count-less cards) was closed on 2026-08-21 and MCC-06
// (zero cards visible) has been closed at source for longer -- operationsHome only emits an item when
// its count exceeds zero. The screenshots the spec was written from predate the first of those, so
// re-implementing both would have been work that changed nothing while appearing to fix a real
// report. These assertions hold the closed ones closed and the new ones honest.
{
  const ops = readFileSync("src/lib/practice/operations-home.ts", "utf8");
  const home = readFileSync("src/app/practice/(shell)/home/page.tsx", "utf8");

  // MCC-05 / s7: the count leads. "4 overdue follow-ups", never "Overdue follow-ups · 4".
  ok("9a MCC-05 the mobile attention card renders a count-led label",
    home.includes("countLed(a.kind, a.count, a.title)")
    && !home.includes("` · ${a.count}`"));

  // s11: locale-aware pluralisation. Both forms written out, never a suffix rule.
  const kinds = [...ops.matchAll(/kind: "([a-z_]+)", severity/g)].map(m => m[1]);
  const labelled = [...ops.matchAll(/^  ([a-z_]+): \{ one: "/gm)].map(m => m[1]);
  const missing = [...new Set(kinds)].filter(k => !labelled.includes(k));
  ok("9b every attention kind emitted has a count-led label",
    kinds.length > 0 && missing.length === 0, `unlabelled: ${missing.join(", ")}`);

  ok("9c singular and plural are both written out, so '1 follow-ups' is unrepresentable",
    !/one: "([^"]+)s", many: "\1s"/.test(ops) && ops.includes('one: "patient waiting", many: "patients waiting"'));

  // MCC-03 / s9: Planner is the secondary handoff; Reports is not its equal.
  ok("9d MCC-03 Planner and Reports are no longer equal-weight halves of one row",
    home.includes("Open Planner →") && !home.includes("flex gap-2 md:hidden"));

  // ⚠ NOT DELETED. s16: "Do not delete any activity type; use progressive disclosure" is about the
  // launcher, and the same restraint applies here -- Reports stays reachable, demoted rather than
  // removed, because deleting a door somebody uses is not decluttering.
  ok("9e and Reports is demoted rather than removed",
    home.includes('href="/practice/reports"'));

  // MCC-06, already true at source. Pinned because the spec asks for it and because a future edit that
  // emitted zero-count items would put five "0 ..." rows on a phone.
  ok("9f MCC-06 attention items are only emitted above zero",
    /if \(followUps\.overdue\.length > 0\)/.test(ops) && /if \(unsigned\.length > 0\)/.test(ops));

  // ── MCC-02 / s8: FOUR PRIMARIES AND A SHEET, WITH NOTHING LOST ──────────────────────────────
  const act = readFileSync("src/lib/practice/activity-constants.ts", "utf8");
  const start = readFileSync("src/app/practice/(shell)/home/StartYourDay.tsx", "utf8");

  ok("9g MCC-02 the phone offers four primary activities, not thirteen",
    start.includes("{PRIMARY_ACTIVITY_TYPES.map(activityButton)}")
    && start.includes("More activities ({SECONDARY_ACTIVITY_TYPES.length})"));

  // ⚠⚠ THE ONE THAT MATTERS MOST, because "show fewer buttons" is one careless edit away from
  // "offer fewer activities". s16: "Do not delete any activity type; use progressive disclosure."
  // Derived from the same array, so the two lists cannot drift apart -- and asserted anyway, because
  // the derivation is one line somebody could replace with a literal.
  const declared = (act.match(/^\s{2}"[a-z_]+",/gm) ?? []).length;
  ok("9h primary and secondary together are still EVERY activity type",
    act.includes("ACTIVITY_TYPES.filter(t => !PRIMARY_ACTIVITY_TYPES.includes(t))")
    && act.includes('"outpatient_clinic", "ward_round", "emergency_consult", "theatre"'),
    `${declared} literals seen in the constants file`);

  // s9's safe area, on the surface that sits against the bottom edge.
  ok("9i the sheet clears the bottom navigation and the home indicator",
    start.includes("env(safe-area-inset-bottom)"));

  ok("9j the sheet is dismissible by backdrop and by Escape, like the planner's",
    start.includes('aria-label="Close the activity list"')
    && start.includes('if (e.key === "Escape") setMoreOpen(false)'));

  // The desktop grid is a different surface and keeps all thirteen -- s10 permits the wider
  // arrangement, and MCC-02 is a mobile defect. Pinned so a later tidy does not "consistently" apply
  // the mobile rule to a screen that never had the problem.
  ok("9k the desktop launcher still offers every activity without a sheet",
    start.includes("{ACTIVITY_TYPES.map(t => ("));

  // ── MCC-04 / s9: THE SESSION ACTION IS THE PRIMARY ONE, AND SAYS WHAT IT STARTS ─────────────
  //
  // ⚠ ON THE STRIPPED SOURCE, BECAUSE THE COMMENTS EXPLAINING THESE LABELS CONTAIN THE LABELS. A first
  // version asserted `start.includes("Resume Session")` against the raw file, where the paragraph
  // justifying the rename says "Resume Session" twice -- so it would have passed with the button still
  // reading Open Session. An assertion that its own documentation satisfies is worse than none: it
  // reports green for the state it exists to forbid.
  const startCode = start
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map(l => l.replace(/\/\/.*$/, "")).join("\n");

  ok("9l-strip the comment stripper works, so 9l-9n are reading code",
    start.includes("which is the right door and the wrong verb")
    && !startCode.includes("which is the right door and the wrong verb"));

  ok("9l the running state's primary CTA is Resume Session",
    startCode.includes("Resume Session"));

  ok("9m and it is not the old ambiguous verb",
    !startCode.includes("Open Session"));

  ok("9n the planned CTA names what it starts",
    startCode.includes('"Start Planned Session"')
    && !startCode.includes('busy === next.id ? "Starting…" : "Start"'));

  // ⚠ AC-06: an active session SUPPRESSES the launcher. Already true by construction -- the running
  // branch returns before the launcher is built -- and pinned because "already true by construction"
  // is exactly the kind of guarantee an innocent refactor removes.
  const runningBranch = start.slice(start.indexOf("if (metrics) {"), start.indexOf("// ── NOTHING RUNNING"));
  ok("9o an active session suppresses the activity launcher entirely",
    runningBranch.length > 0
    && !runningBranch.includes("PRIMARY_ACTIVITY_TYPES")
    && !runningBranch.includes("More activities"));

  // MCC-04's stated correction is "above secondary handoffs". Planner and Reports are s9's secondary
  // handoffs, and they are assembled after the hero in the mobile story -- asserted on the page rather
  // than assumed from reading it once.
  const heroAt = home.indexOf("<StartYourDay");
  const linksAt = home.indexOf("const mobileLinks");
  ok("9p the session card precedes the Planner/Reports handoffs in the mobile story",
    heroAt > 0 && linksAt > 0 && home.indexOf("{mobileLinks}") > heroAt,
    `hero@${heroAt} mobileLinks-render@${home.indexOf("{mobileLinks}")}`);

  // ── THE STATE-DEPENDENT ORDER, RULED BY THE OWNER 2026-08-23 ────────────────────────────────
  //
  // CPR-CC-MOB-001 s3 lists ONE hierarchy with the session card above Needs Attention in every state.
  // CPR-MOB-001 s6 puts Needs Attention first when nothing is running, deliberately, and CLAUDE.md
  // lists it as frozen. The ruling keeps both, by state:
  //
  //   idle    ... -> NEEDS ATTENTION -> session start card -> handoffs
  //   active  ... -> SESSION STATE CARD -> needs attention -> handoffs
  //
  // ⚠ THE REGRESSION THESE EXIST TO CATCH IS A TIDY, NOT A DISAGREEMENT. Two conditional slots
  // rendering the same module look like duplication to anyone reading quickly, and collapsing them to
  // one unconditional {mobileAttention} would compile, render, and silently pick one order for both
  // states -- which is precisely what the ruling declined to do. So the guards are asserted, not just
  // the positions.
  const idleSlot = home.indexOf("{!metrics && mobileAttention}");
  const activeSlot = home.indexOf("{metrics && mobileAttention}");

  ok("9q both attention slots exist, so the order can differ by state at all",
    idleSlot > 0 && activeSlot > 0 && idleSlot !== activeSlot,
    `idle@${idleSlot} active@${activeSlot}`);

  ok("9r IDLE: Needs Attention leads, above the session card (CPR-MOB-001 s6, preserved)",
    idleSlot > 0 && heroAt > 0 && idleSlot < heroAt,
    `idle@${idleSlot} hero@${heroAt}`);

  ok("9s ACTIVE: the session card leads, above Needs Attention (CPR-CC-MOB-001 s3)",
    activeSlot > 0 && heroAt > 0 && activeSlot > heroAt,
    `hero@${heroAt} active@${activeSlot}`);

  // The anti-collapse check. An unconditional render would satisfy neither guard, and a single slot
  // would fail 9q -- but a reader could also "simplify" by dropping only one guard, which this catches.
  const unguarded = /\{\s*mobileAttention\s*\}/.test(home);
  ok("9t neither slot is unguarded, so one fixed order cannot creep back in",
    !unguarded, unguarded ? "found an unconditional {mobileAttention}" : "");

  // ── s6's RENDERED STATES ────────────────────────────────────────────────────────────────────
  //
  // The s4 contract made "I could not read this" expressible; these assert the screens actually draw
  // it as something other than work. An unavailable item rendered through the ready branch would carry
  // a severity border, an arrow and a link to nowhere -- indistinguishable from an obligation, which is
  // "represent partial data as complete" exactly.
  ok("9u both attention lists separate unavailable items from real work",
    home.includes('readyItems = (home.attention as any[]).filter(a => a.status !== "unavailable")')
    && home.includes('darkItems = (home.attention as any[]).filter(a => a.status === "unavailable")'));

  ok("9v neither list still maps the raw attention array into a link",
    !home.includes("{home.attention.map((a: any) => {"),
    "a raw map would render unavailable items as tappable work");

  // Rendered on BOTH surfaces, or the two disagree about what is known -- AC-14.
  const darkRenders = (home.match(/darkItems\.map\(/g) ?? []).length;
  ok("9w the unavailable rows are drawn on the phone AND the desktop",
    darkRenders === 2, `${darkRenders} render site(s)`);

  ok("9x an unavailable row is not a link and carries no arrow",
    home.includes("border-dashed border-gray-300") && !/darkItems\.map[\s\S]{0,400}<Link/.test(home));

  // s6: one calm row, and only when nothing is hidden and nothing failed.
  ok("9y all-clear is one row, gated on there being genuinely nothing to say",
    home.includes("No urgent items need attention.")
    && home.includes("nothingToSay && home.allClear"));

  // ── MCC-07 / s9: THE BOTTOM EDGE, AND WHAT MUST BE ABOVE THE FOLD ───────────────────────────
  //
  // s9's formula: content bottom padding = bottom-nav height + env(safe-area-inset-bottom) + 16px
  // minimum. The shell already satisfies it; this pins the arithmetic, because it is the kind of
  // expression a later tidy shortens to pb-24 and nobody notices until a phone with a home indicator
  // hides the last row of a list behind the navigation.
  const shell = readFileSync("src/app/practice/(shell)/layout.tsx", "utf8");
  const padding = /pb-\[calc\(var\(--cp-bottomnav-h\)_\+_var\(--cp-safe-bottom\)_\+_[0-9.]+rem\)\]/.test(shell);
  ok("9z MCC-07 page content clears the bottom nav AND the hardware inset",
    padding, "the shell's <main> must pad nav height + safe-area inset + at least 16px");

  // ⚠ 9z ASSERTS THE FORMULA REFERENCES TWO TOKENS; THIS ASSERTS THE TOKENS MEAN ANYTHING. A first
  // version of this check ended `|| padding`, which made it true whenever 9z was true -- two
  // assertions, one fact, and the second one free. The independent claim is that --cp-safe-bottom is
  // really the hardware inset and --cp-bottomnav-h is really a length: a calc() over two tokens is
  // exactly as correct as its inputs, and a token quietly redefined to 0 would leave 9z green while
  // the last row of every list sat under the navigation.
  const css = readFileSync("src/app/globals.css", "utf8");
  ok("9z-b and the tokens it multiplies out to are real",
    /--cp-safe-bottom:\s*env\(safe-area-inset-bottom/.test(css)
    && /--cp-bottomnav-h:\s*[1-9][0-9]*px/.test(css),
    "the padding calc is only as correct as --cp-safe-bottom and --cp-bottomnav-h");

  // s3's FIRST-VIEWPORT RULE ends "Do not require the user to pass the activity catalogue before"
  // reaching the attention list. On an idle day the catalogue lives inside the hero, and 9r already
  // pins the hero below Needs Attention -- so the rule holds BECAUSE of the owner's state-dependent
  // ruling, not in spite of it. Asserted here as its own claim so the connection is not lost: if 9r
  // is ever relaxed, this says what else breaks.
  ok("9z-c first viewport: the activity catalogue never precedes Needs Attention when idle",
    idleSlot > 0 && heroAt > 0 && idleSlot < heroAt,
    "the launcher sits inside the hero, so the hero must follow the attention list on an idle day");
}

// ---------------------------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
console.log("\n⚠ Source-level only. s20's device matrix -- 360x640, 390x844, 430x932, 768x1024,");
console.log("  1024x768, >=1200px, 200% text scaling and keyboard-only operation -- is a statement");
console.log("  about rendered pixels behind a sign-in, and remains the owner's pass to make.\n");
