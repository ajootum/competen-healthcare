import { test, expect } from "@playwright/test";

// COMP-ENG-001A journey 1 — the public marketing site loads. No auth, no fixtures: this is the
// lowest bar the app can fail, and the one most likely to catch a build-breaking regression before
// anything auth-gated even gets exercised.

test("home page renders and identifies itself", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Competen/i);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
