/**
 * CPR-PD-014 §14 delivery evidence — screenshots of the four Product Operations screens.
 *
 * §14: "Screenshots of the four optimised screens in healthy and exception states."
 *
 * !! IT SIGNS IN THROUGH PLAYWRIGHT, NOT BY HAND, AND THAT IS DELIBERATE. The credential travels from
 * .env.local into the browser without passing through a person or a chat log, which is the same route
 * e2e/helpers/synthetic-practitioner.ts already uses for the smoke suite. Nothing here prints it.
 *
 * !! STAGING ONLY, AND THE PRODUCTION PREDICATE SAYS SO. Screenshots of production would put real
 * practice and practitioner names into a delivery document. Staging is also the better evidence: it
 * holds a practice stalled at 0/6 and a deliberately retried provisioning run, so the EXCEPTION half of
 * §14 is real rather than staged.
 *
 * SETUP:
 *   .env.local: STAGING_SUPABASE_URL, STAGING_ANON_KEY, STAGING_SERVICE_ROLE_KEY, HQ_FIXTURE_PASSWORD
 *   shell 1:    npm run dev:staging          (port 3100)
 *   shell 2:    npx tsx scripts/capture-pd014-evidence.ts
 */
import { loadEnvConfig } from "@next/env";
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { judgeTarget } from "./production-guard";

loadEnvConfig(process.cwd());

const BASE = process.env.PD014_BASE_URL ?? "http://127.0.0.1:3100";
const EMAIL = "hq.operator@staging.competen.invalid";
const PASSWORD = process.env.HQ_FIXTURE_PASSWORD ?? "";
const OUT = join(process.cwd(), "docs", "evidence", "cpr-pd-014");

const SCREENS: { slug: string; path: string; title: string }[] = [
  { slug: "01-operations-overview", path: "/super-admin/pd/operations", title: "Operations Overview (unchanged, §11 step 5)" },
  { slug: "02-provisioning-onboarding", path: "/super-admin/pd/operations/provisioning", title: "Provisioning & Onboarding (§4)" },
  { slug: "03-practice-workspaces", path: "/super-admin/pd/operations/workspaces", title: "Practice Workspaces (§5)" },
  { slug: "04-launch-readiness", path: "/super-admin/pd/operations/launch-readiness", title: "Launch Readiness (§6)" },
  { slug: "05-technical-operations", path: "/super-admin/platform-ops/practice", title: "Technical Operations (§7)" },
];

async function main() {
  // The staging environment must be the one the server is serving, and it must not be production.
  const verdict = judgeTarget(process.env.STAGING_SUPABASE_URL);
  if (!verdict.ok) {
    console.error(`\nrefusing: STAGING_SUPABASE_URL ${verdict.reason === "PRODUCTION" ? "points at PRODUCTION" : "does not identify a project"}\n`);
    process.exit(1);
  }
  if (!PASSWORD) {
    console.error("\nHQ_FIXTURE_PASSWORD is not set. It is the synthetic HQ operator's password, in .env.local.\n");
    process.exit(1);
  }

  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  // A desktop viewport: §12 asks for "supported desktop/tablet breakpoints without horizontal loss of
  // critical controls", and these screens are operator surfaces rather than phone ones.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  /**
   * !! A REQUEST TO THE PRODUCTION PROJECT IS BLOCKED BEFORE IT LEAVES, not merely checked. The same
   * control the smoke suite uses: if the server under test turned out to be production-pointed, the
   * credential would not be transmitted.
   */
  const { blockProductionTraffic } = await import("../e2e/helpers/synthetic-practitioner");
  const guard = await blockProductionTraffic(page);

  console.log(`\nsigning in as ${EMAIL} at ${BASE}`);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  // !! ROLE-SCOPED, NOT getByLabel. /login carries a "Show password" BUTTON whose aria-label also
  // matches /password/i, so the label query resolves to two elements and fills neither. Naming the role
  // says which of them is the field.
  await page.getByRole("textbox", { name: /email/i }).fill(EMAIL);
  await page.locator("input#password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  try {
    await page.waitForURL(u => !u.pathname.startsWith("/login"), { timeout: 30_000, waitUntil: "commit" });
  } catch (e) {
    if (guard.violation()) {
      console.error(`\nrefused: the app under test reached PRODUCTION (${guard.violation()}). Blocked before dispatch.\n`);
      process.exit(1);
    }
    const shown = await page.getByText(/sign-in failed|invalid/i).count();
    console.error(`\nsign-in did not complete${shown ? " - the form reported a failure, so the password does not match the fixture" : ""}.\n`);
    await browser.close();
    process.exit(1);
  }
  console.log(`signed in, landed on ${new URL(page.url()).pathname}\n`);

  /**
   * !! IT ASSERTS THE PAGE IT LANDED ON, AND THE FIRST VERSION DID NOT. That version counted files and
   * reported "5 screenshot(s) written" while every one of them was the same redirect page -- the
   * account held its HQ appointment but no platform membership, so /super-admin bounced it to
   * /practice/no-account. Five identical pictures of a refusal, announced as evidence.
   *
   * A capture tool that cannot tell a screen from a redirect produces the most confident kind of wrong
   * artefact, so the landing path is compared against the requested one and a mismatch is a failure.
   */
  let captured = 0;
  let wrong = 0;
  for (const s of SCREENS) {
    await page.goto(`${BASE}${s.path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("h1, h2", { timeout: 30_000 }).catch(() => null);
    await page.waitForTimeout(1200);

    const landed = new URL(page.url()).pathname;
    const heading = (await page.locator("h1").first().textContent().catch(() => null))?.trim() ?? "(no h1)";
    if (landed !== s.path) {
      console.log(`  MISS ${s.slug.padEnd(28)} redirected to ${landed} - "${heading.slice(0, 44)}"`);
      wrong++;
      continue;
    }
    /**
     * !! NOT fullPage, AND THE FIRST VERSION WAS. Chromium composites a `position: fixed` element
     * against beyond-viewport content differently in a fullPage capture, so the PD sidebar landed on
     * top of the page it sits beside: three of five images read "ovisioning & Onboarding" with the
     * first 30px of every line behind the nav. That is an artefact of the capture, not the product --
     * measured live, the h1 starts at x=264 and the sidebar ends at x=240 on exactly those pages.
     *
     * An evidence screenshot that invents a layout defect is worse than no screenshot, because the
     * reader has no way to tell it from a real one. Growing the viewport to the document instead means
     * nothing is ever beyond it, so there is no compositing to get wrong.
     */
    const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    if (docHeight > 1000) {
      await page.setViewportSize({ width: 1440, height: Math.min(docHeight, 6000) });
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: join(OUT, `${s.slug}.png`) });
    await page.setViewportSize({ width: 1440, height: 1000 });
    console.log(`  ok   ${s.slug.padEnd(28)} ${heading.slice(0, 44)}`);
    captured++;
  }

  await browser.close();
  if (wrong > 0) {
    console.error(`\n${wrong} screen(s) redirected away and were NOT captured. `
      + `An HQ capability alone does not open /super-admin: admitToEstate runs first, so the account `
      + `also needs an active platform_membership row.\n`);
    process.exit(1);
  }
  console.log(`\n${captured} screenshot(s) written to docs/evidence/cpr-pd-014/`);
  console.log("Staging data only - no production practice or practitioner appears in them.\n");
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });
