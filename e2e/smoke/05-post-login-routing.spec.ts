import { test, expect } from "@playwright/test";
import { signInAsSyntheticPractitioner } from "../helpers/synthetic-practitioner";

// COMP-ENG-001A journey 4 — after sign-in, a Practice practitioner lands in Practice, not some other
// product plane. This is the two-gate split (docs/COMP-ARCH-PSA-001-product-separation.md) made
// observable: Practice and Platform are separate products with explicit platform_membership, and a
// Practice credential must never resolve into /super-admin or any other product's shell.
//
// ⚠ SKIPS without a provisioned synthetic identity — see e2e/README.md.

test("post-login lands in /practice/home, not another product", async ({ page }) => {
  await signInAsSyntheticPractitioner(page);
  await expect(page).toHaveURL(/\/practice\/home/);
  await expect(page).not.toHaveURL(/\/super-admin/);
});
