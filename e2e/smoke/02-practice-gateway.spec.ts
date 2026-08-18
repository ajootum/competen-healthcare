import { test, expect } from "@playwright/test";

// COMP-ENG-001A journey 2 — the Practice product gateway loads for a signed-out visitor. Confirmed
// live at src/app/practice/page.tsx: an unauthenticated request renders the marketing gateway; only
// a request carrying real Practice membership redirects straight to /practice/home. No auth needed
// here precisely because we are asserting the signed-out path.

test("practice gateway renders for a signed-out visitor", async ({ page }) => {
  await page.goto("/practice");
  await expect(page).toHaveURL(/\/practice\/?$/);
  await expect(page).toHaveTitle(/Competen Practice/i);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
