/**
 * CPR-PD-001 — THE PRACTICE PRODUCT DIRECTOR NAVIGATION FREEZE.
 *
 * s11: "This document freezes the sidebar/navigation architecture only." These pins ARE that freeze —
 * the next change to this IA arrives holding an approved information-architecture change, or this file
 * goes red. s9 says the same thing from the other side: "use concise labels exactly as prescribed
 * unless a later approved information-architecture change replaces them".
 *
 * ⚠ WHAT IT CANNOT DO, SAID FIRST. Eleven of PD-001 s10's twelve acceptance criteria are statements
 * about a RENDERED, SIGNED-IN session — that a Product Director lands on Mission Control, that collapse
 * survives a refresh, that a collapsed icon shows its label on hover, that an unauthorised destination
 * is unreachable by direct URL. This process has no browser and no session. What a source harness can
 * prove is the layer underneath: that the twelve destinations exist in the frozen order under the
 * frozen labels, that every one of them is a real route carrying its own server-side guard, and that
 * the re-parented page was pointed at rather than rebuilt. The walk-through remains the owner's.
 *
 * ⚠ AND IT IMPORTS THE SHIPPING TABLE. A harness that declares its own copy of the nav proves only
 * that the copy equals itself — the reason nav-tables.ts was split out of its client component in the
 * first place. PD_NAV below is the object the sidebar renders.
 *
 *   npx --yes tsx scripts/pd-nav-harness.ts
 *
 * Source and pure constants only: no database, no env, no dev server.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PD_NAV, PD_GROUPS, PD_HOME, PD_ALL_HREFS, PD_EXTERNAL_HREFS,
} from "../src/app/super-admin/_components/pd-nav";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

console.log("\nCPR-PD-001 -- Product Director navigation freeze\n");

// ---------------------------------------------------------------------------------------------
// 1. s2 -- THE FROZEN TWELVE, IN THEIR FROZEN GROUPS AND ORDER
// ---------------------------------------------------------------------------------------------
console.log("1. s2 the frozen information architecture");

// Transcribed from PD-001 s2's own table. ⚠ This list is the SPEC's, not the code's: if it were read
// from PD_NAV the assertion would be that the table equals itself, which is the one thing it cannot
// usefully prove.
const PRESCRIBED: [string, string[]][] = [
  ["OPERATE", ["Mission Control", "Practices", "Practitioners", "Product Operations"]],
  ["UNDERSTAND", ["Product Intelligence", "Adoption & Growth", "Commercial"]],
  ["CONTROL", ["Product Health", "Support & Incidents", "Governance & Risk"]],
  ["MANAGE", ["Product Configuration", "Releases & Capabilities"]],
];

ok("1a the four groups are Operate, Understand, Control, Manage, in that order",
  PD_NAV.map(g => g.group).join(",") === PRESCRIBED.map(([g]) => g).join(",")
  && PD_GROUPS.join(",") === PRESCRIBED.map(([g]) => g).join(","),
  PD_NAV.map(g => g.group).join(","));

for (const [group, labels] of PRESCRIBED) {
  const actual = PD_NAV.find(g => g.group === group)?.items.map(i => i.label) ?? [];
  ok(`1b ${group} holds exactly its prescribed items, in order`,
    actual.join(" | ") === labels.join(" | "),
    `got: ${actual.join(" | ") || "nothing"}`);
}

ok("1c twelve destinations, no more and no fewer",
  PD_NAV.flatMap(g => g.items).length === 12,
  `${PD_NAV.flatMap(g => g.items).length}`);

// ---------------------------------------------------------------------------------------------
// 2. s8 -- WHERE A PRODUCT DIRECTOR LANDS, AND WHERE THEY MUST NOT
// ---------------------------------------------------------------------------------------------
console.log("\n2. s8 landing and destinations");

/**
 * ⚠ THE SENTENCE THIS PIN EXISTS FOR: "Mission Control is the default Product Director landing route.
 * It must not route to the existing technical Practice Operations page." The failure it guards is not
 * hypothetical -- /super-admin ALREADY renders a Practice mission control, and the quickest way to
 * "finish" this workspace would be to point its home at the operations console that already has data.
 */
const missionControl = PD_NAV[0].items[0];
ok("2a Mission Control is the landing route and is not the technical operations page",
  missionControl.label === "Mission Control"
  && missionControl.href === PD_HOME
  && !PD_EXTERNAL_HREFS.includes(missionControl.href)
  && !missionControl.href.includes("platform-ops"),
  missionControl.href);

// s8: "Top-level sidebar items should route directly to their overview page." A parent whose href is
// only a disclosure toggle would fail the spec's own predictable-destination rule.
const parentless = PD_NAV.flatMap(g => g.items).filter(i => !i.href || !i.href.startsWith("/"));
ok("2b every top-level item routes somewhere, including the ones with children",
  parentless.length === 0, parentless.map(i => i.label).join(", "));

// A child that does not live under its parent breaks active-state inheritance (s4: "Parent Product
// Operations remains active when a child route is open"), which is computed from the path prefix.
const strayChildren = PD_NAV.flatMap(g => g.items).flatMap(i =>
  (i.children ?? [])
    .filter(c => !c.href.startsWith(i.href) && !PD_EXTERNAL_HREFS.includes(c.href))
    .map(c => `${i.label} > ${c.label} (${c.href})`));
ok("2c every child sits under its parent's path, so a parent stays active with a child open",
  strayChildren.length === 0, strayChildren.join(", "));

const dupes = PD_ALL_HREFS.filter((h, i) => PD_ALL_HREFS.indexOf(h) !== i);
ok("2d no destination appears twice", dupes.length === 0, dupes.join(", "));

// ---------------------------------------------------------------------------------------------
// 3. s3 -- THE EXISTING PAGE IS RE-PARENTED, NOT REBUILT
// ---------------------------------------------------------------------------------------------
console.log("\n3. s3 Product Operations nesting");

const ops = PD_NAV.flatMap(g => g.items).find(i => i.label === "Product Operations");
const opsChildren = (ops?.children ?? []).map(c => c.label);
// s3's own minimum list. "Technical Operations / Diagnostics" is matched on its stem because the
// spec writes it with a slash and a sidebar cannot.
for (const required of ["Operations Overview", "Provisioning & Onboarding", "Practice Workspaces",
  "Launch Readiness", "Technical Operations"]) {
  ok(`3a Product Operations exposes ${required}`,
    opsChildren.some(l => l.startsWith(required)), opsChildren.join(" | "));
}

/**
 * ⚠ THE POINT OF s3, AND THE THING MOST LIKELY TO BE LOST. "The current Competen Practice module shown
 * in the existing build must be retained and reorganised under Product Operations." The existing page
 * is the ONLY caller of the provisioning API and carries the IAM-001 s14 gate ledger whose whole
 * honesty is that manual gates are never auto-greened. A rebuild would reproduce the layout and lose
 * that. So the child must POINT AT the page that exists, and that page must still be there.
 */
const technical = (ops?.children ?? []).find(c => c.label.startsWith("Technical Operations"));
ok("3b Technical Operations points at the page that already exists, rather than a rebuild of it",
  !!technical && PD_EXTERNAL_HREFS.includes(technical.href)
  && existsSync(join(process.cwd(), "src/app/super-admin/platform-ops/practice/page.tsx")),
  technical?.href ?? "missing");

// ---------------------------------------------------------------------------------------------
// 4. PD-010 s2 -- GOVERNANCE & RISK'S ELEVEN SUBMODULES
// ---------------------------------------------------------------------------------------------
console.log("\n4. PD-010 s2 Governance & Risk submodules");

const gov = PD_NAV.flatMap(g => g.items).find(i => i.label === "Governance & Risk");
const govChildren = (gov?.children ?? []).map(c => c.label);
for (const required of ["Governance Overview", "Product Risk Register", "Controls & Assurance",
  "Privacy & Data Governance", "Security Governance", "Clinical Safety Governance",
  "Compliance & Obligations", "Decisions & Approvals", "Exceptions & Risk Acceptance",
  "Audit & Evidence", "Governance Reviews"]) {
  ok(`4a Governance & Risk exposes ${required}`, govChildren.includes(required), govChildren.join(" | "));
}

// ---------------------------------------------------------------------------------------------
// 5. s7 -- EVERY DESTINATION IS A REAL ROUTE THAT GUARDS ITSELF
// ---------------------------------------------------------------------------------------------
console.log("\n5. s7 every destination exists and enforces its own authorization");

/**
 * ⚠ "A HIDDEN NAVIGATION ITEM DOES NOT CONSTITUTE AUTHORIZATION. Every destination must enforce
 * server-side authorization" (s7). And Next's own documentation is explicit that a layout is not the
 * place for it -- node_modules/next/dist/docs/01-app/02-guides/authentication.md: a layout check "will
 * not prevent nested route segments and Server Actions from being accessed", and layouts "don't
 * re-render on navigation". So the guard is asserted PER PAGE, not once at the top.
 */
const ours = PD_ALL_HREFS.filter(h => h !== PD_HOME && !PD_EXTERNAL_HREFS.includes(h));
const pageFor = (href: string) => join(process.cwd(), "src/app", href, "page.tsx");

const missing = ours.filter(h => !existsSync(pageFor(h)));
ok("5a every destination in the table is a real route",
  missing.length === 0, `${missing.length} missing: ${missing.slice(0, 4).join(", ")}`);

/**
 * ⚠ THE AWAITED CALL, NOT THE NAME (caught by break-testing this pin, 2026-08-17).
 *
 * This first tested `/requireHqCapability/`, and the break-test — deleting the guard from a page —
 * did NOT redden it: the `import { requireHqCapability }` line still carried the word. The pin was
 * matching the IMPORT of the guard rather than its use, so a page could import it, never call it, and
 * pass. Exactly the shape this repo has recorded before: presence is not validity.
 *
 * `await` is required too. `requireHqCapability(...)` un-awaited returns a promise and the component
 * proceeds to render underneath it, which is the "must not render protected data before denial"
 * failure (s7) wearing the look of a guarded page.
 */
const GUARD = /await\s+requireHqCapability\s*\(/;
const ungated = ours.filter(h => existsSync(pageFor(h)) && !GUARD.test(readFileSync(pageFor(h), "utf8")));
ok("5b every route AWAITS its own server-side capability guard",
  ungated.length === 0, `${ungated.length} ungated: ${ungated.slice(0, 4).join(", ")}`);

// ⚠ CONTROL. 5a and 5b are both satisfied by an EMPTY list, so a table that lost its hrefs would make
// them green. This proves the scan had real work to do.
ok("5-control the destination scan read a real table",
  ours.length >= 60 && PD_ALL_HREFS.length > PD_NAV.flatMap(g => g.items).length,
  `${ours.length} routes owned, ${PD_ALL_HREFS.length} destinations total`);

// ---------------------------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
console.log("\n⚠ Source-level only. PD-001 s10's acceptance criteria -- landing, collapse persistence");
console.log("  across a refresh, hover/focus labels on a collapsed icon, off-canvas mobile, and direct-URL");
console.log("  refusal -- are statements about a signed-in session and remain the owner's to walk.\n");
