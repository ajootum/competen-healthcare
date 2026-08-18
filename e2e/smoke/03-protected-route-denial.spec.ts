import { test, expect } from "@playwright/test";

// COMP-ENG-001A journey 7 — an unauthenticated request to a protected Practice route is denied, not
// served. Confirmed live at src/app/practice/(shell)/layout.tsx: shell.state === "AUTH_REQUIRED"
// redirects to /practice/sign-in?return_to=<original path>. This is the one negative-path journey in
// the set and needs no credentials — the assertion IS that no session gets in.
//
// ⚠ THIS ASSERTS THE REDIRECT, DELIBERATELY NOT WHICH SIGN-IN VARIANT RENDERS. /practice/sign-in is
// flag-gated on `practice_sign_in` (src/app/practice/sign-in/page.tsx): flag on renders the real form,
// flag off renders a "Sign-in is not open yet" statement, and the flag is read from the database, so
// the answer also depends on whether a database is reachable at all. An earlier version of this test
// asserted the form's heading and therefore went red in any environment without database access —
// while the security control it exists to protect was working perfectly. The denial and the
// return_to round-trip are the control; which panel the sign-in page then shows is a product-state
// question belonging to journey 3, which is credential-gated anyway.

test("an unauthenticated visit to a shell route redirects to sign-in with return_to preserved", async ({ page }) => {
  await page.goto("/practice/home");

  const url = new URL(page.url());
  expect(url.pathname).toBe("/practice/sign-in");
  // The round-trip matters as much as the redirect: a guard that forgets where you were going sends
  // every user to the same landing page after login. layout.tsx encodes the original path.
  expect(url.searchParams.get("return_to")).toBe("/practice/home");

  // The page must actually render, not 500 on the way to the door.
  await expect(page.locator("main")).toBeVisible();
});
