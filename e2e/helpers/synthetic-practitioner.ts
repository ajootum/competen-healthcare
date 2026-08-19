import { type Page, test } from "@playwright/test";

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
const PRODUCTION_REF = "rnnqhlrcgvsauigxwszl";

/**
 * ⚠ THIS FAILS, IT DOES NOT SKIP. Skipping is right for "the fixture was never provisioned" — a
 * documented gap. Pointing an authenticated test suite at production is not a gap, it is an accident in
 * progress: the synthetic practitioner does not exist there, so the sign-in would fail anyway, and the
 * standing instruction on this project is that authenticated smoke never connects to production
 * Supabase. A loud failure is the only correct outcome.
 */
export function assertNotProduction(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
  if (ref === PRODUCTION_REF) {
    throw new Error(
      `REFUSING TO RUN AUTHENTICATED SMOKE AGAINST PRODUCTION (${ref}).\n`
      + `  The app under test is configured for the production project, where no synthetic\n`
      + `  practitioner exists and none may be created.\n`
      + `  Start the dev server with "npm run dev:staging" so it points at the staging project,\n`
      + `  and run Playwright from that same shell.`,
    );
  }
  if (!ref) {
    throw new Error(
      "Cannot identify the Supabase project the app is configured for — NEXT_PUBLIC_SUPABASE_URL is "
      + "unset or malformed. Refusing rather than guessing, because the guess that matters is whether "
      + "this is production.",
    );
  }
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
export async function signInAsSyntheticPractitioner(page: Page): Promise<void> {
  const { email, password } = requireSyntheticPractitioner();
  await page.goto("/practice/sign-in");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(url => !url.pathname.startsWith("/practice/sign-in"), { timeout: 15_000 });
}
