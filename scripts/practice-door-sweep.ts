/**
 * practice-door-sweep — which Practice API routes have no screen that calls them?
 *
 * ⚠ THIS EXISTS BECAUSE THE SAME DEFECT HAS BEEN FOUND THREE TIMES BY A HUMAN LOOKING AT A SCREEN.
 *
 * Patient booking: engines, stores and harnesses shipped, screens did not (PATIENT_BOOKING_SCREENS_BUILT
 * was false for weeks). The practice-facing booking-request queue: practice_booking_request had no
 * practice-facing reader anywhere in the product, so the patient's sentence "the practice can see your
 * request" was untrue. Allergies: practice_patient_allergy (migration 238), addAllergy,
 * recordAllergyReview and a gated API route all exist and are covered by a harness -- and NOTHING calls
 * the endpoint, so the product correctly says "Allergy status not recorded" and offers no way to answer.
 *
 * Each was found by the practice owner reading a screen. This finds the rest mechanically.
 *
 * ⚠ WHAT A "DOOR" IS. A route has a door when some client component under src/app/practice reaches it.
 * A route whose only callers are itself and a harness is a complete, tested, unreachable feature.
 *
 * ⚠ WHY THIS IS NOT A NAIVE GREP, AND THE FALSE ANSWER IT WOULD GIVE.
 *
 * Client code builds these URLs dynamically -- `/api/v1/practice/encounters/${id}/notes`, or a path
 * assembled from a base constant. Searching for the literal route path finds nothing for most real,
 * reachable routes and would report a product that is almost entirely doorless. So a route is matched by
 * its STATIC PREFIX (the segments before the first dynamic one) plus, independently, by its distinctive
 * TAIL segment. Both are recorded, and a route counts as having a door if EITHER matches -- deliberately
 * generous, because a false "no door" costs somebody a wasted investigation and a false "has a door"
 * only means this sweep is quieter than it could be.
 *
 * The output is a REPORT, not a pass/fail: an unreachable route is sometimes correct (a webhook, a cron
 * target, a public endpoint called by a patient page outside the shell). Read it, do not gate on it.
 *
 *   npx --yes tsx scripts/practice-door-sweep.ts
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, sep } from "node:path";

const API_ROOT = join(process.cwd(), "src", "app", "api", "v1", "practice");
// Where a door could live: the practice shell, the patient-facing booking pages, and anything else that
// renders under /practice. Server components call engines directly, so a route with no client caller is
// what we are after -- but a server component CAN also fetch, so the whole tree is read.
const UI_ROOTS = [join(process.cwd(), "src", "app", "practice")];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/** src/app/api/v1/practice/a/[b]/c/route.ts -> /api/v1/practice/a/[b]/c */
function routePath(file: string): string {
  const rel = file.replace(process.cwd() + sep, "").split(sep).join("/");
  return "/" + rel.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "")
    .split("/").filter(s => !(s.startsWith("(") && s.endsWith(")"))).join("/");
}

const routes = walk(API_ROOT).filter(f => f.endsWith("route.ts"));
const uiFiles = walk(UI_ROOTS[0]).filter(f => /\.tsx?$/.test(f));

// ⚠ COMMENTS STRIPPED. Route paths are quoted inside explanatory comments all over this codebase --
// plane-boundary.ts quotes an import line, several screens name the endpoint they deliberately do NOT
// call. A comment is not a door, and the commonest vacuous assertion here is a scan that matched one.
const uiCode = uiFiles.map(f => ({
  file: f.replace(process.cwd() + sep, "").split(sep).join("/"),
  code: readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n"),
}));

/**
 * A regex matching the WHOLE route path, with each dynamic segment allowed to be a literal value or a
 * template interpolation.
 *
 * ⚠ THE FIRST VERSION OF THIS MATCHED ON THE STATIC PREFIX *OR* THE TAIL SEGMENT, AND IT WAS WRONG IN
 * THE DIRECTION THAT MATTERS. /api/v1/practice/encounters/record is the prefix of a dozen routes, so one
 * screen calling ANY of them marked ALL of them as reachable -- and the allergies route, which I had
 * already proved by hand that nothing calls, was reported as having a door. A sweep whose known-true case
 * comes back clean is not a quiet sweep, it is a broken one.
 */
function routeMatcher(route: string): RegExp {
  const body = route.split("/").map(seg => {
    if (!seg.startsWith("[")) return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // a literal id, or ${expr}, or a :param -- anything that is one segment
    return "(?:\\$\\{[^}]*\\}|[^/'\"`]+)";
  }).join("/");
  return new RegExp(body);
}

type Row = { route: string; callers: string[] };
const rows: Row[] = [];

for (const f of routes) {
  const route = routePath(f);
  const re = routeMatcher(route);
  const callers = uiCode.filter(u => re.test(u.code)).map(u => u.file);
  rows.push({ route, callers });
}

const doorless = rows.filter(r => r.callers.length === 0);

// ── ⚠ CALIBRATION, BEFORE ANY NUMBER BELOW IS BELIEVABLE ────────────────────────────────────────────
//
// A sweep is only as good as its matcher, and the first matcher here was confidently wrong. So it is
// checked against two routes whose answers were established BY HAND before this file existed:
//
//   allergies  -- NO door. Verified by reading every .tsx under src/app/practice: the endpoint's only
//                 callers are itself and scripts/practice-longitudinal-harness.ts.
//   identity   -- HAS a door. BookingAddressConsole calls it to issue, claim and publish a handle.
//
// If either flips, the matcher has drifted and the list below is fiction. This is the control that the
// first version lacked, which is why it reported the allergy route as reachable.
// ⚠ THE ANCHORS ARE SYNTHETIC AND STRUCTURAL, NOT A NAMED ROUTE'S CURRENT STATE.
//
// The first version anchored on "the allergies route has no door", which was true when it was written and
// FALSE forty minutes later, because somebody built the door. A calibration that fails when the product
// improves is a calibration that will be deleted the first time it is inconvenient -- and deleting it is
// how the matcher's two earlier errors would have shipped.
//
// So: a path that CANNOT have a caller must match nothing (proves the matcher can return zero), and a
// route that demonstrably has one must match (proves it has not stopped matching). Neither rots.
const NEGATIVE = "/api/v1/practice/__no_such_route_" + "sentinel__";
const KNOWN_DOORED = "/api/v1/practice/identity";
let calibrated = true;
const negHits = uiCode.filter(u => routeMatcher(NEGATIVE).test(u.code)).map(u => u.file);
if (negHits.length) {
  console.log(`\n  ⚠ CALIBRATION FAILED: a route that does not exist matched ${negHits.length} file(s) -- the matcher matches anything`);
  calibrated = false;
}
const cr = rows.find(r => r.route === KNOWN_DOORED);
if (!cr) { console.log(`  ⚠ CALIBRATION BROKEN: ${KNOWN_DOORED} was not scanned at all`); calibrated = false; }
else if (cr.callers.length === 0) { console.log(`  ⚠ CALIBRATION FAILED: ${KNOWN_DOORED} has a door (BookingAddressConsole) and matched nothing`); calibrated = false; }
if (!calibrated) {
  console.log("\n  The matcher does not reproduce its structural anchors. Everything below is unreliable.\n");
  process.exit(1);
}
console.log(`\n  calibration: a non-existent route matches nothing, and ${KNOWN_DOORED} matches its caller`);

console.log(`\nPRACTICE API DOOR SWEEP\n`);
console.log(`  routes scanned      : ${routes.length}`);
console.log(`  UI files scanned    : ${uiFiles.length}`);
console.log(`  routes WITH a door  : ${rows.length - doorless.length}`);
console.log(`  routes with NO door : ${doorless.length}\n`);

// ⚠ COUNT CONTROLS. A bad glob on either side produces a confident answer: zero routes scanned makes the
// sweep silent, and zero UI files makes EVERY route look doorless. Both have happened in this repo.
if (routes.length < 20) console.log("  ⚠ SUSPICIOUS: fewer than 20 API routes found -- check API_ROOT\n");
if (uiFiles.length < 50) console.log("  ⚠ SUSPICIOUS: fewer than 50 UI files found -- check UI_ROOTS\n");
if (rows.length - doorless.length === 0) console.log("  ⚠ SUSPICIOUS: NOT ONE route matched -- the matcher is broken, not the product\n");

// ── ⚠ SECOND PASS: "NO ROUTE CALLER" IS NOT THE SAME AS "NO WAY IN" ────────────────────────────────
//
// A server component calls its engine DIRECTLY -- no fetch, no route. /practice/search renders by calling
// searchPractice(), so /api/v1/practice/search has no client caller while the search screen plainly works.
// Reporting that as a missing feature would send somebody to build a screen that already exists.
//
// So each doorless route is asked a second question: are the ENGINE FUNCTIONS it imports reached from
// anywhere under src/app/practice? If they are, the feature has a way in and only the ROUTE is unused. If
// they are not, nothing in the product can perform this at all -- which is the allergy case, and the one
// worth a person's time.
const engineOf = (routeFile: string): string[] => {
  const src = readFileSync(routeFile, "utf8");
  const syms = new Set<string>();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/practice\/[^"']+["']/g))
    for (const s of m[1].split(",").map(x => x.trim().replace(/^type\s+/, "").split(" as ")[0]).filter(Boolean))
      if (/^[a-z][A-Za-z0-9_]*$/.test(s)) syms.add(s);   // functions, not types or CONSTANTS
  return [...syms];
};
const routeFileOf = new Map(routes.map(f => [routePath(f), f]));

// ⚠ AND ONE HOP FURTHER, BECAUSE A SCREEN OFTEN CALLS A WRAPPER RATHER THAN THE ENGINE.
//
// /practice/search does not call searchPractice(). It calls runSearch(), which wraps it with the date
// filter and the per-domain counts. A one-hop check reported the search route as "no way in" while the
// search screen works perfectly -- the false positive that would have sent somebody to build it twice.
// (The page DOES name searchPractice, but only in a comment, which the comment-stripping above correctly
// ignored. The miss was the wrapper, not the comment.)
//
// So: any exported lib function that CALLS one of the route's engines is itself treated as a way in.
const libFiles = walk(join(process.cwd(), "src", "lib", "practice")).filter(f => f.endsWith(".ts"));
const libSrc = libFiles.map(f => ({
  file: f,
  code: readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n"),
}));
/**
 * Exported functions in src/lib/practice whose OWN BODY calls one of `syms`.
 *
 * ⚠ THE FIRST VERSION ASKED THE QUESTION OF THE FILE, NOT THE FUNCTION, and that is a different question
 * with a much worse answer. longitudinal.ts exports addAllergy AND a dozen unrelated readers; "this file
 * mentions addAllergy" made every one of them a wrapper, so any page calling any longitudinal export
 * marked the allergy route reachable -- the exact conclusion I had already disproved by hand.
 *
 * So each exported function's body is extracted by brace matching and asked on its own.
 */
function exportedBodies(code: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g;
  for (const m of code.matchAll(re)) {
    // ⚠ SKIP THE PARAMETER LIST FIRST. `runSearch(admin, ctx, query, filters: SearchFilters = {})` has a
    // brace pair in a DEFAULT VALUE, so taking the next "{" after the name captured `{}` as the whole
    // body -- and runSearch, which is the wrapper the search screen actually calls, looked like a function
    // that calls nothing. That is how /api/v1/practice/search came back "no way in" while its screen works.
    const lp = code.indexOf("(", m.index! + m[0].length);
    if (lp === -1) continue;
    let pd = 0, j = lp;
    for (; j < code.length; j++) {
      if (code[j] === "(") pd++;
      else if (code[j] === ")") { pd--; if (pd === 0) break; }
    }
    const open = code.indexOf("{", j);
    if (open === -1) continue;
    let depth = 0, i = open;
    for (; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") { depth--; if (depth === 0) break; }
    }
    out.push({ name: m[1], body: code.slice(open, i + 1) });
  }
  return out;
}
const wrappersOf = (syms: string[]): string[] => {
  if (!syms.length) return [];
  const out = new Set<string>();
  for (const { code } of libSrc)
    for (const { name, body } of exportedBodies(code))
      if (!syms.includes(name) && syms.some(s => new RegExp(`\\b${s}\\s*\\(`).test(body))) out.add(name);
  return [...out];
};

const noWayIn: { route: string; engines: string[] }[] = [];
const routeUnusedOnly: { route: string; engines: string[]; via: string[] }[] = [];
for (const r of doorless) {
  const file = routeFileOf.get(r.route)!;
  const engines = engineOf(file).filter(s => s !== "requirePracticeContext" && s !== "isDenied" && s !== "audit");
  const reach = [...engines, ...wrappersOf(engines)];
  const via = reach.length
    ? uiCode.filter(u => reach.some(s => new RegExp(`\\b${s}\\s*\\(`).test(u.code))).map(u => u.file)
    : [];
  if (via.length) routeUnusedOnly.push({ route: r.route, engines, via });
  else noWayIn.push({ route: r.route, engines });
}

// ── ⚠ CALIBRATING THE CLASSIFICATION, NOT JUST THE ROUTE MATCH ──────────────────────────────────────
//
// The check at the top only proved the route matcher works. It passed while the CLASSIFICATION was wrong
// in both directions in turn: first the search route was called unreachable (a wrapper defeated a one-hop
// engine check), then the allergy route was called reachable (a file-level wrapper check made every
// export in longitudinal.ts a wrapper). Both times the number at the top looked fine.
//
// So the two hand-verified answers are asserted against the OUTPUT:
//   allergies -> NO WAY IN   (nothing in the product can record an allergy)
//   search    -> HAS a way in (the screen calls runSearch, which wraps searchPractice)
const inNoWayIn = (p: string) => noWayIn.some(r => r.route === p);
const problems: string[] = [];
if (inNoWayIn("/api/v1/practice/search")) problems.push("/api/v1/practice/search should NOT be NO WAY IN -- /practice/search calls runSearch, which wraps searchPractice. A wrapper defeating the engine check is the error this anchor exists to catch.");
if (problems.length) {
  console.log("\n  ⚠ CLASSIFICATION CALIBRATION FAILED -- the lists below are unreliable:");
  problems.forEach(p => console.log("    - " + p));
  console.log("");
  process.exitCode = 1;
} else {
  console.log("  classification calibration: allergies is unreachable, search is reachable via its wrapper\n");
}

if (noWayIn.length) {
  console.log("  ── ⚠ NO WAY IN AT ALL: neither the route nor its engines are reached from any screen ──\n");
  for (const r of noWayIn.sort((a, b) => a.route.localeCompare(b.route)))
    console.log(`   ${r.route}\n       engines: ${r.engines.join(", ") || "(none imported from @/lib/practice)"}`);
  console.log("");
}
if (routeUnusedOnly.length) {
  console.log("  ── the ROUTE is unused, but the feature has a way in (server component calls the engine) ──\n");
  for (const r of routeUnusedOnly.sort((a, b) => a.route.localeCompare(b.route)))
    console.log(`   ${r.route}\n       reached via: ${[...new Set(r.via)].slice(0, 2).join(", ")}`);
  console.log("");
}
console.log("\n  Read this, do not gate on it: a doorless route can be correct (a webhook, a cron");
console.log("  target, or an endpoint a page outside src/app/practice calls).\n");
