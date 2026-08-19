import { type Page, test } from "@playwright/test";
import { PRODUCTION_REF, isProductionUrl, judgeTarget } from "../../scripts/production-guard";

// COMP-ENG-001A §4 — the synthetic automation practitioner identity.
//
// ⚠ NO VALUE EVER LIVES IN THIS REPOSITORY. Both env vars are read here and nowhere else is a
// credential referenced. §4: "Document required environment-variable names and setup requirements
// without committing their values." See e2e/README.md for what the account needs to satisfy before
// these tests can run for real.
//
// ⚠ AS OF 2026-08-18, NEITHER VARIABLE IS SET, AND NO SUCH ACCOUNT EXISTS IN THE DATABASE (checked
// directly, read-only — see e2e/README.md). Every test that calls `requireSyntheticPractitioner()`
// SKIPS with a clear reason rather than failing, so this suite tells the truth about its own
// readiness instead of reporting red for a prerequisite nobody has provisioned yet.
/**
 * COMP-ENG-002G §4: "The authenticated smoke job must include an environment/project identity guard so
 * it cannot accidentally target production."
 *
 * ⚠ NOT A SECRET. A Supabase project ref is shipped to every browser inside NEXT_PUBLIC_SUPABASE_URL;
 * it is an address, not a credential. It is written down here so the guard has something to compare
 * against that cannot itself be misconfigured — deriving "which project is production" from the same
 * environment the test is trying to validate would be circular.
 */
// PRODUCTION_REF now lives in scripts/production-guard.ts, so the negative test in
// scripts/production-guard-harness.ts exercises the SAME predicate this suite uses rather than a copy.

/**
 * ⚠ THIS FAILS, IT DOES NOT SKIP. Skipping is right for "the fixture was never provisioned" — a
 * documented gap. Pointing an authenticated test suite at production is not a gap, it is an accident in
 * progress: the synthetic practitioner does not exist there, so the sign-in would fail anyway, and the
 * standing instruction on this project is that authenticated smoke never connects to production
 * Supabase. A loud failure is the only correct outcome.
 */
export function assertNotProduction(): void {
  // The verdict comes from the shared predicate, so scripts/production-guard-harness.ts proves THIS
  // path rather than a second implementation that happens to look similar.
  const verdict = judgeTarget(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (verdict.ok) return;
  if (verdict.reason === "PRODUCTION") {
    throw new Error(
      `REFUSING TO RUN AUTHENTICATED SMOKE AGAINST PRODUCTION (${verdict.ref}).\n`
      + `  The app under test is configured for the production project, where no synthetic\n`
      + `  practitioner exists and none may be created.\n`
      + `  Start the dev server with "npm run dev:staging" so it points at the staging project,\n`
      + `  and run Playwright from that same shell.`,
    );
  }
  throw new Error(
    "Cannot identify the Supabase project the app is configured for — NEXT_PUBLIC_SUPABASE_URL is "
    + "unset or malformed. Refusing rather than guessing, because the guess that matters is whether "
    + "this is production.",
  );
}

export function syntheticPractitionerCredentials(): { email: string; password: string } | null {
  const email = process.env.SMOKE_PRACTITIONER_EMAIL;
  const password = process.env.SMOKE_PRACTITIONER_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

/**
 * Call at the top of any test that needs an authenticated session. Skips (not fails) when the
 * synthetic identity isn't configured, and returns the credentials otherwise — so a test body never
 * has to repeat the null-check.
 */
export function requireSyntheticPractitioner(): { email: string; password: string } {
  // Order matters: refuse production BEFORE deciding whether to skip. A production-pointed run with no
  // credentials set would otherwise skip quietly and never surface the misconfiguration at all.
  assertNotProduction();
  const creds = syntheticPractitionerCredentials();
  /**
   * ⚠ IN CI, MISSING CREDENTIALS FAIL — THEY DO NOT SKIP. COMP-ENG-002G §6: "After activation, missing
   * required smoke credentials must fail closed rather than silently skip the journeys."
   *
   * Skipping is honest LOCALLY, where a developer may simply not have provisioned a fixture. In CI it
   * is the opposite of honest: a required check that goes green because it quietly ran nothing is worse
   * than no check, and it would stay green through the exact regression it exists to catch — a rotated
   * secret, a renamed variable, a job that stopped passing its env through.
   */
  if (creds === null && process.env.CI) {
    throw new Error(
      "SMOKE_PRACTITIONER_EMAIL / SMOKE_PRACTITIONER_PASSWORD are not set in CI.\n"
      + "  This job is a blocking gate for the authenticated journeys, so absent credentials are a\n"
      + "  FAILURE, not a skip — a required check that passes by running nothing proves nothing.\n"
      + "  Set them as repository secrets on the STAGING project only.",
    );
  }
  test.skip(
    creds === null,
    "SMOKE_PRACTITIONER_EMAIL / SMOKE_PRACTITIONER_PASSWORD are not set, or no synthetic automation "
    + "practitioner identity has been provisioned yet. See e2e/README.md — this is a documented, "
    + "expected gap (COMP-ENG-001A §6/§10), not a failure.",
  );
  return creds!;
}

/**
 * Drives the real sign-in form at /practice/sign-in (confirmed live: email+password via Supabase
 * signInWithPassword — src/app/practice/sign-in/SignInForm.tsx). Returns once the app has navigated
 * away from the sign-in page, which is the observable signal a login succeeded.
 */
/**
 * Block any request to the production Supabase project, at the network layer, before it is sent.
 *
 * ⚠ THE ENV GUARD ALONE IS NOT ENOUGH, and finding out why was instructive. assertNotProduction()
 * reads the TEST PROCESS's environment. The app under test is a separate server with its own
 * environment, and on 2026-08-19 the two disagreed: staging fell back to port 3001 because the
 * ordinary production-facing dev server held 3000, while the suite still pointed at 3000. Every check
 * would have passed while the browser signed in to production.
 *
 * Playwright intercepts before dispatch, so an aborted request never leaves the machine — the password
 * is not sent and then regretted, it is not sent. That is the difference between a check and a control.
 */
export async function blockProductionTraffic(page: Page): Promise<{ violation: () => string | null }> {
  let hit: string | null = null;
  /**
   * ⚠ TWO WAYS THIS SILENTLY DID NOTHING, BOTH FOUND BY BREAK-TESTING IT.
   *
   * 1. `page.route()` RETURNS A PROMISE, and the first version discarded it with `void`. The
   *    interceptor was not guaranteed to be registered before the page navigated, so requests went out
   *    unblocked while `violation()` still read clean. A control that reports "no violation" because it
   *    was never installed is worse than no control: it produces a green result as evidence.
   *
   * 2. A GLOB DOES NOT MATCH A HOST. `**\/*.supabase.co/**` looks correct and matches nothing —
   *    Playwright's glob is path-oriented, and the project id lives in the HOST here. A RegExp against
   *    the whole URL is the only reliable form.
   */
  await page.route(/^https:\/\/[a-z0-9]+\.supabase\.co\//, async route => {
    const requestUrl = route.request().url();
    if (isProductionUrl(requestUrl)) {
      hit ??= new URL(requestUrl).host;
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  return { violation: () => hit };
}

export async function signInAsSyntheticPractitioner(page: Page): Promise<void> {
  const { email, password } = requireSyntheticPractitioner();
  const guard = await blockProductionTraffic(page);
  await page.goto("/practice/sign-in");
  const early = guard.violation();
  if (early) {
    throw new Error(
      `The app under test talks to PRODUCTION (${early}). The request was blocked before it was sent,\n`
      + `  so no credential left this machine — but the server on ${process.env.PLAYWRIGHT_BASE_URL ?? "the base URL"}\n`
      + `  is not the staging one. Start it with "npm run dev:staging" (port 3100) and re-run.`,
    );
  }
  /**
   * ⚠ NO waitForLoadState("networkidle") HERE. It was added while chasing a hydration failure and is
   * actively harmful on a real app: this page opens a long-lived connection to Supabase, so the network
   * never goes idle and the wait consumes the entire per-test budget. Measured: every authenticated
   * journey burned its full 60s and failed, on a build where sign-in demonstrably works.
   *
   * Hydration is handled by the retry loop below instead, which watches for the EFFECT rather than
   * guessing at readiness.
   */
  /**
   * ⚠ networkidle IS NOT A HYDRATION SIGNAL, and believing it was cost a diagnosis. React attaches its
   * fiber and props to the DOM node when it hydrates, so their presence on the <form> is the actual
   * fact we need — not a proxy for it.
   *
   * Without this the click lands on un-hydrated markup and the browser performs the DEFAULT form
   * submission. Measured on 2026-08-19: the URL became "/practice/sign-in?" — the bare "?" is the
   * signature of a native GET submit — the button still read "Sign in" rather than "Signing in…", and
   * no Supabase request was made at all. The test then failed on a navigation timeout that described
   * none of that.
   */
  /**
   * ⚠ NO FORM AND UN-HYDRATED FORM ARE DIFFERENT FAULTS, and one wait cannot describe both. On a clean
   * staging build /practice/sign-in renders NO form at all, because SignInForm is gated on the
   * practice_sign_in launch flag — measured 2026-08-19, four journeys timed out on a hydration wait
   * that said nothing about a missing flag. The two are separated so the message names the real cause.
   */
  if (await page.locator("form").count() === 0) {
    throw new Error(
      `/practice/sign-in rendered NO form. SignInForm is gated on the practice_sign_in launch flag,\n`
      + `  which is off by default on a clean build. Run "npx tsx scripts/provision-staging-fixture.ts",\n`
      + `  which enables it on the staging project (and never touches practice_public_signup).`,
    );
  }
  /**
   * ⚠ HYDRATION IS DETECTED BEHAVIOURALLY, BECAUSE REACT 19 EXPOSES NO MARKER TO DETECT IT WITH. The
   * previous version waited for `__reactFiber$`/`__reactProps$` on the form node. Measured on this
   * stack: the form carries NO non-standard own properties at all, so that wait could only ever time
   * out. React 18's internals are not React 19's, and a check written from memory of the older one is
   * a check that always fails.
   *
   * So the effect is what is waited on, not the mechanism. Before hydration the click performs a native
   * GET submit and we stay on /practice/sign-in; after it, the handler runs and navigates.
   *
   * ⚠ A REJECTED CREDENTIAL IS NOT RETRIED. The form shows "Sign-in failed" for bad credentials, and
   * retrying that would turn a real authentication failure into a slow timeout with a misleading
   * message — exactly the kind of assertion-weakening §5 forbids.
   */
  const emailBox = page.getByLabel(/email/i);
  const passwordBox = page.getByLabel(/password/i);
  const submitBtn = page.getByRole("button", { name: /sign in/i });
  // Three attempts fit the 120s budget with room for a cold compile: 3 x (20s wait + settle).
  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    /**
     * ⚠ A SETTLE BEFORE TYPING, MEASURED NOT GUESSED. Clicking the instant the button is actionable
     * lands on un-hydrated markup and performs a native GET submit, which RELOADS the page - so every
     * retry meets a freshly un-hydrated page and the loop can never converge. A manual probe that
     * paused ~2.5s before typing signed in first time, so that is the pause.
     */
    await page.waitForTimeout(attempt === 1 ? 2_500 : 1_500);
    await emailBox.fill(email);
    await passwordBox.fill(password);
    await submitBtn.click();
    try {
      /**
       * ⚠ waitUntil: "commit", NOT THE DEFAULT "load". The question this wait asks is "did we leave the
       * sign-in page", and a committed navigation answers it. The default waits for the whole document
       * to finish loading, and the Practice shell compiles on demand in dev mode and can exceed the
       * budget — so a SUCCESSFUL sign-in timed out here, and the loop then retried against a page that
       * had already navigated. Every test still waits for the specific content it asserts on.
       */
      await page.waitForURL(u => !u.pathname.startsWith("/practice/sign-in"), { timeout: 20_000, waitUntil: "commit" });
      return;
    } catch (err) {
      /**
       * ⚠ CHECK WHETHER WE ALREADY LEFT BEFORE RETRYING. The shell that follows a successful sign-in is
       * server-rendered and can take longer to arrive than the wait allows. When that happened the loop
       * retried on a page that had ALREADY signed in, and sat waiting for an email field that no longer
       * existed until the test timed out — reporting "locator.fill timed out" for a sign-in that had
       * actually worked. Re-reading the URL first turns that into the success it is.
       */
      if (!new URL(page.url()).pathname.startsWith("/practice/sign-in")) return;
      const violation = guard.violation();
      if (violation) {
        throw new Error(
          `Sign-in attempted to reach PRODUCTION (${violation}). It was BLOCKED before dispatch, so the\n`
          + `  password was never transmitted — but the server under test is not the staging one.`,
        );
      }
      if (await page.getByText(/sign-in failed/i).count() > 0) {
        throw new Error(
          `The application rejected the credentials. The account exists (the provisioner verified it),\n`
          + `  so SMOKE_PRACTITIONER_PASSWORD does not match what the fixture was created with.\n`
          + `  Re-run scripts/provision-staging-fixture.ts with the value you intend to use — it resets\n`
          + `  the password on every run.`,
        );
      }
      if (attempt === ATTEMPTS) throw err;
      // Pre-hydration native submit: the page is still on sign-in, no handler ran. Let it hydrate.
      await page.waitForTimeout(1_500);
    }
  }
}
