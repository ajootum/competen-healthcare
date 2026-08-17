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
// 2. THE CLOCK -- product-wide, as a ratchet
// ---------------------------------------------------------------------------------------------
console.log("\n2. the 24-hour clock -- native pickers as a ratcheted inventory");

/**
 * ⚠ THIS IS DEBT, RECORDED HONESTLY, NOT A CLEAN BILL.
 *
 * A native time or datetime-local input draws whatever the OPERATING SYSTEM's locale says, so a 24-hour
 * product renders "11:00 AM" on half the machines that open it -- and when the value is a datetime-local
 * fed to a timestamptz, the offsetless string is read in the connection's zone and a Kampala 14:30 is
 * stored as 14:30 UTC. Both halves of that were paid for on the encounters screen on 2026-08-17.
 *
 * The guard written that day was scoped to ONE FOLDER, and this scan is what a product-wide version
 * finds: the surfaces below still hold native pickers. They are listed rather than ignored, with the
 * count each currently holds, and the rule is a RATCHET -- a file may hold FEWER than its recorded
 * number and may leave the list entirely, but it may never hold more, and a file NOT on this list may
 * hold none at all. So the debt can only shrink, and no new instance can arrive anywhere in the app.
 *
 * ⚠ SHARPEST FIRST, for whoever picks this up: activity/ActivityConsole.tsx is not merely a locale
 * display problem. It prefills with new Date().toISOString().slice(0,16) -- a UTC wall clock poured
 * into a control the browser renders as local time -- so in Kampala its "now" default is three hours
 * behind, and it then composes the instant in the BROWSER's zone rather than the practice's, which is
 * the travelling-practitioner bug the timezone doctrine exists to prevent. The type="time" entries are
 * milder: those fields store a wall clock string and compose no instant, so they are a display-locale
 * complaint rather than a data one.
 */
const PICKER_DEBT: Record<string, number> = {
  "src/app/practice/(shell)/activity/ActivityConsole.tsx": 2,
  "src/app/practice/(shell)/setup/availability/AvailabilityConsole.tsx": 2,
  "src/app/practice/(shell)/setup/availability/SessionCard.tsx": 2,
  "src/app/practice/(shell)/setup/availability/WeekBoard.tsx": 2,
  "src/app/practice/(shell)/setup/availability-booking/ExceptionWorkspace.tsx": 2,
  "src/app/practice/(shell)/setup/availability-booking/RuleWorkspace.tsx": 1,
  "src/app/practice/(shell)/setup/availability-booking/SessionWorkspace.tsx": 2,
  "src/app/practice/offline/OfflineReader.tsx": 4,
};

const pickerCounts = new Map<string, number>();
for (const f of APP_FILES) {
  const hits = [...strip(readFileSync(f, "utf8")).matchAll(/type="(?:time|datetime-local)"/g)].length;
  if (hits) pickerCounts.set(rel(f), hits);
}

const newOffenders = [...pickerCounts].filter(([f]) => f.startsWith("src/app/practice/") && !(f in PICKER_DEBT));
ok("2a no practice surface outside the recorded inventory holds a native picker",
  newOffenders.length === 0,
  newOffenders.map(([f, n]) => `${f} (${n})`).join(", "));

const grown = [...pickerCounts].filter(([f, n]) => f in PICKER_DEBT && n > PICKER_DEBT[f]);
ok("2b no recorded surface has grown more native pickers",
  grown.length === 0,
  grown.map(([f, n]) => `${f} now ${n}, was ${PICKER_DEBT[f]}`).join(", "));

// The surfaces the walkthrough actually cleaned. Named individually because these are the ones a
// future edit is most likely to "helpfully" revert to a native control.
const MUST_STAY_CLEAN = [
  "src/app/practice/(shell)/calendar",
  "src/app/practice/(shell)/encounters",
  "src/app/practice/(shell)/patients",
  "src/app/practice/(shell)/today",
  "src/app/practice/(shell)/follow-ups",
];
for (const surface of MUST_STAY_CLEAN) {
  const dirty = [...pickerCounts.keys()].filter(f => f.startsWith(surface + "/"));
  ok(`2c ${surface.replace("src/app/practice/(shell)/", "")} holds no native picker`,
    dirty.length === 0, dirty.join(", "));
}

// ⚠ CONTROL, AND THIS ONE IS LOAD-BEARING. The comment stripper is doing real work here: several of
// the cleaned files above contain the string type="time" inside a comment explaining why they do not
// use it. If strip() ever broke, 2c would go red for the best possible reason and be "fixed" by
// deleting the explanations. So: prove the raw text DOES contain what the stripped text does not.
const cleanedRaw = PRACTICE_FILES
  .filter(f => MUST_STAY_CLEAN.some(s => rel(f).startsWith(s + "/")))
  .map(f => readFileSync(f, "utf8"));
ok("2c-control the cleaned surfaces do document the rule, and stripping is what tells the two apart",
  cleanedRaw.some(s => /type="time"/.test(s)) && cleanedRaw.every(s => !/type="time"/.test(strip(s))),
  "if this fails, the stripper broke -- do not delete the comments");

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

// A time pattern is recognised by its own shape rather than by the file it sits in, so a time control
// added on a new screen is covered the day it lands.
const timePatterns = patterns.filter(p => /2\[0-3\]|:\[0-5\]/.test(p.src));
const ACCEPT = ["09:00", "9:00", "23:59", "00:00", "14:30"];
const REJECT = ["24:00", "09:60", "9:00 AM", "0900", "", "11:00 PM"];
const misbehaving = timePatterns.filter(p => {
  let re: RegExp;
  try { re = new RegExp(p.src); } catch { return true; }
  return !ACCEPT.every(v => re.test(v)) || !REJECT.every(v => !re.test(v));
});
ok("3b every 24-hour time pattern accepts real times and refuses 12-hour and out-of-range ones",
  timePatterns.length > 0 && misbehaving.length === 0,
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

// ---------------------------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
console.log("\n⚠ Source-level only. s20's device matrix -- 360x640, 390x844, 430x932, 768x1024,");
console.log("  1024x768, >=1200px, 200% text scaling and keyboard-only operation -- is a statement");
console.log("  about rendered pixels behind a sign-in, and remains the owner's pass to make.\n");
