/**
 * COMPETEN-HQ-IA-02 — the HQ navigation registry holds the whole HQ estate, and holds it honestly.
 *
 * Run:  npx --yes tsx scripts/hq-nav-registry-harness.ts
 *
 * ⚠ WHY THIS EXISTS. Screens kept shipping without a door: HQ Positions, then four more in one week, and at
 * HQ-IA-02 review the eight CKRI research pages (in production) and Quality Intelligence had no way in at
 * all. practice-door-sweep is a report for Practice APIs; this is a GATE for HQ pages. A page that is not
 * registered is a page nobody can find.
 *
 * ⚠ IT READS THE FILE SYSTEM AND THE REAL REGISTRY, never a fixture: the page list is every page.tsx
 * under src/app/super-admin, and the registry is the module the sidebar renders.
 *
 * Pure/local. No database, no network.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  HQ_WORKSPACES, HQ_NAV_REGISTRY_VERSION, ALL_NAV_TABLES, HQ_SEARCH_TABLES, hqWorkspaceForPath, flatNavItems,
  type NavEntry,
} from "../src/app/super-admin/_components/nav-tables";
import { PD_NAV, PD_HOME } from "../src/app/super-admin/_components/pd-nav";
import { capabilityForRoute } from "../src/lib/hq/spaces";
import { canSeeHqLink, filterHqNav } from "../src/lib/hq/nav-filter";
import { hqSearchCatalogue } from "../src/lib/hq/search-catalogue";

let pass = 0;
const failures: string[] = [];
function ok(id: string, cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✓ ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  ✗ ${id}  ${msg}`); }
}
const show = (xs: string[], n = 8) => (xs.length ? ` -- ${xs.slice(0, n).join(", ")}${xs.length > n ? ` (+${xs.length - n})` : ""}` : "");

// ── The estate, from the file system ─────────────────────────────────────────────────────────────────
const APP = "src/app";
const ROOT = join(APP, "super-admin");
const pages: string[] = [];
(function walk(d: string) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e === "page.tsx") pages.push("/" + relative(APP, d).split(sep).join("/"));
  }
})(ROOT);
const isDynamic = (r: string) => r.includes("[");
const staticPages = pages.filter(r => !isDynamic(r)).sort();
const dynamicPages = pages.filter(isDynamic).sort();

// ── The registry ─────────────────────────────────────────────────────────────────────────────────────
type Row = { ws: string; e: NavEntry; child: boolean; parent?: NavEntry };
const rows: Row[] = HQ_WORKSPACES.flatMap(w => w.sections.flatMap(s => s.items.flatMap(e => [
  { ws: w.key, e, child: false },
  ...(e.children ?? []).map(c => ({ ws: w.key, e: c, child: true, parent: e })),
])));
const deep = HQ_WORKSPACES.flatMap(w => (w.deep ?? []).map(d => ({ ws: w.key, d })));
const isHome = (e: NavEntry) => e.kind !== "cross" && e.kind !== "external";
const homeHrefs = [...rows.filter(r => isHome(r.e)).map(r => r.e.href), ...deep.map(x => x.d.href)];
const drawnHomeHrefs = new Set(rows.filter(r => isHome(r.e)).map(r => r.e.href));

console.log(`\nHQ NAVIGATION REGISTRY v${HQ_NAV_REGISTRY_VERSION}`);

console.log("\nC. Count controls");
ok("C1", staticPages.length >= 300, `the file system yields ${staticPages.length} static HQ pages (floor 300) and ${dynamicPages.length} dynamic`);
ok("C2", rows.length >= 300, `the registry yields ${rows.length} drawn rows and ${deep.length} deep links (floor 300)`);

console.log("\nW. Workspaces");
const PRESCRIBED = ["Mission Control", "Products", "Learning & Knowledge", "Competency Frameworks", "AI & Intelligence", "Platform Operations", "Governance & Administration"];
ok("W1", HQ_WORKSPACES.map(w => w.label).join("|") === PRESCRIBED.join("|"),
  `exactly the seven approved workspaces, in order (${HQ_WORKSPACES.map(w => w.label).join(", ")})`);
ok("W2", /^\d+\.\d+\.\d+$/.test(HQ_NAV_REGISTRY_VERSION), `the registry is versioned (${HQ_NAV_REGISTRY_VERSION})`);
ok("W3", ALL_NAV_TABLES.length === 7 && ALL_NAV_TABLES.every(t => t.sections.length > 0), "one derived table per workspace, none empty");

console.log("\nR. Every page has a door");
const homeCount = new Map<string, number>();
for (const h of homeHrefs) homeCount.set(h, (homeCount.get(h) ?? 0) + 1);
const unregistered = staticPages.filter(p => !homeCount.has(p));
ok("R1", unregistered.length === 0, `every static HQ page is registered as a home entry (${staticPages.length - unregistered.length}/${staticPages.length})${show(unregistered)}`);
const twice = [...homeCount].filter(([, n]) => n > 1).map(([h]) => h);
ok("R1b", twice.length === 0, `no page has two homes${show(twice)}`);
const strandedDynamic = dynamicPages.filter(p => !homeHrefs.some(h => p.startsWith(h + "/")));
ok("R1c", strandedDynamic.length === 0, `every dynamic page sits under a registered static page${show(strandedDynamic)}`);
const deadInternal = [...rows.map(r => r.e.href), ...deep.map(x => x.d.href)]
  .filter(h => h.startsWith("/super-admin") && !staticPages.includes(h.split("?")[0]));
ok("R2", deadInternal.length === 0, `every registered /super-admin href is a real page${show(deadInternal)}`);
const unmapped = homeHrefs.filter(h => h.startsWith("/super-admin") && !capabilityForRoute(h));
ok("R2b", unmapped.length === 0, `every registered page declares a capability in HQ_ROUTE_INTENT (unmapped would be hidden from everybody but owners)${show(unmapped)}`);

// ⚠ A deep link must be reachable from a page that is itself drawn, and that page must really link to it.
const badDeep = deep.filter(({ d }) => {
  if (!drawnHomeHrefs.has(d.via)) return true;
  const dir = join(APP, d.via.slice(1));
  const files: string[] = [];
  (function walk(x: string, depth: number) {
    for (const e of readdirSync(x)) {
      const p = join(x, e);
      if (statSync(p).isDirectory()) { if (d.via !== "/super-admin" ? true : e.startsWith("_")) walk(p, depth + 1); }
      else if (/\.tsx?$/.test(e)) files.push(p);
    }
  })(dir, 0);
  return !files.some(f => readFileSync(f, "utf8").includes(`"${d.href}"`) || readFileSync(f, "utf8").includes(`\`${d.href}`));
}).map(({ d }) => `${d.href} via ${d.via}`);
ok("R3", badDeep.length === 0, `every deep link is reached from a drawn page whose source links it (${deep.length} checked)${show(badDeep)}`);

console.log("\nA. Authority");
// ⚠ NO CAPABILITY IN THE REGISTRY: the nav and the guard must not become two opinions about one door.
const ALLOWED = new Set(["key", "label", "href", "icon", "kind", "flag", "children"]);
const extraFields = rows.flatMap(r => Object.keys(r.e).filter(k => !ALLOWED.has(k)).map(k => `${r.e.href}.${k}`));
ok("A1", extraFields.length === 0, `registry entries carry no capability or other authority field${show(extraFields)}`);
// ⚠ A child is shown only under its parent, so a child the parent's viewer could not open is fine, but a
// child they COULD open under a parent they cannot see would be stranded. Same capability, always.
const childMismatch = rows.filter(r => r.child && r.parent && capabilityForRoute(r.e.href) !== capabilityForRoute(r.parent.href))
  .map(r => `${r.e.href} (${capabilityForRoute(r.e.href)}) under ${r.parent!.href} (${capabilityForRoute(r.parent!.href)})`);
ok("A2", childMismatch.length === 0, `every child requires exactly its parent's capability${show(childMismatch, 4)}`);
const OWNER = { isOwner: true, capabilities: [] as string[] };
ok("A3", HQ_WORKSPACES.every(w => filterHqNav(w.sections, OWNER) === w.sections), "an owner gets every workspace table back unchanged (same object)");
const caps = [...new Set(homeHrefs.map(h => capabilityForRoute(h)).filter(Boolean))] as string[];
const leaks: string[] = [];
for (const cap of caps) {
  const viewer = { isOwner: false, capabilities: [cap] };
  for (const w of HQ_WORKSPACES)
    for (const s of filterHqNav(w.sections, viewer))
      for (const i of flatNavItems(s.items))
        if (capabilityForRoute(i.href) !== cap) leaks.push(`${cap} -> ${i.href}`);
}
ok("A4", leaks.length === 0, `for each of ${caps.length} capabilities alone, every drawn row (children included) is one it opens${show(leaks, 4)}`);
const external = rows.filter(r => r.e.kind === "external");
ok("A5", external.length > 0 && external.every(r => !canSeeHqLink(r.e.href, { isOwner: false, capabilities: caps }) && canSeeHqLink(r.e.href, OWNER)),
  `${external.length} off-estate links are offered to owners only, never to a viewer holding every capability`);

console.log("\nX. Cross-links and duplicates");
const crossBad = rows.filter(r => r.e.kind === "cross").filter(r => {
  const homeWs = rows.find(x => isHome(x.e) && x.e.href === r.e.href)?.ws;
  return !homeWs || homeWs === r.ws;
}).map(r => `${r.ws}:${r.e.href}`);
ok("X1", crossBad.length === 0, `every cross-link points at a page whose home is ANOTHER workspace${show(crossBad)}`);
const dupInWs = HQ_WORKSPACES.flatMap(w => {
  const hs = w.sections.flatMap(s => flatNavItems(s.items)).map(i => i.href);
  return hs.filter((h, i) => hs.indexOf(h) !== i).map(h => `${w.key}:${h}`);
});
ok("X2", dupInWs.length === 0, `no href is drawn twice inside one workspace (two rows would light)${show(dupInWs)}`);
const keys = [...rows.map(r => r.e.key), ...deep.map(x => x.d.key)];
const missingKey = rows.filter(r => !r.e.key).map(r => r.e.href);
const dupKeys = keys.filter((k, i) => k && keys.indexOf(k) !== i);
ok("X3", missingKey.length === 0 && dupKeys.length === 0, `every entry has a stable key, none reused${show([...missingKey, ...dupKeys])}`);
const labels = HQ_WORKSPACES.map(w => {
  const ls = w.sections.flatMap(s => s.items).filter(isHome).map(i => i.label);
  return ls.filter((l, i) => ls.indexOf(l) !== i).map(l => `${w.key}:${l}`);
}).flat();
ok("X4", labels.length === 0, `no two top-level rows in one workspace share a label${show(labels)}`);
const AMBIGUOUS = /^(Governance|Overview|Studio|Case Studies|Learning Paths)$/;
const ambiguous = rows.filter(r => !r.child && AMBIGUOUS.test(r.e.label)).map(r => `${r.ws}:${r.e.label}`);
ok("X5", ambiguous.length === 0, `the HQ-IA-02 D8 labels are disambiguated (no bare Governance/Overview/Studio/Case Studies/Learning Paths)${show(ambiguous)}`);

console.log("\nS. Shared authorities have one home");
const homeOf = (href: string) => rows.find(r => isHome(r.e) && r.e.href === href)?.ws;
ok("S1", ["/super-admin/clinical-review", "/super-admin/learning/review", "/super-admin/research/knowledge-review", "/super-admin/clinical-review/governance"]
  .every(h => homeOf(h) === "governance"),
  "Clinical Content Approval (395) -- clinical, learning and knowledge review queues -- is homed in Governance & Administration");
ok("S2", homeOf("/super-admin/users/appointments") === "governance" && homeOf("/super-admin/enterprise/people") === "products",
  "HQ positions (platform governance) and estate People & Roles stay in different workspaces (CP-HQ-NAV-001 C8)");
ok("S3", ["/super-admin/individual/configuration", "/super-admin/ai/fair-use"].every(h => homeCount.get(h) === 1)
  && rows.filter(r => r.e.href === "/super-admin/individual/configuration").length === 1,
  "Individual Policy and AI Fair Use each have exactly one destination (no second settings page)");

console.log("\nP. Practice and the Product Director workspace");
const pdModules = PD_NAV.flatMap(g => g.items).filter(i => i.href !== PD_HOME);
const practice = HQ_WORKSPACES.find(w => w.key === "products")!.sections.find(s => s.key === "products.practice")!;
const missingPd = pdModules.filter(m => !practice.items.some(i => i.href === m.href && i.label === m.label)).map(m => m.label);
ok("P1", missingPd.length === 0, `owners reach all ${pdModules.length} PD modules under Products, labels exactly PD_NAV's${show(missingPd)}`);
const pdChildren = pdModules.flatMap(m => (m.children ?? []).filter(c => c.href !== m.href && c.href.startsWith("/super-admin/pd/")).map(c => c.href));
const lostChildren = pdChildren.filter(h => !practice.items.some(i => (i.children ?? []).some(c => c.href === h)));
ok("P2", lostChildren.length === 0, `every PD child destination (${pdChildren.length}) is reachable under its module${show(lostChildren)}`);

console.log("\nF. Feature-switch presentation");
// The registry names a switch by PRODUCT; nav-switches.ts maps each to the product's own exported constant.
const switchMap = readFileSync("src/lib/hq/nav-switches.ts", "utf8");
const mapped = new Set([...switchMap.matchAll(/^\s*"([a-z-]+)":\s*[A-Z_]+_FLAG,$/gm)].map(m => m[1]));
const CONSTS = ["INDIVIDUAL_APP_FLAG", "LEARNING_APP_FLAG", "LEARNING_COMMERCE_FLAG", "CASE_LIBRARY_FLAG", "CKRI_FLAG", "AI_FAIR_USE_FLAG"];
const unknownFlags = rows.filter(r => r.e.flag && !mapped.has(r.e.flag)).map(r => `${r.e.href}:${r.e.flag}`);
ok("F1", rows.some(r => r.e.flag) && unknownFlags.length === 0 && CONSTS.every(c => switchMap.includes(`import { ${c}`) || new RegExp(`import \\{[^}]*\\b${c}\\b`).test(switchMap))
    && !/"[a-z]+_[a-z_]+"/.test(switchMap.replace(/\/\/.*$/gm, "").replace(/"practice_platform_flags"/, "")),
  `every status switch maps to a product's own imported flag constant, and no flag name is retyped${show(unknownFlags)}`);
const sidebarSrc = readFileSync("src/app/super-admin/_components/WorkspaceSidebar.tsx", "utf8");
ok("F2", !/offSwitches[^\n]*filter|filter[^\n]*offSwitches/.test(sidebarSrc) && /status=\{offSwitches && e\.flag && off\.has\(e\.flag\) \? "Off" : undefined\}/.test(sidebarSrc),
  "a switch is a status badge only: the sidebar never filters on it, and shows nothing when the read failed (null)");
const switches = readFileSync("src/lib/hq/nav-switches.ts", "utf8").replace(/\/\/.*$/gm, "");
ok("F3", !/\.(insert|update|upsert|delete)\(/.test(switches) && /if \(error\) return null;/.test(switches),
  "the switch reader writes nothing, and an unreadable flag table yields no badge rather than 'Off'");

console.log("\nN. Workspace resolution and search");
const EXPECT: [string, string][] = [
  ["/super-admin", "mission"], ["/super-admin/not-a-module", "mission"], ["/super-admin/priorities/ai", "mission"],
  ["/super-admin/learning/review", "governance"], ["/super-admin/learning/prices", "knowledge"],
  ["/super-admin/platform-ops/practice/identifiers", "products"], ["/super-admin/platform-ops/approvals", "governance"],
  ["/super-admin/platform-ops/ai-gateway", "ai"], ["/super-admin/platform-ops/schema", "platform"],
  ["/super-admin/pd/health/errors", "products"], ["/super-admin/cgr/risk", "frameworks"], ["/super-admin/research", "knowledge"],
  ["/super-admin/enterprise/organisations/abc", "products"], ["/super-admin/hospitals", "products"],
];
const wrongWs = EXPECT.filter(([p, w]) => hqWorkspaceForPath(p) !== w).map(([p, w]) => `${p} -> ${hqWorkspaceForPath(p)} (want ${w})`);
ok("N1", wrongWs.length === 0, `the active workspace is the page's home, by longest prefix (${EXPECT.length} paths)${show(wrongWs, 4)}`);
const corpus = new Set(hqSearchCatalogue(HQ_SEARCH_TABLES, OWNER).map(d => d.href));
const unsearchable = staticPages.filter(p => !corpus.has(p));
ok("N2", unsearchable.length === 0, `an owner's search finds every static HQ page (${corpus.size} destinations)${show(unsearchable)}`);
const none = hqSearchCatalogue(HQ_SEARCH_TABLES, { isOwner: false, capabilities: [] });
ok("N3", none.length === 0, "a viewer with no capability is offered nothing by search");

console.log(`\n${"=".repeat(72)}`);
console.log(`PASS ${pass}   FAIL ${failures.length}`);
if (failures.length) { console.log("\nFAILURES:"); failures.forEach(f => console.log(`  - ${f}`)); }
process.exit(failures.length ? 1 : 0);
