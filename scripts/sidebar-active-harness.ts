/**
 * sidebar-active-harness — proves no sidebar path highlights two rows at once.
 *
 * ⚠ THIS EXISTS BECAUSE A HAND-MAINTAINED LIST DRIFTED TWICE AND NOTHING NOTICED.
 *
 * NavLink prefix-matches by default, which is right for a leaf and wrong for a parent: /super-admin/enterprise
 * stays lit while you are on /super-admin/enterprise/organisations, so two rows are highlighted and the
 * sidebar stops answering "where am I". WorkspaceSidebar carried a set naming the parents that must match
 * exactly, and adding a nav group meant remembering to add its parent to that set. Nobody did, for
 * /super-admin/platform-ops or /super-admin/enterprise -- 22 of 119 paths lit two rows, and it was found by a
 * person looking at the screen rather than by anything here.
 *
 * The fix DERIVES the parent set from the nav tables. This harness holds that derivation to the property that
 * actually matters, which is not "the set is right" but "exactly one row is ever lit".
 *
 * ⚠ THE COUNT CONTROL IS NOT DECORATION. A regex that stops matching the nav tables finds zero paths and
 * passes every assertion below. PATH_FLOOR and NAV_FLOOR are what stop a silent no-op reading as green.
 */
import { readFileSync } from "node:fs";
// ⚠ IMPORTED, NOT RE-IMPLEMENTED. The first version of this harness had its own copy of both rules and
// therefore stayed green under every break applied to the real component. These are the functions the
// sidebar actually runs.
import { parentHrefs, pathMatches } from "../src/lib/nav/active";

const FILE = "src/app/super-admin/_components/WorkspaceSidebar.tsx";
// Floors, not exact counts: adding a nav entry is routine and should not turn this red. Reading NOTHING is
// what must turn it red.
const PATH_FLOOR = 100;
const NAV_FLOOR = 6;

const src = readFileSync(FILE, "utf8");

/**
 * The explicit floor set, read OUT OF THE SOURCE rather than copied here. A duplicated literal is how a
 * harness starts testing its own copy of the thing instead of the thing.
 */
const overviewLiteral = src.match(/const OVERVIEW_HREFS = new Set\(\[([^\]]*)\]\)/);
const OVERVIEW = new Set([...(overviewLiteral?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(m => m[1]));

const navs: Record<string, string[]> = {};
for (const m of src.matchAll(/const (\w*NAV)\b[\s\S]*?\n\];/g))
  navs[m[1]] = [...m[0].matchAll(/href: "([^"]+)"/g)].map(x => x[1]);

let pass = 0, fail = 0;
const failures: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { fail++; failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};

console.log("\nSIDEBAR ACTIVE-STATE");
ok("C1", Object.keys(navs).length >= NAV_FLOOR,
  `count control: ${Object.keys(navs).length} nav tables parsed (floor ${NAV_FLOOR}) -- a regex that matches nothing passes everything below`);
ok("C2", OVERVIEW.size > 0,
  `count control: the OVERVIEW_HREFS floor set was read from source (${OVERVIEW.size} entries), not assumed`);

const isActive = (href: string, path: string, exact: boolean) => pathMatches(href, path, exact);

let checked = 0;
const doubles: string[] = [];
for (const [name, hrefs] of Object.entries(navs)) {
  const derived = parentHrefs(hrefs.map(h => ({ href: h })));
  for (const path of [...new Set(hrefs.map(h => h.split("?")[0]))]) {
    checked++;
    const lit = [...new Set(hrefs.filter(h => isActive(h, path, OVERVIEW.has(h) || derived.has(h.split("?")[0]))))];
    if (lit.length !== 1) doubles.push(`${name} ${path} -> ${lit.length} rows: ${lit.join(", ")}`);
  }
}
ok("C3", checked >= PATH_FLOOR, `count control: ${checked} sidebar paths evaluated (floor ${PATH_FLOOR})`);
ok("C4", doubles.length === 0,
  `every sidebar path lights EXACTLY ONE row${doubles.length ? ` -- ${doubles.slice(0, 6).join(" | ")}` : ""}`);

// ⚠ THE CONTROL. C4 also passes if isActive were broken so that NOTHING ever matches. This asserts the
// matcher still lights the row you are standing on, for every path, which is the half C4 cannot see.
const unlit = Object.entries(navs).flatMap(([name, hrefs]) => {
  const derived = parentHrefs(hrefs.map(h => ({ href: h })));
  return [...new Set(hrefs.map(h => h.split("?")[0]))]
    .filter(path => !hrefs.some(h => isActive(h, path, OVERVIEW.has(h) || derived.has(h.split("?")[0]))))
    .map(path => `${name} ${path}`);
});
ok("C5", unlit.length === 0,
  `control: every sidebar path lights AT LEAST one row -- the matcher has not simply stopped matching${unlit.length ? ` -- ${unlit.slice(0, 4).join(", ")}` : ""}`);

// The component must actually USE the derivation. Comments stripped first: the commonest cause of a vacuous
// assertion in this codebase is scanning source for a phrase that also appears in a comment about it.
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
ok("C6", /exactHrefs\s*=\s*parentHrefs\(nav\.flatMap\(/.test(code) && /exact=\{OVERVIEW_HREFS\.has\(href\) \|\| exactHrefs\.has\(/.test(code),
  "the component derives its parent set across the FLATTENED nav and unions it with the floor list -- the fix is wired in, not just defined");

// ⚠ ASSERTED DIRECTLY, BECAUSE THE LIVE NAV DOES NOT EXERCISE IT. Removing the `+ "/"` boundary from
// parentHrefs changes NOTHING about today's 119 paths -- no current sidebar has an /x and an /x-suffix
// entry -- so C4 stayed green under that break. The boundary is defensive rather than load-bearing, and a
// property nothing exercises is a property that silently rots. This is the fixture that exercises it.
// ⚠ TWO SEPARATE FIXTURES, AND THE SPLIT IS THE WHOLE POINT. The first attempt put /a/ai, /a/ai-gateway
// and /a/ai/models in ONE list and asserted /a/ai was a parent -- which is true with the boundary and true
// without it, because the real child /a/ai/models makes it a parent either way. It passed under the break.
// The negative case only discriminates when the suffix sibling is the ONLY candidate.
const positive = parentHrefs([{ href: "/a/ai" }, { href: "/a/ai/models" }]);
const negative = parentHrefs([{ href: "/a/ai" }, { href: "/a/ai-gateway" }]);
ok("C7", negative.size === 0,
  "⚠ /a/ai is NOT the parent of /a/ai-gateway -- the parent test matches on a segment boundary, and a bare prefix would wrongly make it one");
ok("C8", positive.has("/a/ai") && positive.size === 1,
  "control: /a/ai IS the parent of /a/ai/models -- C7 is a real boundary, not a function that has stopped finding parents");

console.log(`\n${fail === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${fail} failed`);
if (failures.length) { console.log("\nFAILURES:"); failures.forEach(f => console.log("  " + f)); }
process.exit(fail === 0 ? 0 : 1);
