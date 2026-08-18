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
