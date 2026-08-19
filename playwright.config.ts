import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

/**
 * ⚠ WITHOUT THIS, A PROVISIONED FIXTURE STILL REPORTS AS "NOT PROVISIONED". scripts/
 * provision-staging-fixture.ts reads .env.local through loadEnvConfig, but Playwright does not load it
 * at all — so SMOKE_PRACTITIONER_EMAIL/PASSWORD placed there would create the account and then leave
 * requireSyntheticPractitioner() skipping every authenticated journey with a message saying no identity
 * exists. A green run reporting a documented gap that had already been closed is worse than a red one.
 *
 * With this, .env.local is the single place both halves read, and the secret stays out of shell history.
 * A real environment variable still wins: loadEnvConfig never overwrites a value already in process.env,
 * which is what CI relies on.
 */
loadEnvConfig(process.cwd());

// COMP-ENG-001A — the initial Playwright smoke framework.
//
// ⚠ MINIMAL ON PURPOSE (§5: "the minimum Playwright configuration and test structure necessary for
// the seven approved journeys"). One project (Chromium), no cross-browser matrix, no visual
// regression, no component testing — those are later, separately-approved expansions (§7 non-goal:
// "do not expand the smoke suite into comprehensive E2E coverage in this change").
//
// ⚠ NOT YET WIRED INTO CI. §6 Stage C: "Add a PR smoke job only after required test
// credentials/environment are safely provisioned." No synthetic automation practitioner identity
// exists in this database today (checked directly, read-only, 2026-08-18 — see
// e2e/README.md). Four of the seven journeys need one and are not runnable end-to-end until it
// exists. Wiring this into ci.yml before then would either leave a permanently-red required check or
// require weakening the gate to "allow failure," both worse than leaving it local-only and honest.
// ⚠ WORKERS PINNED TO 1, ALWAYS — NOT JUST IN CI. Confirmed by real local execution, 2026-08-18: with
// the default parallel workers, several tests hit different cold routes on the single `npm run dev`
// process at once, the on-demand compiler falls behind, and navigation exceeds the 30s test timeout —
// 3 of 3 credential-free journeys failed. Serial (`--workers=1`) against the same warm server: 3
// passed, 4 skipped, ~6s total. §5 requires "deterministic, independent, fast" — a suite that fails
// under its own default concurrency isn't deterministic, and this is a smoke suite, not a perf
// benchmark, so trading a few seconds of wall-clock for reliability is the right call.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  /**
   * ⚠ 30s (the default) IS LESS THAN THIS SUITE NEEDS. Signing in retries through a pre-hydration
   * native submit, and a dev-mode cold compile precedes it. The retry loop outran the default and the
   * page was closed underneath it, which surfaced as "Target page, context or browser has been closed"
   * — a message that describes the harness giving up, not the product.
   */
  // Budgeted against the sign-in retry loop: 3 attempts x (20s wait + settle) plus a cold first
  // compile. 60s was arithmetically too small for its own loop and produced a spurious red.
  timeout: 120_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    // Evidence on failure only (§5: "capture useful failure evidence such as trace/screenshot only
    // through normal Playwright test artifacts; do not expose secrets in logs").
    /**
     * ⚠ NO TRACE IN CI, AND THAT IS A SECURITY DECISION RATHER THAN A PERFORMANCE ONE. §4: "Do not
     * expose secrets in traces, screenshots, logs or diagnostic output." A Playwright trace records the
     * ARGUMENTS of every action, so fill(password) puts the synthetic practitioner secret into an
     * artifact that any workflow-run viewer can download. Screenshots are kept: a password input renders
     * as dots, so they leak nothing while still showing what the page looked like.
     */
    trace: process.env.CI ? "off" : "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  // ⚠ REUSES AN ALREADY-RUNNING DEV SERVER LOCALLY, ALWAYS STARTS FRESH IN CI. This mirrors the
  // reasoning already recorded for this repo's other CI jobs: a hermetic run is worth the extra
  // ~10-20s boot time the moment more than one person or process could be relying on a shared
  // server's state.
  // ⚠ 127.0.0.1, NOT `localhost`, ON PURPOSE. On Linux `localhost` can resolve to ::1 while `next dev`
  // is listening on IPv4, so the browser and the server end up on different stacks and every navigation
  // fails to connect — a failure mode that cannot reproduce on this Windows dev machine, which is
  // exactly why it reached CI. Pinning the literal address removes the resolver from the equation on
  // both platforms.
  /**
   * ⚠ THE SERVER MUST COME UP ON THE PORT THE SUITE IS WATCHING. `command: "npm run dev"` always binds
   * 3000, while `url` followed PLAYWRIGHT_BASE_URL — so pointing the suite at the staging port made
   * Playwright start a server on 3000 and then wait forever on 3100. Next 16 also refuses a second dev
   * server for the same directory, so the failure surfaced as "Another next dev server is already
   * running" rather than as a port mismatch.
   *
   * The port is derived from the base URL, so the two can no longer disagree. `npm run smoke:staging`
   * sets both the base URL and the staging environment, and this server inherits that environment —
   * which is what makes a one-command staging run possible.
   *
   * ⚠ reuseExistingServer means an ALREADY-RUNNING server wins. That is convenient and it is also how
   * a "staging" run can silently exercise a production-pointed server somebody left up, which is
   * exactly what the network-level guard in e2e/helpers/synthetic-practitioner.ts exists to catch.
   */
  webServer: {
    /**
     * ⚠ OVERRIDABLE, BECAUSE next dev CANNOT SERVE THE AUTHENTICATED JOURNEYS. A Next runtime chunk is
     * refused to the browser under next dev (403 to the browser, 200 to curl) and React never hydrates,
     * so the sign-in form is inert markup. The authenticated CI job therefore builds and runs the real
     * server, and sets this variable to do it.
     */
    command: process.env.PLAYWRIGHT_WEB_SERVER_CMD
      ?? `npm run dev -- -p ${new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000").port || "3000"}`,
    url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    // Turbopack cold-compiles the first routes on demand; 60s was tight enough to fail on a cold start.
    timeout: 120_000,
  },
});
