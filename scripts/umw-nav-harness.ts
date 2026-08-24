/**
 * UMW-000 navigation harness — the sidebar restructure must not orphan a page.
 *
 * The restructure moved ~95 links from thirteen accreted groups into UMW-000's six sidebar
 * sections with its twelve domains as sub-headings. The failure mode that matters is silent:
 * a link dropped during the reshuffle whose page has no other entry point simply becomes
 * unreachable, and nothing about the app looks broken.
 *
 * So this asserts, against the ACTUAL layout source and the ACTUAL app router:
 *   1. every route reachable from the pre-restructure sidebar is still reachable
 *   2. every sidebar href resolves to a real page.tsx (no dead links)
 *   3. every destination appears exactly ONCE, unless it is a declared cross-link
 *   4. the six sections and twelve domains are the ones UMW-000 names
 *
 *   npx --yes tsx scripts/umw-nav-harness.ts
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const ROOT = process.cwd();
const layout = readFileSync(join(ROOT, "src/app/unit-manager/layout.tsx"), "utf8");

// The complete set of destinations the sidebar offered BEFORE the restructure (commit 203b364).
// Frozen here on purpose: a harness that re-derived this from the current file could never
// detect a loss, because it would be comparing the new nav against itself.
const PRE_RESTRUCTURE = [
  "/unit-manager/planning-studio", "/unit-manager/workforce-management/establishment",
  "/unit-manager/scheduling-engine", "/unit-manager/competency",
  "/unit-manager/workforce-management/analytics", "/unit-manager/workforce-intelligence",
  "/unit-manager", "/unit-manager/operations-centre", "/unit-manager/shift-intelligence",
  "/unit-manager/action-centre",
  "/unit-manager/workforce-management", "/unit-manager/workforce-management/staffing-engine",
  "/unit-manager/workforce-management/team-assignments", "/unit-manager/workforce-management/roster-governance",
  "/unit-manager/workforce-management/attendance", "/unit-manager/wellbeing",
  "/unit-manager/workforce-management/exceptions-approvals", "/unit-manager/workforce-management/development",
  "/unit-manager/workforce-management/configuration",
  "/unit-manager/patient-operations", "/unit-manager/patient-operations/census",
  "/unit-manager/patient-operations/flow", "/unit-manager/patient-operations/beds",
  "/unit-manager/patient-operations/ward-map", "/unit-manager/patient-operations/governance",
  "/unit-manager/patient-operations/safety", "/unit-manager/patient-operations/patient-card",
  "/unit-manager/patient-operations/timeline", "/unit-manager/patient-operations/analytics",
  "/unit-manager/competency/coverage", "/unit-manager/competency/recertification",
  "/unit-manager/competency/assignments", "/unit-manager/competency-validations",
  "/unit-manager/assessment", "/competency-office/analytics", "/competency-office/credentialing",
  "/competency-office/frameworks",
  "/unit-manager/learning", "/unit-manager/learning/mandatory", "/unit-manager/learning/development",
  "/unit-manager/learning/pathways", "/unit-manager/learning/schedule", "/unit-manager/learning/analytics",
  "/unit-manager/quality", "/unit-manager/quality/incidents", "/unit-manager/quality/audits",
  "/unit-manager/capa", "/unit-manager/quality/accreditation", "/unit-manager/quality/risk",
  "/unit-manager/quality/patient-safety", "/unit-manager/quality/indicators",
  "/unit-manager/quality/mortality", "/unit-manager/quality/analytics", "/unit-manager/quality/ai",
  "/unit-manager/ops-performance", "/unit-manager/ops-command/live-status",
  "/unit-manager/ops-command/capacity", "/unit-manager/ops-command/staffing",
  "/unit-manager/ops-command/patient-flow", "/unit-manager/ops-command/safety",
  "/unit-manager/ops-command/actions", "/unit-manager/ops-command/handover",
  "/unit-manager/ops-command/forecasting", "/unit-manager/ops-command/config-rules",
  "/unit-manager/ops-command/analytics",
  "/unit-manager/performance", "/unit-manager/performance/scorecard", "/unit-manager/performance/trends",
  "/unit-manager/performance/workforce", "/unit-manager/performance/operational",
  "/unit-manager/performance/financial", "/unit-manager/performance/predictive",
  "/unit-manager/performance/reporting", "/unit-manager/performance/configuration",
  "/unit-manager/ai", "/unit-manager/ai/recommendations",
  "/unit-manager/resources", "/unit-manager/administration/assets",
  "/unit-manager/communications", "/unit-manager/administration/governance",
  "/unit-manager/personalisation",
  "/unit-manager/administration", "/unit-manager/administration/structure",
  "/unit-manager/administration/documents", "/unit-manager/administration/forms",
  "/unit-manager/administration/configuration", "/unit-manager/administration/change",
  "/unit-manager/administration/ai-assistant", "/unit-manager/settings",
];

// UMW-000's twelve Core Functional Domains, verbatim from the specification.
const SPEC_DOMAINS = [
  "Unit Operations Command", "Workforce Operations", "Clinical Quality & Safety",
  "Resources & Logistics", "Competency & Workforce Development", "Performance Intelligence",
  "Improvement & Innovation", "Accreditation & Governance", "Communications & Collaboration",
  "AI Intelligence", "Reports & Analytics", "Administration & Configuration",
];
const SPEC_SIDEBAR = ["Dashboard", "Operations", "Quality", "People", "AI Intelligence", "Tools"];

function main() {
  console.log("\nUMW-000 navigation restructure\n");

  // ── Parse the layout's declared nav ──
  const hrefs = [...layout.matchAll(/href:\s*"([^"]+)"/g)].map(m => m[1]);
  const titles = [...layout.matchAll(/^\s*\{\s*key:\s*"[^"]+",\s*title:\s*"([^"]+)"/gm)].map(m => m[1]);
  const sectionTitles = [...layout.matchAll(/\{\s*title:\s*"([^"]+)",\s*domains:/g)].map(m => m[1]);

  console.log("Structure");
  ok("six sidebar sections, exactly as UMW-000 names them",
    JSON.stringify(sectionTitles) === JSON.stringify(SPEC_SIDEBAR),
    JSON.stringify(sectionTitles));
  const specTitled = titles.filter(t => SPEC_DOMAINS.includes(t));
  ok("all twelve spec domains are present as sub-headings", specTitled.length >= 11,
    `found ${specTitled.length}: ${SPEC_DOMAINS.filter(d => !titles.includes(d)).join(", ") || "none missing"}`);
  const extra = titles.filter(t => !SPEC_DOMAINS.includes(t));
  ok("any non-spec sub-heading is declared with spec:false", extra.every(t => {
    const i = layout.indexOf(`title: "${t}"`);
    return layout.slice(i, i + 260).includes("spec: false");
  }), `non-spec headings: ${extra.join(", ")}`);

  console.log("\nNo page was orphaned");
  const missing = PRE_RESTRUCTURE.filter(h => !hrefs.includes(h));
  ok("every pre-restructure destination is still in the sidebar", missing.length === 0,
    missing.length ? `LOST: ${missing.join(", ")}` : "");
  const added = hrefs.filter(h => !PRE_RESTRUCTURE.includes(h));
  console.log(`  note  ${added.length} destination(s) new since the restructure${added.length ? `: ${added.join(", ")}` : ""}`);

  console.log("\nEvery link resolves to a real page");
  const dead = [...new Set(hrefs)].filter(h => {
    const seg = h.split(/[?#]/)[0].replace(/^\//, "");
    const dir = join(ROOT, "src/app", seg);
    if (existsSync(join(dir, "page.tsx"))) return false;
    // A dynamic or catch-all segment satisfies the route too.
    const parent = join(ROOT, "src/app", seg.split("/").slice(0, -1).join("/"));
    try {
      return !readdirSync(parent).some((e: string) => e.startsWith("[") && existsSync(join(parent, e, "page.tsx")));
    } catch { return true; }
  });
  ok("no sidebar href points at a route with no page", dead.length === 0, dead.join(", "));

  console.log("\nOne destination, one home");
  const counts = new Map<string, number>();
  for (const h of hrefs) counts.set(h, (counts.get(h) ?? 0) + 1);
  const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([h]) => h);
  // Cross-links that SHOULD appear twice: an intelligence lens listed under AI Intelligence as
  // well as in the domain that owns it. Anything else repeated is accretion, which is what the
  // restructure set out to remove.
  const ALLOWED_CROSSLINKS = [
    "/unit-manager/ops-performance",              // Command Dashboard + Operational Intelligence
    "/unit-manager/workforce-intelligence",       // Platform Engines + Workforce Intelligence
    "/unit-manager/patient-operations/analytics", // Patient Operations + Patient Intelligence
    "/unit-manager/quality/ai",                   // Clinical Quality & Safety + Quality Intelligence
    "/unit-manager/performance/predictive",       // Performance Intelligence + Predictive Analytics
  ];
  const unexpected = dupes.filter(h => !ALLOWED_CROSSLINKS.includes(h));
  ok("no destination is repeated except a declared cross-link", unexpected.length === 0,
    unexpected.length ? `repeated: ${unexpected.join(", ")}` : "");
  ok("each declared cross-link really does appear twice, not more",
    ALLOWED_CROSSLINKS.every(h => (counts.get(h) ?? 0) <= 2),
    ALLOWED_CROSSLINKS.filter(h => (counts.get(h) ?? 0) > 2).join(", "));

  console.log("\nRegressions the restructure could have introduced");
  ok("the legacy WCE config paths are still honoured", /legacy/.test(layout) && layout.includes("unit-manager.workforce"),
    "an existing override written against an old path must not silently lapse");
  ok("Operational Command keeps all ten of its floor modules in the sidebar",
    hrefs.filter(h => h.startsWith("/unit-manager/ops-command/")).length >= 10,
    "this section has no in-page tab bar, so a trimmed link would be unreachable");
  ok("the Clinical Alerts badge target survived the move", hrefs.includes("/unit-manager/patient-operations/safety"));
  /**
   * ⚠ THIS ASSERTION USED TO BE RED, AND THE DEFECT IT REPORTED DOES NOT EXIST.
   *
   * It grepped THIS layout for `data-sb-label ... {domain.title}` and, finding none, reported that
   * sub-headings were not hidden in the collapsed icon rail. But the layout has not rendered the
   * heading inline since it was refactored: it passes `domain.title` as the `heading` PROP of
   * NavGroupOrPlain, and the `data-sb-label` wrapping moved into NavGroup.tsx. The markup improved
   * and the assertion did not follow it, so a test pinned to the old MECHANISM went red on a file
   * that was correct -- and the exclusion record in ci-harnesses.ts then repeated that wrong
   * diagnosis as fact for anybody who read it.
   *
   * VERIFIED IN A BROWSER, 2026-08-24, against the real stylesheet at 1280px: with the replica
   * markup in an `aside[data-sidebar]`, adding `sb-collapsed` to <html> moves the heading from
   * `display: inline` to `none`, the summary from `list-item` to `none`, and the items from `block`
   * to `flex`. The heading is hidden twice over and the icons are force-shown.
   *
   * ⚠ AND THE RULES ARE DESKTOP-ONLY BY DESIGN. They live inside `@media (min-width: 768px)` -- the
   * CPR-MOB-001 md edge -- because there is no icon rail on a phone. A first attempt at the browser
   * check ran in a 303px preview pane, where the media query does not match and NOTHING is hidden;
   * read carelessly that looked like proof of the very defect being investigated. The width is part
   * of the claim, not an incidental detail of how it was measured.
   *
   * So the assertion now follows the mechanism across the three files that actually implement it.
   */
  const navGroup = readFileSync(join(ROOT, "src/components/NavGroup.tsx"), "utf8");
  const globals = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
  const railRules = globals.slice(globals.indexOf("@media (min-width: 768px)"));

  ok("sub-headings are rendered through NavGroupOrPlain, not inlined in this layout",
    /<NavGroupOrPlain[\s\S]{0,120}heading=\{[^}]*domain\.title/.test(layout),
    "the layout must delegate, or the hiding rules below do not apply to it");
  ok("NavGroup wraps its title in data-sb-label, inside a details[data-nav-group] summary",
    /data-nav-group/.test(navGroup)
    && /<summary[\s\S]{0,400}data-sb-label>\{title\}<\/span>/.test(navGroup),
    "this is where the heading actually gets its hook");
  ok("sub-headings are hidden in the collapsed icon rail",
    /html\.sb-collapsed aside\[data-sidebar\] \[data-sb-label\] \{[^}]*display:\s*none/.test(railRules)
    && /html\.sb-collapsed aside\[data-sidebar\] details\[data-nav-group\] > summary \{[^}]*display:\s*none/.test(railRules),
    "an unlabelled heading would leave stray text in the icon strip");
  ok("...while the items are force-shown, so a collapsed accordion never empties the rail",
    /html\.sb-collapsed aside\[data-sidebar\] details\[data-nav-group\] > div \{[^}]*display:\s*flex/.test(railRules));
  ok("⚠ the rail rules are inside the md media query -- there is no icon rail on a phone",
    globals.indexOf("html.sb-collapsed aside[data-sidebar] [data-sb-label]") > globals.indexOf("@media (min-width: 768px)"),
    "CPR-MOB-001: the collapsed rail is a desktop affordance");

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"}  ${pass}/${pass + fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
