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
import { parentHrefs, pathMatches, parentTone } from "../src/lib/nav/active";
import { PD_NAV } from "../src/app/super-admin/_components/pd-nav";
// ⚠ IMPORTED SINCE CP-HQ-NAV-001, WHERE THE TABLES MOVED OUT OF THE COMPONENT. This harness used to regex
// them out of WorkspaceSidebar.tsx, and when they moved to nav-tables.ts the regex matched nothing -- which
// C1/C2/C3 caught immediately and loudly. That is exactly what those count controls are for, and it is the
// second time a floor has stopped a silent no-op reading as green. Importing the real tables removes the
// failure mode altogether: there is no longer a regex that can quietly stop matching.
import { ALL_NAV_TABLES, OVERVIEW_HREFS as OVERVIEW } from "../src/app/super-admin/_components/nav-tables";

const FILE = "src/app/super-admin/_components/WorkspaceSidebar.tsx";
// Floors, not exact counts: adding a nav entry is routine and should not turn this red. Reading NOTHING is
// what must turn it red.
const PATH_FLOOR = 100;
const NAV_FLOOR = 6;

const src = readFileSync(FILE, "utf8");

const navs: Record<string, string[]> = Object.fromEntries(
  ALL_NAV_TABLES.map(t => [t.name, t.sections.flatMap(s => s.items.map(i => i.href))]),
);

let pass = 0, fail = 0;
const failures: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { fail++; failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};

console.log("\nSIDEBAR ACTIVE-STATE");
ok("C1", Object.keys(navs).length >= NAV_FLOOR && Object.values(navs).every(h => h.length > 0),
  `count control: ${Object.keys(navs).length} nav tables loaded, none empty (floor ${NAV_FLOOR}) -- a table set that shrank to nothing passes everything below`);
ok("C2", OVERVIEW.size > 0,
  `count control: the OVERVIEW_HREFS floor set came from the shipped module (${OVERVIEW.size} entries), not a copy`);

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
// ⚠ `table`, NOT `nav`, SINCE CP-HQ-NAV-001 -- AND THE DISTINCTION IS LOAD-BEARING, NOT COSMETIC. `nav` is
// now the CAPABILITY-FILTERED sidebar and `table` is the whole one. Deriving parents from the filtered set
// would make highlighting depend on who is looking: a viewer whose children are hidden would see the parent
// revert to prefix matching and light up while they stand on a hidden child, which observe mode still
// renders. The parent set must be a property of the nav, not of the viewer.
ok("C6", /exactHrefs\s*=\s*parentHrefs\(table\.flatMap\(/.test(code) && /exact=\{OVERVIEW_HREFS\.has\(href\) \|\| exactHrefs\.has\(/.test(code),
  "the component derives its parent set across the FLATTENED, UNFILTERED table and unions it with the floor list");

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

// ── PD PARENT TONE (CPR-PD-001 s4) ──────────────────────────────────────────
// ⚠ THE OWNER FOUND THIS ON SCREEN, NOT A HARNESS: on /pd/configuration the group row and its
// "Configuration Overview" child wore the SAME full fill. Every one of the eight expandable PD groups
// repeats its own href as its first child, so selfActive and childActive are both true there and the
// old "self wins" rule painted two identical pills across eight screens.
const PD_SELF_AS_CHILD = PD_NAV.flatMap(g => g.items)
  .filter(i => (i.children ?? []).some(c => c.href === i.href));

ok("T1", PD_SELF_AS_CHILD.length > 0,
  `control: ${PD_SELF_AS_CHILD.length} PD groups repeat their own href as a child -- if this ever reads 0 the tone rule below is testing a shape that no longer exists`);

const expandedOnOwnOverview = parentTone({ selfActive: true, childActive: true, selfIsAChild: true, rail: false, expanded: true });
ok("T2", expandedOnOwnOverview === "section",
  "expanded, on a group's own overview: the PARENT yields to the child and takes `section`, so exactly one row wears the full fill");

ok("T3", parentTone({ selfActive: true, childActive: true, selfIsAChild: true, rail: true, expanded: true }) === "active",
  "in the RAIL the parent keeps `active` -- the child is not rendered there, so yielding would leave the workspace showing nowhere at all");

ok("T4", parentTone({ selfActive: true, childActive: false, selfIsAChild: false, rail: false, expanded: true }) === "active",
  "a leaf-ish parent with no self-as-child still takes `active` when it IS the page -- the yield is narrow, not a general demotion");

ok("T5", parentTone({ selfActive: false, childActive: true, selfIsAChild: true, rail: false, expanded: true }) === "section",
  "on a genuine CHILD page the parent takes `section`, which is the behaviour that already worked and must not regress");

ok("T6", parentTone({ selfActive: false, childActive: false, selfIsAChild: true, rail: false, expanded: false }) === "idle",
  "control: an unrelated group is `idle` -- the rule is not returning a non-idle tone for everything");

ok("T7", parentTone({ selfActive: true, childActive: true, selfIsAChild: true, rail: false, expanded: false }) === "active",
  "COLLAPSED (group shut) on its own overview the parent keeps `active` -- the child row is not on screen to carry it");

console.log(`\n${fail === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${fail} failed`);
if (failures.length) { console.log("\nFAILURES:"); failures.forEach(f => console.log("  " + f)); }
process.exit(fail === 0 ? 0 : 1);
