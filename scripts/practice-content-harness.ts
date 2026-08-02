/**
 * Competen Practice public section harness (CPR-000 .. CPR-020).
 *
 * WHAT THIS IS FOR. The /practice section was derived from twenty developer specifications. "Derived from"
 * is exactly the kind of claim that is true on the day it is written and quietly false a year later: a
 * module gets dropped in a copy edit, an area is renamed and its screens are never re-pointed, a roadmap
 * integration loses its label and starts reading as shipped. None of that breaks a build. So the claims are
 * asserted here instead of trusted.
 *
 * FOUR THINGS ARE PROVEN:
 *
 *   COVERAGE  - every specified module (CPR-001..020) is claimed by exactly one area, and no area claims a
 *               module that does not exist. Dropping a spec is then a test failure, not an oversight.
 *   ASSETS    - every screen referenced by the catalogue exists on disk AND is served. A broken image on a
 *               marketing page is the most embarrassing possible failure and the easiest to not notice.
 *   HONESTY   - the preview note renders on every page that shows a mockup, and every roadmap integration
 *               is labelled as such on the rendered page. Both are promises to the visitor; both live in
 *               prose, which is to say both decay silently.
 *   DISCLOSURE- WEB-STRAT-001's forbidden product names appear on none of these pages.
 *
 * Asserted against RENDERED HTML, not source, because a leak or a lost label reaches the visitor through
 * the render regardless of which file it came from.
 *
 * Needs the dev server on :3000.
 *   npx --yes tsx scripts/practice-content-harness.ts
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  PRACTICE_AREAS, INTEGRATIONS, PREVIEW_NOTE, MODULES_WITHOUT_SPECS, PRACTICE_HERO, TENANT_MODEL,
} from "../src/lib/marketing/practice-content";
import { JOURNEYS, AVAILABILITY, FAQS } from "../src/lib/marketing/practice-site";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

/**
 * Every specification document that exists, and can therefore be cited by an area.
 *
 * CPR-001..020 are the workspace specs; PEN-001..015 are the Version 2 engine specs. CPR-000, CPR-000A and
 * the five CPR-ARCH documents are architecture rather than modules, so they are not listed -- an area
 * citing one of them would be claiming to cover a whole layer.
 *
 * The PEN ids follow the PEN SPECIFICATIONS, not CPR-ARCH-001 section 13.2, which numbers the same fifteen
 * engines completely differently. See SPEC_CONFLICTS in practice-content.ts.
 */
const SPECIFIED = [
  ...Array.from({ length: 20 }, (_, i) => `CPR-${String(i + 1).padStart(3, "0")}`),
  ...Array.from({ length: 15 }, (_, i) => `PEN-${String(i + 1).padStart(3, "0")}`),
];

// Same list as the public-disclosure harness, deliberately duplicated: if that file is ever narrowed, this
// one still fails, and two harnesses disagreeing is a louder signal than one silently relaxing.
const FORBIDDEN = [
  "Competency Management", "Workforce Management", "Executive Intelligence",
  "Recruitment platform", "Learning platform", "Competency Studio", "Assessment Studio",
  "AI platform", "Platform operations", "Configuration, integration",
];

// VOCABULARY FROM THE SOURCE DOCUMENTS THAT MUST NOT REACH A VISITOR.
//
// CPR-000A and CPR-019 Revision 2 are internal architecture papers. They describe the landlord control
// plane, the super-administrator's power to suspend a tenant and to open an audited impersonation session,
// and the internal architectures being bridged. Those sentences are RIGHT THERE in the material this page
// was written from, which makes them a copy-paste away from the public site at every future edit -- and
// "we can impersonate your users" is not a claim a clinic should first meet on a marketing page.
//
// This is a separate assertion from FORBIDDEN because it guards a different risk: not a product name that
// competitors should not see, but internal machinery that a CUSTOMER should not be handed unprompted.
const INTERNAL_VOCABULARY = [
  "landlord", "control plane", "impersonat", "super administrator", "super admin",
  "tenant lifecycle", "suspend", "maintenance mode", "telemetry", "LCP", "PSA",
];

function visibleText(html: string): string {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  // Entities are DECODED, not blanked. Blanking them turned "EMR &amp; EHR systems" into "EMR  EHR
  // systems", so searching for the name the page actually displays found nothing -- and a harness that
  // reports a problem the page does not have gets switched off within a week.
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ");
}

async function main() {
  // ── 1. COVERAGE: the specs actually made it into the content ──────────────────────────────────────
  const claimed = PRACTICE_AREAS.flatMap(a => a.modules);
  const counts = new Map<string, number>();
  for (const m of claimed) counts.set(m, (counts.get(m) ?? 0) + 1);

  const uncovered = SPECIFIED.filter(m => !counts.has(m));
  ok("1. every specified module is covered by an area", uncovered.length === 0,
    `uncovered: ${uncovered.join(", ")}`);

  const twice = [...counts.entries()].filter(([, n]) => n > 1).map(([m]) => m);
  ok("1b. no module is claimed by two areas", twice.length === 0, twice.join(", "));

  const unknown = [...counts.keys()].filter(m => !SPECIFIED.includes(m));
  ok("1c. no area claims a module that has no specification", unknown.length === 0, unknown.join(", "));

  // The recorded gap must stay a gap. If CPR-021 is ever written into an area, this list is stale and the
  // "no specification supplied" note beside it has become a lie.
  const gapClaimed = MODULES_WITHOUT_SPECS.filter(m => counts.has(m));
  ok("1d. the recorded spec gap is still a gap", gapClaimed.length === 0, gapClaimed.join(", "));

  // ── 2. ASSETS: every screen exists on disk ────────────────────────────────────────────────────────
  const allImages = [PRACTICE_HERO.image, ...PRACTICE_AREAS.flatMap(a => a.screens.map(s => s.src))];
  const missingOnDisk = [...new Set(allImages)].filter(src => !existsSync(join(process.cwd(), "public", src)));
  ok("2. every referenced screen exists on disk", missingOnDisk.length === 0, missingOnDisk.join(", "));

  const emptyAlt = PRACTICE_AREAS.flatMap(a => a.screens).filter(s => s.alt.trim().length < 20);
  ok("2b. every screen has descriptive alt text", emptyAlt.length === 0, emptyAlt.map(s => s.src).join(", "));

  // ── 3. every area page is reachable, and carries what it promises ─────────────────────────────────
  const PAGES = ["/practice", ...PRACTICE_AREAS.map(a => `/practice/${a.slug}`)];
  const overview = await fetch(`${BASE}/practice`).then(r => r.text()).catch(() => "");

  for (const path of PAGES) {
    let html = "";
    try {
      const r = await fetch(BASE + path);
      ok(`3. ${path} returns 200`, r.ok, `status ${r.status}`);
      html = await r.text();
    } catch (e) {
      ok(`3. ${path} returns 200`, false, e instanceof Error ? e.message : String(e));
      continue;
    }
    const text = visibleText(html);

    const leaked = FORBIDDEN.filter(f => text.toLowerCase().includes(f.toLowerCase()));
    ok(`3b. ${path} discloses no hidden product`, leaked.length === 0, leaked.join(", "));

    // HONESTY RULE 1. Every page here renders mockups; every one of them must say so.
    ok(`3c. ${path} labels its screens as previews`, text.includes(PREVIEW_NOTE));

    // Case-insensitive and substring, so "Impersonation", "impersonate" and "Landlord Control Plane" all
    // trip it. Word-boundary matching would let a plural or a participle through.
    const internal = INTERNAL_VOCABULARY.filter(w => text.toLowerCase().includes(w.toLowerCase()));
    ok(`3d. ${path} leaks no internal platform vocabulary`, internal.length === 0, internal.join(", "));
  }

  // ── 4. NAVIGATION: catalogue, nav and routes agree ────────────────────────────────────────────────
  for (const a of PRACTICE_AREAS) {
    ok(`4. /practice links to ${a.slug}`, overview.includes(`/practice/${a.slug}"`));
  }
  ok("4b. the dynamic route file exists",
    existsSync(join(process.cwd(), "src", "app", "practice", "[area]", "page.tsx")));

  // A slug that is not in the catalogue must 404 rather than render an empty shell.
  const bogus = await fetch(`${BASE}/practice/not-a-real-area`).then(r => r.status).catch(() => 0);
  ok("4c. an unknown area 404s", bogus === 404, `status ${bogus}`);

  // ── 5. HONESTY RULE 2: roadmap integrations are labelled where they are shown ─────────────────────
  const overviewText = visibleText(overview);
  const roadmap = INTEGRATIONS.filter(i => !i.inV1);
  ok("5. there is something on the roadmap to label", roadmap.length > 0);

  // Each roadmap integration must be followed by its label before the next integration's name starts --
  // asserting only that the word "Roadmap" appears somewhere would pass even if the chips were rendered
  // against the wrong items.
  const mislabelled = roadmap.filter(i => {
    const at = overviewText.indexOf(i.name);
    if (at === -1) return true;
    return !overviewText.slice(at, at + i.name.length + 60).includes("Roadmap");
  });
  ok("5b. every roadmap integration is labelled on the page", mislabelled.length === 0,
    mislabelled.map(i => i.name).join(", "));

  const v1 = INTEGRATIONS.filter(i => i.inV1);
  const overLabelled = v1.filter(i => {
    const at = overviewText.indexOf(i.name);
    return at !== -1 && overviewText.slice(at, at + i.name.length + 60).includes("Roadmap");
  });
  ok("5c. Version 1 integrations are NOT labelled as roadmap", overLabelled.length === 0,
    overLabelled.map(i => i.name).join(", "));

  // ── 5d. CPR-000A: the tenant model renders, and its diagram does NOT ──────────────────────────────
  for (const p of TENANT_MODEL.pillars) {
    ok(`5d. /practice states "${p.title}"`, overviewText.includes(p.title));
  }
  ok("5e. /practice states who can change what", overviewText.includes(TENANT_MODEL.boundary.slice(0, 60)));

  // The enterprise architecture diagram draws the control plane and the full product ecosystem. It must
  // not be published, and an image cannot be caught by any text assertion above -- so its absence from the
  // built assets is asserted directly.
  const architectureLeaks = ["architecture", "cpr-000a", "ecosystem", "control-plane"]
    .filter(n => existsSync(join(process.cwd(), "public", "images", "practice", `${n}.webp`)));
  ok("5f. the enterprise architecture diagram is not published", architectureLeaks.length === 0,
    architectureLeaks.join(", "));

  // ── 7. LP-PRA-001 journeys, and the honesty they carry ────────────────────────────────────────────
  //
  // Four journeys replaced a single "Book a Demo" that sent everyone to /signup. Two things can rot here:
  // a journey losing its page, and a journey page quietly dropping the notice that says it is not open.
  // The second is the dangerous one -- it turns an honest holding page into a product that appears broken.

  const areaSlugs = new Set(PRACTICE_AREAS.map(a => a.slug));
  const shadowed = JOURNEYS.filter(j => areaSlugs.has(j.href.replace("/practice/", "")));
  ok("7. no journey route collides with a capability slug", shadowed.length === 0,
    shadowed.map(j => j.href).join(", "));

  for (const j of JOURNEYS) {
    let html = "";
    try {
      const r = await fetch(BASE + j.href);
      ok(`7a. ${j.href} returns 200`, r.ok, `status ${r.status}`);
      html = await r.text();
    } catch (e) {
      ok(`7a. ${j.href} returns 200`, false, e instanceof Error ? e.message : String(e));
      continue;
    }
    const text = visibleText(html);

    ok(`7b. ${j.href} says it is not open yet`, text.includes(AVAILABILITY.headline));

    const leaked = FORBIDDEN.filter(f => text.toLowerCase().includes(f.toLowerCase()));
    ok(`7c. ${j.href} discloses no hidden product`, leaked.length === 0, leaked.join(", "));

    const internal = INTERNAL_VOCABULARY.filter(w => text.toLowerCase().includes(w.toLowerCase()));
    ok(`7d. ${j.href} leaks no internal platform vocabulary`, internal.length === 0, internal.join(", "));

    // NO SIGN-IN FORM. The roles these pages route to do not exist, so a password field here would
    // collect a credential and have nowhere to send the person who typed it. Asserted on the rendered
    // HTML rather than the source, because a form could arrive through a shared component.
    const hasPasswordField = /<input[^>]+type=["']password["']/i.test(html);
    ok(`7e. ${j.href} has no password field`, !hasPasswordField);
  }

  // Every journey must be reachable from the landing page, or it is a page with no way in.
  for (const j of JOURNEYS) {
    ok(`7f. /practice links to ${j.href}`, overview.includes(`href="${j.href}"`));
  }

  // LP-PRA-001 asks for FAQs. The availability question is the one a visitor has by the time they reach
  // the bottom and the easiest to quietly drop, so its presence is asserted rather than assumed.
  ok("7g. /practice renders the FAQs", FAQS.every(f => overviewText.includes(f.q)));
  ok("7h. the FAQs answer whether it can be used today",
    FAQS.some(f => /try it today|available/i.test(f.q)));

  // ── 6. the images are actually served, not merely present ─────────────────────────────────────────
  const notServed: string[] = [];
  for (const src of [...new Set(allImages)]) {
    const r = await fetch(BASE + src).catch(() => null);
    if (!r?.ok) notServed.push(`${src} (${r?.status ?? "no response"})`);
  }
  ok("6. every screen is served over HTTP", notServed.length === 0, notServed.join(", "));

  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exitCode = fails.length ? 1 : 0;
}

main().catch(e => { console.error("\nHARNESS ERROR:", e instanceof Error ? e.message : e); process.exitCode = 1; });
