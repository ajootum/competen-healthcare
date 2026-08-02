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
import { JOURNEYS } from "../src/lib/marketing/practice-site";
import { SITE_URL, abs, indexablePages } from "../src/lib/marketing/site";

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
  ...JOURNEYS.map(j => j.href),
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

/**
 * The text a search engine or a chat app shows for a page: its <title>, its meta description, and the
 * Open Graph and Twitter title/description tags. All of it is attribute content, which is precisely why
 * visibleText() above cannot see any of it.
 */
function metadataText(html: string): string {
  const parts: string[] = [];
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title) parts.push(title[1]);
  const metaRe = /<meta\s+[^>]*>/gi;
  for (const tag of html.match(metaRe) ?? []) {
    if (!/(name|property)=["'](description|og:title|og:description|og:site_name|og:image:alt|twitter:title|twitter:description)["']/i.test(tag)) continue;
    const content = /content=["']([^"']*)["']/i.exec(tag);
    if (content) parts.push(content[1]);
  }
  return parts.join(" | ")
    .replace(/&amp;/gi, "&").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
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

    // THE METADATA SURFACE, which this harness used to miss entirely.
    //
    // visibleText() strips tags, and meta content lives in an ATTRIBUTE -- so the title, the description
    // and the social tags were never scanned. That is not a small blind spot: the meta description is the
    // sentence a search engine prints under the result, which reaches more people than the page does. The
    // root layout's default description named "competency management" for months and every run of this
    // harness passed, because the one place the rule was broken was the one place nothing looked.
    const meta = metadataText(html);
    const metaLeaked = FORBIDDEN.filter(f => meta.toLowerCase().includes(f.toLowerCase()));
    ok(`2d. ${path} discloses no hidden product in its metadata`, metaLeaked.length === 0, metaLeaked.join(", "));

    // CANONICAL MUST BE THE PAGE'S OWN URL. A canonical set once in the root layout is inherited by every
    // page, so each one declares itself a copy of the homepage and asks search engines not to index it --
    // silently cancelling out the sitemap two sections below. Both states look identical on the page.
    const canonical = /<link[^>]+rel=["']canonical["'][^>]*>/i.exec(html);
    const href = canonical ? /href=["']([^"']+)["']/i.exec(canonical[0])?.[1] : undefined;
    ok(`2e. ${path} canonicalises to itself`, href === abs(path) || (path === "/" && href === SITE_URL),
      href ? `points at ${href}` : "no canonical");

    // OPEN GRAPH MUST BE THE PAGE'S OWN. Next merges `openGraph` as a block: a page that sets only title
    // and description keeps the ROOT og:title, so it reads correctly in a search result and unfurls in a
    // chat app as the generic site card. Comparing og:title against <title> catches exactly that.
    // NO NUMERIC ADOPTION CLAIMS. The homepage carried "100+ Healthcare Organisations" and "10,000+
    // Healthcare Professionals" -- figures no query produced and nothing labelled as measured, on a
    // platform that has not launched. They were removed at the owner's instruction.
    //
    // This is asserted rather than trusted because it is the single most tempting thing to put back. The
    // moment there are three real customers, "10,000+ professionals" reads like rounding rather than
    // invention, and it goes in during a copy edit that nobody reviews as a factual claim.
    const adoption = [...text.matchAll(
      /(\d[\d,.]*\s*(?:\+|k\b|m\b|million|thousand))\s*(?:happy\s+|active\s+|healthcare\s+|verified\s+)*(organisations?|organizations?|professionals?|practices?|clinicians?|hospitals?|patients?|users?|clinics?)/gi,
    )].map(m => m[0].trim());
    ok(`2g. ${path} makes no numeric adoption claim`, adoption.length === 0, adoption.join(", "));

    const ogTitle = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1];
    const docTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
    const stem = docTitle.replace(/\s*·\s*Competen\s*$/, "").trim();
    ok(`2f. ${path} has its own og:title`, !!ogTitle && !!stem && ogTitle.trim() === stem,
      `og:title "${ogTitle}" vs title "${stem}"`);
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

  // ---- 5. the sitemap: complete, and no wider than the public surface ------------------------------
  //
  // A sitemap is a positive claim -- "these pages exist and I want them found". The two ways it goes wrong
  // are opposite and both silent: a new page never gets listed, or a page that should never be indexed is
  // handed to a crawler on a plate. Generating it from the route catalogues fixes the first; this checks
  // the second, and checks the first held.
  const xml = await fetch(BASE + "/sitemap.xml").then(r => r.ok ? r.text() : "").catch(() => "");
  ok("5. sitemap.xml is served", xml.length > 0);

  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  ok("5b. the sitemap has entries", urls.length > 0, `${urls.length} url(s)`);

  const missing = indexablePages().filter(p => !urls.some(u => u.endsWith(p.path) || u === abs(p.path)));
  ok("5c. every indexable page is listed", missing.length === 0, missing.map(p => p.path).join(", "));

  // /verify is unauthenticated and reachable, so it would not be caught by a "does it need login" check --
  // but its token IS the access control, and an indexed share link puts a named clinician's competency
  // record into search results.
  const mustNotList = [...mustBlock, "/forgot-password", "/reset-password"];
  const overListed = mustNotList.filter(p => urls.some(u => new URL(u).pathname.startsWith(p)));
  ok("5d. the sitemap lists nothing that robots.txt disallows", overListed.length === 0, overListed.join(", "));

  ok("5e. every sitemap URL is absolute and on one origin",
    urls.length > 0 && urls.every(u => u.startsWith(SITE_URL + "/") || u === SITE_URL + "/"),
    urls.filter(u => !u.startsWith(SITE_URL)).slice(0, 3).join(", "));

  ok("5f. robots.txt points at the sitemap", /Sitemap:\s*\S*\/sitemap\.xml/i.test(robots));

  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exitCode = fails.length ? 1 : 0;
}

main().catch(e => { console.error("\nHARNESS ERROR:", e instanceof Error ? e.message : e); process.exitCode = 1; });
