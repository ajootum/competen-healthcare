/**
 * Public disclosure harness (WEB-STRAT-001).
 *
 * THE RULE THIS GUARDS. The strategy names products that must NOT appear on the public website at all --
 * Competency Management, Workforce Management, Executive Intelligence, Recruitment, the Learning platform,
 * Competency Studio, Assessment Studio, the AI platform, platform operations, and the configuration and
 * integration engines. "Hide unauthorised products completely rather than displaying disabled menus" means
 * the NAMES stay off the public pages, not merely the links.
 *
 * That is a rule about prose, which is exactly the kind that decays. One enthusiastic sentence in a
 * marketing edit six months from now puts "Competency Studio" back on the homepage and nobody reviewing
 * the copy will remember there was a rule. So it is asserted against the RENDERED HTML of every public
 * page, not against the source: a leak through a shared component or a data file still reaches the visitor.
 *
 * ALSO ASSERTED:
 *   - every solution in the catalogue has a real route, and every primary one appears in the nav
 *   - the four Phase 1 landing pages exist and return 200
 *   - /quality is reachable but NOT in the primary menu (the spec makes it secondary)
 *   - robots.txt disallows every authenticated workspace prefix, and /verify
 *
 * Needs the dev server on :3000.
 *   npx --yes tsx scripts/public-disclosure-harness.ts
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SOLUTIONS, PRIMARY_SOLUTIONS } from "../src/lib/marketing/solutions";
import { PRACTICE_AREAS } from "../src/lib/marketing/practice-content";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

// Phrases that must not appear on a public page. Kept as the spec's own words so the list can be diffed
// against the document rather than re-interpreted.
const FORBIDDEN = [
  "Competency Management", "Workforce Management", "Executive Intelligence",
  "Recruitment platform", "Learning platform", "Competency Studio", "Assessment Studio",
  "AI platform", "Platform operations", "Configuration, integration",
];

// The Practice capability pages are included: they are the most detailed public pages on the site and
// therefore the likeliest place for a product name to leak into a sentence about what something connects to.
const PUBLIC_PAGES = [
  "/", ...SOLUTIONS.map(s => `/${s.slug}`),
  ...PRACTICE_AREAS.map(a => `/practice/${a.slug}`),
  "/login", "/signup",
];

// Strip tags AND the Next.js RSC payload. The flight data at the bottom of the document repeats every
// string in the tree; matching against it would report a leak on a page that never displays the words --
// a false positive that would get the harness ignored inside a week.
function visibleText(html: string): string {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  // Entities are DECODED rather than blanked: blanking splits "Workforce &amp; Capability" into two
  // fragments, so a forbidden phrase containing an ampersand would slip past unnoticed.
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
  // ---- 1. routes exist on disk ---------------------------------------------------------------------
  for (const s of SOLUTIONS) {
    ok(`1. /${s.slug} has a page`, existsSync(join(process.cwd(), "src", "app", s.slug, "page.tsx")));
  }

  // ---- 2. every page is reachable, and the disclosure rule holds on what it renders -----------------
  let reachable = 0;
  for (const path of PUBLIC_PAGES) {
    let html = "";
    try {
      const r = await fetch(BASE + path);
      if (r.ok) reachable++;
      html = await r.text();
      ok(`2. ${path} returns 200`, r.ok, `status ${r.status}`);
    } catch (e) {
      ok(`2. ${path} returns 200`, false, e instanceof Error ? e.message : String(e));
      continue;
    }
    const text = visibleText(html);
    const leaked = FORBIDDEN.filter(f => text.toLowerCase().includes(f.toLowerCase()));
    ok(`2b. ${path} discloses no hidden product`, leaked.length === 0, leaked.join(", "));
  }
  ok("2c. every public page was reachable", reachable === PUBLIC_PAGES.length, `${reachable}/${PUBLIC_PAGES.length}`);

  // ---- 3. nav and catalogue agree ------------------------------------------------------------------
  const home = await fetch(BASE + "/").then(r => r.text()).catch(() => "");
  for (const s of PRIMARY_SOLUTIONS) {
    ok(`3. homepage links to /${s.slug}`, home.includes(`/${s.slug}"`) || home.includes(`href="/${s.slug}`));
  }
  ok("3b. /quality is NOT in the primary solutions list",
    !PRIMARY_SOLUTIONS.some(s => s.slug === "quality") && SOLUTIONS.some(s => s.slug === "quality"));

  // ---- 4. authenticated workspaces are excluded from indexing --------------------------------------
  const robots = await fetch(BASE + "/robots.txt").then(r => r.ok ? r.text() : "").catch(() => "");
  ok("4. robots.txt is served", robots.length > 0);
  const mustBlock = ["/dashboard", "/healthcare-worker", "/supervisor", "/unit-manager", "/super-admin", "/verify"];
  const unblocked = mustBlock.filter(p => !robots.includes(`Disallow: ${p}`));
  ok("4b. every authenticated workspace is disallowed", unblocked.length === 0, unblocked.join(", "));
  ok("4c. the public pages are still allowed", /Allow:\s*\/$/m.test(robots) || robots.includes("Allow: /"));

  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exitCode = fails.length ? 1 : 0;
}

main().catch(e => { console.error("\nHARNESS ERROR:", e instanceof Error ? e.message : e); process.exitCode = 1; });
