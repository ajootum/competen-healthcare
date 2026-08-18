import { test, expect } from "@playwright/test";
import { signInAsSyntheticPractitioner } from "../helpers/synthetic-practitioner";

// COMP-ENG-001A journey 6 — the Practice Planner renders for a signed-in practitioner.
//
// ⚠ ROUTE/LABEL DIVERGENCE, CONFIRMED DELIBERATE (CPR-V5-005, src/app/practice/(shell)/calendar/
// planner-ui.ts header comment): the nav label changed from "Calendar" to "Practice Planner", but the
// URL stayed /practice/calendar — "a URL rename is churn." This test asserts the real route, not the
// route the label alone would suggest.
//
// ⚠ SKIPS without a provisioned synthetic identity — see e2e/README.md.

test("practice planner renders after sign-in", async ({ page }) => {
  await signInAsSyntheticPractitioner(page);
  await page.goto("/practice/calendar");
  await expect(page.getByRole("heading", { name: "Practice Planner" })).toBeVisible();
});
