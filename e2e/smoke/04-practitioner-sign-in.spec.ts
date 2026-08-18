import { test, expect } from "@playwright/test";
import { signInAsSyntheticPractitioner } from "../helpers/synthetic-practitioner";

// COMP-ENG-001A journey 3 — a Practice practitioner can sign in with email + password.
//
// ⚠ SKIPS unless SMOKE_PRACTITIONER_EMAIL / SMOKE_PRACTITIONER_PASSWORD are set to a real synthetic
// automation identity. None exists in this database as of 2026-08-18 (checked read-only) — see
// e2e/README.md. This is not a placeholder to fill in later with a shortcut; it needs a real
// provisioned account, because signInWithPassword is the same Supabase auth every workspace uses.

test("a practitioner signs in and leaves the sign-in page", async ({ page }) => {
  await signInAsSyntheticPractitioner(page);
  await expect(page).not.toHaveURL(/\/practice\/sign-in/);
});
