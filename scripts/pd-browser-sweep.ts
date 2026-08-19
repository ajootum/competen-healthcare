/**
 * CPR-PD-013 §9/§13 — the browser pass over every Product Director screen.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THIS EXISTS BECAUSE STATIC READING CANNOT CLOSE THE REMAINING UNKNOWN. The §9 reconciliation
 * measured guards, loaders and write surfaces across all 86 destinations and read four modules against
 * their specs — and 81 of those screens had still never been RENDERED. Every acceptance criterion that
 * needs a running system (responsive states, collapsed sidebar, a page that throws at runtime, a loader
 * that returns null against a real database) was unexercised.
 *
 * ⚠ IT SIGNS IN AS THE SYNTHETIC HQ OPERATOR ON STAGING, and refuses any other target. The credential
 * comes from the environment and is never printed. Production is blocked before dispatch, not merely
 * checked — the same control the smoke suite uses.
 *
 * WHAT IT ASSERTS PER SCREEN, and why each is a real failure rather than a smell:
 *   LANDED     a redirect means the capability guard refused a screen the sidebar offers.
 *   HEADING    no <h1>/<h2> means the page rendered its shell and nothing else.
 *   ERRORS     a console error or a failed request is a runtime fault a reader would meet.
 *   UNREADABLE the page's own "could not be read" vocabulary — reported, NOT failed: on a synthetic
 *              practice with little data it is frequently the correct answer, and the honesty rules
 *              exist to make it sayable. It is counted so a SPIKE is visible.
 *
 *   npx tsx scripts/pd-browser-sweep.ts            all 86, desktop
 *   npx tsx scripts/pd-browser-sweep.ts --responsive   adds tablet + mobile over a sample
 */
import { loadEnvConfig } from "@next/env";
import { chromium, type Page } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { judgeTarget } from "./production-guard";

loadEnvConfig(process.cwd());

const BASE = process.env.PD_SWEEP_BASE_URL ?? "http://127.0.0.1:3100";
const EMAIL = "hq.operator@staging.competen.invalid";
const OUT = join(process.cwd(), "..", "pd-sweep");
const RESPONSIVE = process.argv.includes("--responsive");

/** Every destination the PD sidebar offers, read from the nav rather than typed here. */
function navRoutes(): string[] {
  const nav = readFileSync("src/app/super-admin/_components/pd-nav.ts", "utf8");
  return [...new Set([...nav.matchAll(/"(\/super-admin\/[^"]*)"/g)].map(m => m[1]))].sort();
}

type Result = {
  route: string; landed: string; ok: boolean;
  heading: string; consoleErrors: string[]; failedRequests: string[];
  unreadable: number; horizontalScroll: boolean;
};

async function visit(page: Page, route: string): Promise<Result> {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const onConsole = (m: { type: () => string; text: () => string }) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // The report-only CSP notice is emitted by the platform on every page and is not this screen's fault.
    if (/upgrade-insecure-requests|Content Security Policy/i.test(t)) return;
    consoleErrors.push(t.slice(0, 160));
  };
  const onResponse = (r: { status: () => number; url: () => string }) => {
    if (r.status() >= 500) failedRequests.push(`${r.status()} ${r.url().replace(BASE, "")}`);
  };
  page.on("console", onConsole);
  page.on("response", onResponse);

  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" }).catch(() => null);
  await page.waitForSelector("h1, h2", { timeout: 20_000 }).catch(() => null);
  await page.waitForTimeout(700);

  const landed = new URL(page.url()).pathname;
  const heading = (await page.locator("h1, h2").first().textContent().catch(() => null))?.trim() ?? "";
  const unreadable = await page.getByText(/could not be read|not known|unavailable/i).count().catch(() => 0);
  // s12: "supported breakpoints without horizontal loss of critical controls".
  const horizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2).catch(() => false);

  page.off("console", onConsole);
  page.off("response", onResponse);
  return {
    route, landed, heading, consoleErrors, failedRequests, unreadable, horizontalScroll,
    ok: landed === route && heading.length > 0 && consoleErrors.length === 0 && failedRequests.length === 0,
  };
}

async function main() {
  const verdict = judgeTarget(process.env.STAGING_SUPABASE_URL);
  if (!verdict.ok) {
    console.error(`\nrefusing: STAGING_SUPABASE_URL ${verdict.reason === "PRODUCTION" ? "points at PRODUCTION" : "does not identify a project"}\n`);
    process.exit(1);
  }
  const password = process.env.HQ_FIXTURE_PASSWORD;
  if (!password) { console.error("\nHQ_FIXTURE_PASSWORD is not set (see scripts/provision-staging-hq-fixture.ts).\n"); process.exit(1); }

  const routes = navRoutes();
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  const { blockProductionTraffic } = await import("../e2e/helpers/synthetic-practitioner");
  const guard = await blockProductionTraffic(page);

  console.log(`\nsigning in as ${EMAIL} at ${BASE}`);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: /email/i }).fill(EMAIL);
  await page.locator("input#password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  // The neutral sign-in resolves to a chooser when an identity holds more than one destination.
  const platform = page.getByRole("link", { name: /Competen Platform/i }).first();
  await platform.waitFor({ timeout: 15_000 }).catch(() => null);
  if (await platform.count()) await platform.click();
  try {
    await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 30_000 });
  } catch {
    if (guard.violation()) console.error(`refused: reached PRODUCTION (${guard.violation()})`);
    else console.error("sign-in did not complete");
    await browser.close(); process.exit(1);
  }
  console.log(`signed in, landed on ${new URL(page.url()).pathname}`);
  console.log(`sweeping ${routes.length} PD destinations\n`);

  const results: Result[] = [];
  for (const r of routes) {
    const res = await visit(page, r);
    results.push(res);
    const mark = res.ok ? "ok  " : "FAIL";
    const notes = [
      res.landed !== r ? `redirected to ${res.landed}` : "",
      !res.heading ? "no heading" : "",
      res.consoleErrors.length ? `${res.consoleErrors.length} console error(s)` : "",
      res.failedRequests.length ? `${res.failedRequests.length} 5xx` : "",
      res.horizontalScroll ? "horizontal scroll" : "",
    ].filter(Boolean).join("; ");
    console.log(`  ${mark} ${r.replace("/super-admin/", "").padEnd(40)} ${notes || res.heading.slice(0, 42)}`);
  }

  const failed = results.filter(r => !r.ok);
  const scrollers = results.filter(r => r.horizontalScroll);
  console.log(`\n──────── ${results.length - failed.length}/${results.length} rendered clean ────────`);
  if (failed.length) {
    console.log(`\nFAILURES (${failed.length}):`);
    for (const f of failed) {
      console.log(`  ${f.route}`);
      if (f.landed !== f.route) console.log(`     redirected to ${f.landed}`);
      if (!f.heading) console.log(`     rendered no heading`);
      for (const e of f.consoleErrors.slice(0, 3)) console.log(`     console: ${e}`);
      for (const q of f.failedRequests.slice(0, 3)) console.log(`     request: ${q}`);
    }
  }
  if (scrollers.length) console.log(`\nHORIZONTAL SCROLL at 1440 (${scrollers.length}): ${scrollers.map(s => s.route).join(", ")}`);

  // §12's breakpoints, over a sample rather than all 86 — the layout is one shell.
  if (RESPONSIVE) {
    const sample = ["/super-admin/pd", "/super-admin/pd/operations", "/super-admin/pd/practices",
      "/super-admin/pd/releases", "/super-admin/pd/health", "/super-admin/platform-ops/practice"];
    for (const [label, w, h] of [["tablet", 1024, 900], ["mobile", 390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h });
      console.log(`\n── ${label} (${w}px) ──`);
      for (const r of sample) {
        const res = await visit(page, r);
        console.log(`  ${res.horizontalScroll ? "SCROLL" : "ok    "} ${r.replace("/super-admin/", "")}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }

  writeFileSync(join(OUT, "sweep.json"), JSON.stringify(results, null, 2));
  await browser.close();
  console.log(`\nfull result written to ${join(OUT, "sweep.json")}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });
