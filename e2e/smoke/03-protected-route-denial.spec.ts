import { test, expect } from "@playwright/test";

// COMP-ENG-001A journey 7 — an unauthenticated request to a protected Practice route is denied, not
// served. Confirmed live at src/app/practice/(shell)/layout.tsx: shell.state === "AUTH_REQUIRED"
// redirects to /practice/sign-in?return_to=<original path>. This is the one negative-path journey in
// the set and needs no credentials — the assertion IS that no session gets in.

test("an unauthenticated visit to a shell route redirects to sign-in with return_to preserved", async ({ page }) => {
  await page.goto("/practice/home");
  await expect(page).toHaveURL(/\/practice\/sign-in\?return_to=/);
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
});
