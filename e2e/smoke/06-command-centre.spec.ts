import { test, expect } from "@playwright/test";
import { signInAsSyntheticPractitioner } from "../helpers/synthetic-practitioner";

// COMP-ENG-001A journey 5 — the Practice Command Centre renders for a signed-in practitioner.
// Confirmed live at src/app/practice/(shell)/home/page.tsx (PracticeCommandCentre), heading
// "Practice Command Centre" at line 272.
//
// ⚠ SKIPS without a provisioned synthetic identity — see e2e/README.md.

test("command centre renders after sign-in", async ({ page }) => {
  await signInAsSyntheticPractitioner(page);
  await page.goto("/practice/home");
  await expect(page.getByRole("heading", { name: "Practice Command Centre" })).toBeVisible();
});
